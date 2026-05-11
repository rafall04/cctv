/**
 * Purpose: Owns runtime handling for camera source, IP, transport, codec, and enabled-state changes.
 * Caller: cameraService update and manual camera stream refresh flows.
 * Deps: mediaMtxService, cameraHealthService, cameraRuntimeStateService, database connection helpers.
 * MainFuncs: classifySourceChange, handleCameraUpdated, refreshCameraSource, getRecentEvents.
 * SideEffects: Refreshes MediaMTX paths, updates camera runtime state, bumps stream revisions, writes lifecycle events.
 */

import { execute, query, queryOne } from '../database/connectionPool.js';
import cameraHealthService from './cameraHealthService.js';
import cameraRuntimeStateService from './cameraRuntimeStateService.js';
import mediaMtxService from './mediaMtxService.js';
import { hashSourceValue, maskRtspUrl } from '../utils/cameraSourceFingerprint.js';

const SOURCE_FIELDS = [
    'private_rtsp_url',
    'internal_rtsp_transport_override',
    'delivery_type',
    'stream_source',
    'video_codec',
    'enabled',
];

function isEnabled(value) {
    return value === 1 || value === true;
}

function getPathName(camera) {
    return camera?.stream_key || `camera_${camera?.id}`;
}

export class CameraSourceLifecycleService {
    constructor(deps = {}) {
        this.mediaMtxService = deps.mediaMtxService || mediaMtxService;
        this.cameraHealthService = deps.cameraHealthService || cameraHealthService;
        this.cameraRuntimeStateService = deps.cameraRuntimeStateService || cameraRuntimeStateService;
        this.db = deps.db || { execute, query, queryOne };
    }

    classifySourceChange(existingCamera, patch) {
        const changedFields = [];
        const maskedChanges = {};

        for (const field of SOURCE_FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(patch, field)) {
                continue;
            }

            const before = existingCamera?.[field];
            const after = patch[field];
            if (String(before ?? '') === String(after ?? '')) {
                continue;
            }

            changedFields.push(field);
            maskedChanges[field] = {
                before: field === 'private_rtsp_url' ? maskRtspUrl(before) : before,
                after: field === 'private_rtsp_url' ? maskRtspUrl(after) : after,
                beforeHash: hashSourceValue(before),
                afterHash: hashSourceValue(after),
            };
        }

        return {
            sourceChanged: changedFields.length > 0,
            changedFields,
            maskedChanges,
        };
    }

    async handleCameraUpdated({ existingCamera, updatedCamera, patch, reason = 'camera_update' }) {
        const classification = this.classifySourceChange(existingCamera, patch);
        if (!classification.sourceChanged) {
            return {
                sourceChanged: false,
                status: 'unchanged',
                reason,
                streamRevision: updatedCamera?.stream_revision ?? existingCamera?.stream_revision ?? 0,
                warnings: [],
            };
        }

        return this.refreshCameraSource({
            camera: updatedCamera,
            reason,
            classification,
        });
    }

    async refreshCameraSource({ camera, reason = 'manual_refresh', classification = null }) {
        const now = new Date().toISOString();
        const warnings = [];
        const pathName = getPathName(camera);

        this.cameraRuntimeStateService.upsertRuntimeState(camera.id, {
            camera_id: camera.id,
            monitoring_state: 'reconnecting',
            monitoring_reason: reason,
            last_health_check_at: now,
        });

        let mediaMtxResult = { success: true, action: 'skipped', pathName };
        if (isEnabled(camera.enabled) && camera.stream_source !== 'external' && camera.delivery_type === 'internal_hls') {
            mediaMtxResult = await this.mediaMtxService.refreshCameraPathAfterSourceChange(
                pathName,
                camera.private_rtsp_url,
                camera
            );
            if (!mediaMtxResult.success || mediaMtxResult.action === 'patched_refresh_pending') {
                warnings.push(mediaMtxResult.message || mediaMtxResult.error || 'MediaMTX path refresh is pending');
            }
        }

        await this.cameraHealthService.clearCameraRuntimeState(camera.id, pathName);

        const verification = await this.verifyInternalHlsSource(camera, mediaMtxResult);
        if (!verification.success) {
            warnings.push(verification.message);
        }

        this.db.execute(
            `UPDATE cameras
             SET stream_revision = COALESCE(stream_revision, 0) + 1,
                 source_updated_at = ?,
                 updated_at = ?
             WHERE id = ?`,
            [now, now, camera.id]
        );

        const revisionRow = this.db.queryOne(
            'SELECT stream_revision, source_updated_at FROM cameras WHERE id = ?',
            [camera.id]
        ) || {};

        const status = warnings.length > 0 ? 'refresh_pending' : 'refreshed';
        const result = {
            sourceChanged: true,
            status,
            reason,
            streamRevision: revisionRow.stream_revision ?? 0,
            sourceUpdatedAt: revisionRow.source_updated_at ?? now,
            mediaMtx: mediaMtxResult,
            verification,
            warnings,
        };

        this.recordLifecycleEvent({
            cameraId: camera.id,
            eventType: 'source_refresh',
            reason,
            status,
            classification: classification || { sourceChanged: true, changedFields: ['manual_refresh'], maskedChanges: {} },
            result,
        });

        this.cameraRuntimeStateService.upsertRuntimeState(camera.id, {
            camera_id: camera.id,
            monitoring_state: status === 'refreshed' ? 'checking' : 'reconnecting',
            monitoring_reason: status,
            last_health_check_at: now,
        });

        return result;
    }

    async verifyInternalHlsSource(camera, mediaMtxResult) {
        if (!isEnabled(camera.enabled) || camera.stream_source === 'external' || camera.delivery_type !== 'internal_hls') {
            return { success: true, status: 'not_required' };
        }

        if (!mediaMtxResult.success) {
            return {
                success: false,
                status: 'media_mtx_refresh_failed',
                message: mediaMtxResult.message || mediaMtxResult.error || 'MediaMTX refresh failed',
            };
        }

        const pathConfig = await this.mediaMtxService.getPathConfig(getPathName(camera));
        if (!pathConfig) {
            return {
                success: false,
                status: 'path_config_missing',
                message: 'MediaMTX path config is missing after refresh',
            };
        }

        return {
            success: true,
            status: 'path_config_matches',
        };
    }

    recordLifecycleEvent({ cameraId, eventType, reason, status, classification, result }) {
        try {
            const cameraExists = this.db.queryOne?.('SELECT id FROM cameras WHERE id = ?', [cameraId]);
            if (!cameraExists) {
                console.warn(`[CameraSourceLifecycle] Skipped event for missing camera ${cameraId}`);
                return;
            }

            this.db.execute(
                `INSERT INTO camera_source_lifecycle_events
                 (camera_id, event_type, reason, status, source_change_summary_json, result_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    cameraId,
                    eventType,
                    reason,
                    status,
                    JSON.stringify(classification),
                    JSON.stringify(result),
                    new Date().toISOString(),
                ]
            );
        } catch (error) {
            console.warn(`[CameraSourceLifecycle] Failed to write event for camera ${cameraId}: ${error.message}`);
        }
    }

    getRecentEvents(cameraId, limit = 20) {
        return this.db.query(
            `SELECT id, camera_id, event_type, reason, status, source_change_summary_json, result_json, created_at
             FROM camera_source_lifecycle_events
             WHERE camera_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
            [cameraId, Math.min(Math.max(Number(limit) || 20, 1), 50)]
        );
    }
}

export default new CameraSourceLifecycleService();
