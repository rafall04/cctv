import { query, queryOne, execute } from '../database/database.js';
import { recordingService } from './recordingService.js';
import { logAdminAction } from './securityAuditLogger.js';
import settingsService from './settingsService.js';
import { existsSync, statSync } from 'fs';

const PUBLIC_PLAYBACK_MODES = new Set(['inherit', 'disabled', 'preview_only', 'admin_only']);
const VALID_PREVIEW_MINUTES = new Set([0, 10, 20, 30, 60]);

function normalizePublicPlaybackMode(value) {
    return PUBLIC_PLAYBACK_MODES.has(value) ? value : 'inherit';
}

function normalizePreviewMinutes(value, fallback = 10) {
    const parsed = Number.parseInt(value, 10);
    return VALID_PREVIEW_MINUTES.has(parsed) ? parsed : fallback;
}

function getPreviewSegmentLimit(previewMinutes) {
    if (!previewMinutes) {
        return 0;
    }

    return Math.max(0, Math.floor(previewMinutes / 10));
}

class RecordingPlaybackService {
    async startRecording(cameraId, duration_hours, request) {
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        if (duration_hours) {
            execute(
                'UPDATE cameras SET recording_duration_hours = ? WHERE id = ?',
                [duration_hours, cameraId]
            );
        }

        const result = await recordingService.startRecording(cameraId);

        if (result.success) {
            logAdminAction({
                action: 'recording_started',
                camera_id: cameraId,
                camera_name: camera.name,
                duration_hours: duration_hours || camera.recording_duration_hours,
                userId: request.user.id
            }, request);
        }

        return result;
    }

    async stopRecording(cameraId, request) {
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        const result = await recordingService.stopRecording(cameraId);

        if (result.success) {
            logAdminAction({
                action: 'recording_stopped',
                camera_id: cameraId,
                camera_name: camera.name,
                userId: request.user.id
            }, request);
        }

        return result;
    }

    getRecordingStatus(cameraId) {
        const camera = queryOne(
            'SELECT id, name, enable_recording, recording_status, recording_duration_hours, last_recording_start FROM cameras WHERE id = ?',
            [cameraId]
        );

        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        const runtimeStatus = recordingService.getRecordingStatus(cameraId);
        const storage = recordingService.getStorageUsage(cameraId);

        return {
            camera_id: camera.id,
            camera_name: camera.name,
            enable_recording: camera.enable_recording,
            recording_status: camera.recording_status,
            recording_duration_hours: camera.recording_duration_hours,
            last_recording_start: camera.last_recording_start,
            runtime_status: runtimeStatus,
            storage,
        };
    }

    getRecordingsOverview() {
        const cameras = query(`
            SELECT 
                id, 
                name, 
                location,
                enabled,
                status,
                enable_recording, 
                recording_status, 
                recording_duration_hours,
                last_recording_start,
                stream_source
            FROM cameras 
            WHERE enabled = 1
            ORDER BY id ASC
        `);

        const camerasWithStatus = cameras.map((camera) => {
            const runtimeStatus = recordingService.getRecordingStatus(camera.id);
            const storage = recordingService.getStorageUsage(camera.id);

            return {
                ...camera,
                runtime_status: runtimeStatus,
                storage,
            };
        });

        const activeRecordings = camerasWithStatus.filter((camera) => camera.runtime_status.isRecording).length;
        const totalStorage = camerasWithStatus.reduce((sum, camera) => sum + camera.storage.totalSize, 0);
        const totalStorageGB = (totalStorage / 1024 / 1024 / 1024).toFixed(2);

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const recentRestarts = query(
            'SELECT COUNT(*) as count FROM restart_logs WHERE restart_time > ?',
            [yesterday]
        );

        return {
            overview: {
                total_cameras: cameras.length,
                active_recordings: activeRecordings,
                total_storage_gb: totalStorageGB,
                recent_restarts_24h: recentRestarts[0].count
            },
            cameras: camerasWithStatus
        };
    }

    getPlaybackCamera(cameraId) {
        const camera = queryOne(`
            SELECT
                id,
                name,
                enabled,
                enable_recording,
                public_playback_mode,
                public_playback_preview_minutes
            FROM cameras
            WHERE id = ?
        `, [cameraId]);

        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        return {
            ...camera,
            public_playback_mode: normalizePublicPlaybackMode(camera.public_playback_mode),
            public_playback_preview_minutes: camera.public_playback_preview_minutes,
        };
    }

    resolvePlaybackAccess(camera, request = {}) {
        const requestedScope = request?.query?.scope === 'admin' ? 'admin' : 'public';

        if (requestedScope === 'admin') {
            if (!request?.user?.id) {
                const err = new Error('Unauthorized playback access');
                err.statusCode = 401;
                throw err;
            }

            return {
                accessMode: 'admin_full',
                isPublicPreview: false,
                previewMinutes: null,
                notice: null,
                contact: null,
                deniedReason: null,
            };
        }

        const globalSettings = settingsService.getPublicPlaybackSettings();
        const cameraMode = normalizePublicPlaybackMode(camera.public_playback_mode);

        if (!globalSettings.publicPlaybackEnabled) {
            return {
                accessMode: 'public_denied',
                isPublicPreview: false,
                previewMinutes: 0,
                notice: null,
                contact: null,
                deniedReason: 'public_playback_disabled',
            };
        }

        if (cameraMode === 'disabled' || cameraMode === 'admin_only') {
            return {
                accessMode: 'public_denied',
                isPublicPreview: false,
                previewMinutes: 0,
                notice: null,
                contact: null,
                deniedReason: cameraMode === 'admin_only' ? 'camera_admin_only' : 'camera_public_disabled',
            };
        }

        const resolvedPreviewMinutes = normalizePreviewMinutes(
            camera.public_playback_preview_minutes,
            normalizePreviewMinutes(globalSettings.previewMinutes)
        );

        if (resolvedPreviewMinutes === 0) {
            return {
                accessMode: 'public_denied',
                isPublicPreview: false,
                previewMinutes: 0,
                notice: null,
                contact: null,
                deniedReason: 'public_preview_disabled',
            };
        }

        const contact = this.resolvePlaybackContact(globalSettings.contactMode);
        const notice = globalSettings.notice.enabled
            ? {
                enabled: true,
                title: globalSettings.notice.title,
                text: globalSettings.notice.text,
            }
            : null;

        return {
            accessMode: 'public_preview',
            isPublicPreview: true,
            previewMinutes: resolvedPreviewMinutes,
            notice,
            contact,
            deniedReason: null,
        };
    }

    resolvePlaybackContact(contactMode) {
        if (contactMode !== 'branding_whatsapp') {
            return null;
        }

        const whatsappRow = queryOne(
            'SELECT value FROM branding_settings WHERE key = ?',
            ['whatsapp_number']
        );

        const whatsappNumber = typeof whatsappRow?.value === 'string'
            ? whatsappRow.value.trim()
            : '';

        if (!whatsappNumber) {
            return null;
        }

        return {
            mode: 'branding_whatsapp',
            value: whatsappNumber,
            label: 'Hubungi Admin',
            href: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Halo Admin, saya ingin informasi lebih lanjut tentang akses playback CCTV.')}`,
        };
    }

    getAccessibleSegments(cameraId, request) {
        const camera = this.getPlaybackCamera(cameraId);
        const access = this.resolvePlaybackAccess(camera, request);

        if (access.accessMode === 'public_denied') {
            const err = new Error('Playback publik tidak tersedia untuk kamera ini');
            err.statusCode = 403;
            err.playbackAccess = access;
            throw err;
        }

        const allSegmentsAscending = query(
            `SELECT
                id,
                filename,
                start_time,
                end_time,
                file_size,
                duration,
                created_at,
                file_path
            FROM recording_segments
            WHERE camera_id = ?
            ORDER BY start_time ASC`,
            [cameraId]
        );

        if (allSegmentsAscending.length === 0) {
            const err = new Error('No segments found');
            err.statusCode = 404;
            throw err;
        }

        const allowedSegmentsAscending = access.accessMode === 'admin_full'
            ? allSegmentsAscending
            : allSegmentsAscending.slice(0, getPreviewSegmentLimit(access.previewMinutes));

        if (!allowedSegmentsAscending.length) {
            const err = new Error('Playback preview tidak tersedia');
            err.statusCode = 403;
            err.playbackAccess = access;
            throw err;
        }

        return {
            camera,
            access,
            segmentsAscending: allowedSegmentsAscending,
            segmentsDescending: [...allowedSegmentsAscending].sort(
                (left, right) => new Date(right.start_time) - new Date(left.start_time)
            ),
        };
    }

    buildPlaybackPolicy(access, camera, segmentsAscending) {
        return {
            accessMode: access.accessMode,
            isPublicPreview: access.isPublicPreview,
            previewMinutes: access.previewMinutes,
            notice: access.notice,
            contact: access.contact,
            deniedReason: access.deniedReason,
            publicPlaybackMode: camera.public_playback_mode,
            segmentCount: segmentsAscending.length,
        };
    }

    getSegments(cameraId, request) {
        const { camera, access, segmentsAscending, segmentsDescending } = this.getAccessibleSegments(cameraId, request);

        return {
            camera_id: camera.id,
            camera_name: camera.name,
            segments: segmentsDescending,
            total_segments: segmentsDescending.length,
            playback_policy: this.buildPlaybackPolicy(access, camera, segmentsAscending),
        };
    }

    getStreamSegment(cameraId, filename, request) {
        const { segmentsAscending } = this.getAccessibleSegments(cameraId, request);
        const segment = segmentsAscending.find((item) => item.filename === filename);

        if (!segment) {
            const err = new Error('Segment not available for this playback scope');
            err.statusCode = 403;
            throw err;
        }

        if (!existsSync(segment.file_path)) {
            const err = new Error('Segment file not found on disk');
            err.statusCode = 404;
            throw err;
        }

        const stats = statSync(segment.file_path);

        if (Math.abs(stats.size - segment.file_size) > 1024 * 1024) {
            execute(
                'UPDATE recording_segments SET file_size = ? WHERE id = ?',
                [stats.size, segment.id]
            );
        }

        return {
            segment,
            stats,
        };
    }

    generatePlaylist(cameraId, request) {
        const { access, segmentsAscending } = this.getAccessibleSegments(cameraId, request);

        let playlist = '#EXTM3U\n';
        playlist += '#EXT-X-VERSION:3\n';
        playlist += '#EXT-X-TARGETDURATION:600\n';
        playlist += '#EXT-X-MEDIA-SEQUENCE:0\n';

        const querySuffix = access.accessMode === 'admin_full' ? '?scope=admin' : '';

        segmentsAscending.forEach((segment) => {
            playlist += `#EXTINF:${segment.duration}.0,\n`;
            playlist += `/api/recordings/${cameraId}/stream/${segment.filename}${querySuffix}\n`;
        });

        playlist += '#EXT-X-ENDLIST\n';

        return playlist;
    }

    getRestartLogs(cameraId, limit = 50) {
        let logs;
        if (cameraId) {
            logs = query(
                `SELECT * FROM restart_logs 
                WHERE camera_id = ? 
                ORDER BY restart_time DESC 
                LIMIT ?`,
                [cameraId, limit]
            );
        } else {
            logs = query(
                `SELECT rl.*, c.name as camera_name 
                FROM restart_logs rl
                LEFT JOIN cameras c ON rl.camera_id = c.id
                ORDER BY rl.restart_time DESC 
                LIMIT ?`,
                [limit]
            );
        }
        return logs;
    }

    async updateRecordingSettings(cameraId, data, request) {
        const {
            enable_recording,
            recording_duration_hours,
            public_playback_mode,
            public_playback_preview_minutes,
        } = data;

        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        const updates = [];
        const values = [];

        if (enable_recording !== undefined) {
            updates.push('enable_recording = ?');
            values.push(enable_recording ? 1 : 0);
        }

        if (recording_duration_hours !== undefined) {
            updates.push('recording_duration_hours = ?');
            values.push(recording_duration_hours);
        }

        if (public_playback_mode !== undefined) {
            updates.push('public_playback_mode = ?');
            values.push(normalizePublicPlaybackMode(public_playback_mode));
        }

        if (public_playback_preview_minutes !== undefined) {
            updates.push('public_playback_preview_minutes = ?');
            values.push(
                public_playback_preview_minutes === null || public_playback_preview_minutes === ''
                    ? null
                    : normalizePreviewMinutes(public_playback_preview_minutes)
            );
        }

        if (updates.length === 0) {
            const err = new Error('No settings to update');
            err.statusCode = 400;
            throw err;
        }

        values.push(cameraId);

        execute(
            `UPDATE cameras SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        if (enable_recording !== undefined) {
            if (enable_recording && camera.enabled) {
                await recordingService.startRecording(cameraId);
            } else {
                await recordingService.stopRecording(cameraId);
            }
        }

        logAdminAction({
            action: 'recording_settings_updated',
            camera_id: cameraId,
            camera_name: camera.name,
            changes: {
                enable_recording,
                recording_duration_hours,
                public_playback_mode,
                public_playback_preview_minutes,
            },
            userId: request.user.id
        }, request);
    }
}

export default new RecordingPlaybackService();
