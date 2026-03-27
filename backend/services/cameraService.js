import { query, queryOne, execute, transaction } from '../database/connectionPool.js';
import { v4 as uuidv4 } from 'uuid';
import mediaMtxService from './mediaMtxService.js';
import {
    logAdminAction,
    logCameraCreated,
    logCameraUpdated,
    logCameraDeleted
} from './securityAuditLogger.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { sanitizeCameraThumbnail, sanitizeCameraThumbnailList } from './thumbnailPathService.js';
import cameraHealthService from './cameraHealthService.js';
import {
    DELIVERY_TYPES,
    DELIVERY_TYPE_PATTERNS,
    getCameraDeliveryProfile,
    getCompatStreamSource,
    getEffectiveDeliveryType,
    getPrimaryExternalStreamUrl,
    normalizeExternalOriginMode,
} from '../utils/cameraDelivery.js';

const BULK_AREA_TARGET_FILTERS = [
    'all',
    'internal_only',
    'external_only',
    'external_hls_only',
    'external_unresolved_only',
    'online_only',
    'offline_only',
    'recording_enabled_only',
];

const BULK_AREA_OPERATIONS = [
    'policy_update',
    'normalization',
    'maintenance',
];

const RESTORE_MATCH_MODES = [
    'id_then_name_area',
];

const RESTORE_SCOPE_MODES = [
    'all',
    'unresolved_only',
    'area_ids',
];

const RESTORE_RESULT_STATUSES = [
    'matched_repairable',
    'matched_no_changes',
    'ambiguous_matches',
    'missing_target',
    'invalid_backup_row',
];

function getNormalizedDeliveryType(data = {}) {
    return getEffectiveDeliveryType(data);
}

function getNormalizedExternalStreamUrl(data = {}, deliveryType) {
    if (data.external_stream_url !== undefined) {
        return data.external_stream_url || null;
    }

    if (deliveryType !== 'internal_hls') {
        return getPrimaryExternalStreamUrl(data);
    }

    return null;
}

function validateDeliveryConfiguration({
    deliveryType,
    privateRtspUrl,
    externalStreamUrl,
    externalEmbedUrl,
}, options = {}) {
    const allowIncompleteExternalMetadata = Boolean(options.allowIncompleteExternalMetadata);

    if (deliveryType === 'internal_hls') {
        if (!privateRtspUrl) {
            const err = new Error('RTSP URL is required for internal HLS cameras');
            err.statusCode = 400;
            throw err;
        }
        return;
    }

    if (deliveryType === 'external_hls') {
        if (!externalStreamUrl) {
            if (allowIncompleteExternalMetadata) {
                return;
            }
            const err = new Error('External HLS URL is required for external HLS cameras');
            err.statusCode = 400;
            throw err;
        }
        if (!DELIVERY_TYPE_PATTERNS.http.test(externalStreamUrl)) {
            const err = new Error('External HLS URL must start with http:// or https://');
            err.statusCode = 400;
            throw err;
        }
        return;
    }

    if (deliveryType === 'external_mjpeg') {
        if (!externalStreamUrl) {
            if (allowIncompleteExternalMetadata) {
                return;
            }
            const err = new Error('External stream URL is required for MJPEG cameras');
            err.statusCode = 400;
            throw err;
        }
        if (!DELIVERY_TYPE_PATTERNS.http.test(externalStreamUrl)) {
            const err = new Error('MJPEG URL must start with http:// or https://');
            err.statusCode = 400;
            throw err;
        }
        return;
    }

    if (deliveryType === 'external_embed') {
        if (!externalEmbedUrl) {
            if (allowIncompleteExternalMetadata) {
                return;
            }
            const err = new Error('External embed URL is required for embed cameras');
            err.statusCode = 400;
            throw err;
        }
        if (!DELIVERY_TYPE_PATTERNS.http.test(externalEmbedUrl)) {
            const err = new Error('Embed URL must start with http:// or https://');
            err.statusCode = 400;
            throw err;
        }
        return;
    }

    if (deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
        if (!externalStreamUrl) {
            if (allowIncompleteExternalMetadata) {
                return;
            }
            const err = new Error('External WebSocket stream URL is required for this delivery type');
            err.statusCode = 400;
            throw err;
        }
        if (!DELIVERY_TYPE_PATTERNS.websocket.test(externalStreamUrl)) {
            const err = new Error('WebSocket stream URL must start with ws:// or wss://');
            err.statusCode = 400;
            throw err;
        }
    }
}

function normalizeCameraPersistencePayload(data = {}, existingCamera = null, options = {}) {
    const mergedData = {
        ...existingCamera,
        ...data,
    };
    const deliveryType = getNormalizedDeliveryType(mergedData);
    const compatStreamSource = getCompatStreamSource(deliveryType);
    const externalStreamUrl = getNormalizedExternalStreamUrl(mergedData, deliveryType);
    const externalEmbedUrl = data.external_embed_url !== undefined
        ? (data.external_embed_url || null)
        : (existingCamera?.external_embed_url || null);
    const externalSnapshotUrl = data.external_snapshot_url !== undefined
        ? (data.external_snapshot_url || null)
        : (existingCamera?.external_snapshot_url || null);
    const externalOriginMode = normalizeExternalOriginMode(
        data.external_origin_mode !== undefined
            ? data.external_origin_mode
            : existingCamera?.external_origin_mode
    );
    const externalHlsUrl = deliveryType === 'external_hls'
        ? (data.external_hls_url !== undefined
            ? (data.external_hls_url || externalStreamUrl || null)
            : (existingCamera?.external_hls_url || externalStreamUrl || null))
        : null;

    validateDeliveryConfiguration({
        deliveryType,
        privateRtspUrl: data.private_rtsp_url !== undefined ? data.private_rtsp_url : existingCamera?.private_rtsp_url,
        externalStreamUrl,
        externalEmbedUrl,
    }, options);

    return {
        deliveryType,
        compatStreamSource,
        externalStreamUrl,
        externalEmbedUrl,
        externalSnapshotUrl,
        externalOriginMode,
        externalHlsUrl,
    };
}

function toNullableRtspValue(value) {
    if (value === undefined) {
        return undefined;
    }

    return value || null;
}

function normalizeBulkAreaRequest(bulkRequest = {}) {
    if (bulkRequest && bulkRequest.updates && bulkRequest.operation === undefined && bulkRequest.payload === undefined) {
        return {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: bulkRequest.updates,
            preview: Boolean(bulkRequest.preview),
        };
    }

    return {
        targetFilter: bulkRequest.targetFilter || 'all',
        operation: bulkRequest.operation || 'policy_update',
        payload: bulkRequest.payload || {},
        preview: Boolean(bulkRequest.preview),
    };
}

function normalizeRestoreRequest(restoreRequest = {}) {
    const backupItems = Array.isArray(restoreRequest)
        ? restoreRequest
        : (Array.isArray(restoreRequest.backupItems)
            ? restoreRequest.backupItems
            : (Array.isArray(restoreRequest.data)
                ? restoreRequest.data
                : (Array.isArray(restoreRequest.cameras) ? restoreRequest.cameras : [])));
    const scope = restoreRequest.scope || {};

    return {
        backupFileName: typeof restoreRequest.backupFileName === 'string' ? restoreRequest.backupFileName.trim() : null,
        backupItems,
        matchMode: RESTORE_MATCH_MODES.includes(restoreRequest.matchMode)
            ? restoreRequest.matchMode
            : 'id_then_name_area',
        scope: {
            mode: RESTORE_SCOPE_MODES.includes(scope.mode) ? scope.mode : 'all',
            areaIds: Array.isArray(scope.areaIds)
                ? scope.areaIds.map((value) => parseInt(value, 10)).filter((value) => Number.isInteger(value))
                : [],
        },
        applyPolicy: restoreRequest.applyPolicy || 'repair_existing',
    };
}

function normalizeComparisonValue(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
    }
    return value;
}

function normalizeLookupKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function buildNameAreaKey(name, areaName) {
    return `${normalizeLookupKey(name)}::${normalizeLookupKey(areaName)}`;
}

function buildRestoreSourceMetadata(backupItem = {}) {
    const rawName = backupItem.name || backupItem.title || backupItem.cctv_title || '';
    const rawSourceUrl = backupItem.external_stream_url || backupItem.external_hls_url || backupItem.url || backupItem.stream || backupItem.cctv_link || null;
    const rawRtspUrl = backupItem.private_rtsp_url || null;
    const rawEmbedUrl = backupItem.external_embed_url || backupItem.embed_url || backupItem.page_url || null;
    const rawSnapshotUrl = backupItem.external_snapshot_url || backupItem.thumbnail_url || backupItem.snapshot_url || null;
    const rawAreaName = backupItem.area_name || backupItem.area || null;

    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const sourceUrl = typeof rawSourceUrl === 'string' ? rawSourceUrl.trim() : null;
    const rtspUrl = typeof rawRtspUrl === 'string' ? rawRtspUrl.trim() : null;
    const embedUrl = typeof rawEmbedUrl === 'string' ? rawEmbedUrl.trim() : null;
    const snapshotUrl = typeof rawSnapshotUrl === 'string' ? rawSnapshotUrl.trim() : null;
    const areaName = typeof rawAreaName === 'string' ? rawAreaName.trim() : '';

    const inferredDeliveryType = getEffectiveDeliveryType({
        stream_source: backupItem.stream_source || (rtspUrl ? 'internal' : 'external'),
        delivery_type: backupItem.delivery_type,
        private_rtsp_url: rtspUrl,
        external_hls_url: backupItem.external_hls_url || null,
        external_stream_url: sourceUrl,
        external_embed_url: embedUrl,
        external_snapshot_url: snapshotUrl,
    });

    return {
        id: Number.isInteger(parseInt(backupItem.id, 10)) ? parseInt(backupItem.id, 10) : null,
        name,
        areaName,
        sourceUrl,
        rtspUrl,
        embedUrl,
        snapshotUrl,
        streamSource: backupItem.stream_source,
        deliveryType: inferredDeliveryType,
        externalUseProxy: backupItem.external_use_proxy === false || backupItem.external_use_proxy === 0 ? 0 : 1,
        externalTlsMode: backupItem.external_tls_mode === 'insecure' ? 'insecure' : 'strict',
        externalOriginMode: normalizeExternalOriginMode(backupItem.external_origin_mode),
    };
}

function buildRestorePatch(existingCamera, sourceMetadata) {
    const deliveryConfig = normalizeCameraPersistencePayload({
        stream_source: sourceMetadata.deliveryType === 'internal_hls' ? 'internal' : 'external',
        delivery_type: sourceMetadata.deliveryType,
        private_rtsp_url: sourceMetadata.deliveryType === 'internal_hls' ? sourceMetadata.rtspUrl : null,
        external_hls_url: sourceMetadata.deliveryType === 'external_hls' ? sourceMetadata.sourceUrl : null,
        external_stream_url: sourceMetadata.deliveryType === 'internal_hls' ? null : sourceMetadata.sourceUrl,
        external_embed_url: sourceMetadata.deliveryType === 'external_embed' ? sourceMetadata.embedUrl : sourceMetadata.embedUrl,
        external_snapshot_url: sourceMetadata.snapshotUrl,
        external_origin_mode: sourceMetadata.externalOriginMode,
    }, existingCamera);

    return {
        stream_source: deliveryConfig.compatStreamSource,
        delivery_type: deliveryConfig.deliveryType,
        private_rtsp_url: deliveryConfig.deliveryType === 'internal_hls'
            ? (sourceMetadata.rtspUrl || '')
            : null,
        external_hls_url: deliveryConfig.externalHlsUrl,
        external_stream_url: deliveryConfig.externalStreamUrl,
        external_embed_url: deliveryConfig.externalEmbedUrl,
        external_snapshot_url: deliveryConfig.externalSnapshotUrl,
        external_use_proxy: deliveryConfig.deliveryType === 'external_hls'
            ? sourceMetadata.externalUseProxy
            : (existingCamera.external_use_proxy === 0 ? 0 : 1),
        external_tls_mode: deliveryConfig.deliveryType === 'external_hls'
            ? sourceMetadata.externalTlsMode
            : (existingCamera.external_tls_mode === 'insecure' ? 'insecure' : 'strict'),
        external_origin_mode: deliveryConfig.externalOriginMode,
    };
}

function getRestoreChangedFields(existingCamera, patch) {
    return Object.keys(patch).filter((field) => (
        normalizeComparisonValue(existingCamera[field]) !== normalizeComparisonValue(patch[field])
    ));
}

function buildRestoreResultSummary(rows = []) {
    const counts = {
        matched_repairable: 0,
        matched_no_changes: 0,
        ambiguous_matches: 0,
        missing_target: 0,
        invalid_backup_row: 0,
        total: rows.length,
    };

    for (const row of rows) {
        if (RESTORE_RESULT_STATUSES.includes(row.status)) {
            counts[row.status] += 1;
        }
    }

    return {
        counts,
        canApply: counts.matched_repairable > 0,
    };
}

function matchesBulkTargetFilter(camera, targetFilter) {
    const deliveryProfile = getCameraDeliveryProfile(camera);

    switch (targetFilter) {
        case 'all':
            return true;
        case 'internal_only':
            return deliveryProfile.classification === 'internal_hls';
        case 'external_only':
            return deliveryProfile.classification !== 'internal_hls';
        case 'external_hls_only':
            return deliveryProfile.classification !== 'external_unresolved'
                && deliveryProfile.effectiveDeliveryType === 'external_hls';
        case 'external_unresolved_only':
            return deliveryProfile.classification === 'external_unresolved';
        case 'online_only':
            return camera.is_online === 1 || camera.is_online === true;
        case 'offline_only':
            return camera.is_online === 0 || camera.is_online === false;
        case 'recording_enabled_only':
            return camera.enable_recording === 1 || camera.enable_recording === true;
        default:
            return false;
    }
}

function requiresExternalHlsAreaPolicy(operation, payload = {}) {
    if (operation !== 'policy_update' && operation !== 'maintenance') {
        return false;
    }

    return payload.external_use_proxy !== undefined
        || payload.external_tls_mode !== undefined
        || payload.external_origin_mode !== undefined;
}

function getBulkEligibility(camera, operation, payload = {}) {
    const deliveryProfile = getCameraDeliveryProfile(camera);
    const effectiveDeliveryType = payload.delivery_type || deliveryProfile.effectiveDeliveryType;

    if ((operation === 'policy_update' || operation === 'maintenance') && payload.enable_recording !== undefined) {
        if (deliveryProfile.classification !== 'internal_hls') {
            return { eligible: false, reason: 'internal_only_policy' };
        }
    }

    if ((operation === 'policy_update' || operation === 'maintenance') && payload.video_codec !== undefined) {
        if (deliveryProfile.classification !== 'internal_hls') {
            return { eligible: false, reason: 'internal_only_policy' };
        }
    }

    if (requiresExternalHlsAreaPolicy(operation, payload) && effectiveDeliveryType !== 'external_hls') {
        return { eligible: false, reason: 'external_hls_only_policy' };
    }

    return { eligible: true, reason: null };
}

function buildBulkTargetSummary(targetCameras = [], options = {}) {
    const {
        totalInArea = targetCameras.length,
        operation = null,
        payload = {},
    } = options;
    const summary = {
        totalInArea,
        matchedCount: targetCameras.length,
        eligibleCount: 0,
        blockedCount: 0,
        blockedReasons: [],
        internalCount: 0,
        externalCount: 0,
        unresolvedCount: 0,
        onlineCount: 0,
        offlineCount: 0,
        recordingEnabledCount: 0,
        total: targetCameras.length,
        examples: targetCameras.slice(0, 10).map((camera) => ({
            id: camera.id,
            name: camera.name,
            delivery_type: getCameraDeliveryProfile(camera).effectiveDeliveryType,
            delivery_classification: getCameraDeliveryProfile(camera).classification,
            is_online: camera.is_online === 1 || camera.is_online === true,
        })),
        blockedExamples: [],
    };
    const blockedReasonMap = new Map();

    for (const camera of targetCameras) {
        const deliveryProfile = getCameraDeliveryProfile(camera);
        const eligibility = getBulkEligibility(camera, operation, payload);
        if (deliveryProfile.classification === 'internal_hls') {
            summary.internalCount += 1;
        } else {
            summary.externalCount += 1;
        }
        if (deliveryProfile.classification === 'external_unresolved') {
            summary.unresolvedCount += 1;
        }
        if (camera.is_online === 1 || camera.is_online === true) {
            summary.onlineCount += 1;
        } else {
            summary.offlineCount += 1;
        }
        if (camera.enable_recording === 1 || camera.enable_recording === true) {
            summary.recordingEnabledCount += 1;
        }

        if (eligibility.eligible) {
            summary.eligibleCount += 1;
        } else {
            summary.blockedCount += 1;
            blockedReasonMap.set(eligibility.reason, (blockedReasonMap.get(eligibility.reason) || 0) + 1);
            if (summary.blockedExamples.length < 10) {
                summary.blockedExamples.push({
                    id: camera.id,
                    name: camera.name,
                    delivery_type: deliveryProfile.effectiveDeliveryType,
                    delivery_classification: deliveryProfile.classification,
                    reason: eligibility.reason,
                });
            }
        }
    }

    summary.blockedReasons = Array.from(blockedReasonMap.entries()).map(([reason, count]) => ({ reason, count }));

    return summary;
}

class CameraService {
    invalidateCameraCache() {
        invalidateCache('/api/cameras');
        invalidateCache('/api/stream');
        console.log('[Cache] Camera cache invalidated');
    }

    getAllCameras() {
        return sanitizeCameraThumbnailList(query(
            `SELECT c.*, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             ORDER BY c.id ASC`
        )).map((camera) => cameraHealthService.enrichCameraAvailability(camera));
    }

    getActiveCameras() {
        return sanitizeCameraThumbnailList(query(
            `SELECT c.id, c.name, c.description, c.location, c.group_name, c.area_id, c.is_tunnel, 
                    c.latitude, c.longitude, c.status, c.enable_recording, c.video_codec, c.stream_key, 
                    c.thumbnail_path, c.thumbnail_updated_at, c.stream_source, c.external_hls_url,
                    c.is_online, c.last_online_check,
                    c.delivery_type, c.external_stream_url, c.external_embed_url, c.external_snapshot_url,
                    CASE
                        WHEN c.external_origin_mode IN ('direct', 'embed') THEN c.external_origin_mode
                        ELSE 'direct'
                    END as external_origin_mode,
                    COALESCE(c.external_use_proxy, 1) as external_use_proxy,
                    CASE
                        WHEN c.external_tls_mode IN ('strict', 'insecure') THEN c.external_tls_mode
                        ELSE 'strict'
                    END as external_tls_mode,
                    a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.enabled = 1 
             ORDER BY c.is_tunnel ASC, c.id ASC`
        )).map((camera) => cameraHealthService.enrichCameraAvailability(camera));
    }

    getCameraById(id) {
        const camera = queryOne(
            `SELECT c.*, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.id = ?`,
            [id]
        );
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }
        return cameraHealthService.enrichCameraAvailability(sanitizeCameraThumbnail(camera));
    }

    async createCamera(data, request) {
        const {
            name,
            private_rtsp_url,
            description,
            location,
            group_name,
            area_id,
            enabled,
            is_tunnel,
            latitude,
            longitude,
            status,
            enable_recording,
            recording_duration_hours,
            video_codec,
            stream_source,
            delivery_type,
            external_hls_url,
            external_stream_url,
            external_embed_url,
            external_snapshot_url,
            external_origin_mode,
            external_use_proxy,
            external_tls_mode,
        } = data;
        const externalUseProxy = external_use_proxy === false || external_use_proxy === 0 ? 0 : 1;
        const externalTlsMode = external_tls_mode === 'insecure' ? 'insecure' : 'strict';

        if (!name) {
            const err = new Error('Camera name is required');
            err.statusCode = 400;
            throw err;
        }
        if (stream_source !== undefined && !['internal', 'external'].includes(stream_source)) {
            const err = new Error('Invalid stream source. Must be internal or external');
            err.statusCode = 400;
            throw err;
        }
        if (delivery_type !== undefined && !DELIVERY_TYPES.includes(delivery_type)) {
            const err = new Error('Invalid delivery type');
            err.statusCode = 400;
            throw err;
        }

        if (external_tls_mode !== undefined && !['strict', 'insecure'].includes(external_tls_mode)) {
            const err = new Error('Invalid external TLS mode. Must be strict or insecure');
            err.statusCode = 400;
            throw err;
        }

        const codecValue = video_codec || 'h264';
        const deliveryConfig = normalizeCameraPersistencePayload({
            stream_source,
            delivery_type,
            private_rtsp_url,
            external_hls_url,
            external_stream_url,
            external_embed_url,
            external_snapshot_url,
            external_origin_mode,
        });

        if (deliveryConfig.deliveryType === 'internal_hls' && !['h264', 'h265'].includes(codecValue)) {
            const err = new Error('Invalid video codec. Must be h264 or h265');
            err.statusCode = 400;
            throw err;
        }

        const streamKey = uuidv4();

        const areaIdValue = area_id === '' || area_id === null || area_id === undefined
            ? null
            : parseInt(area_id, 10);
        const finalAreaId = Number.isNaN(areaIdValue) ? null : areaIdValue;

        const isEnabled = enabled === true || enabled === 1 ? 1 : (enabled === false || enabled === 0 ? 0 : 1);
        const isTunnel = is_tunnel === true || is_tunnel === 1 ? 1 : 0;
        const isRecordingEnabled = deliveryConfig.deliveryType === 'internal_hls' && (enable_recording === true || enable_recording === 1) ? 1 : 0;

        const latValue = latitude !== undefined && latitude !== '' && latitude !== null ? parseFloat(latitude) : null;
        const lngValue = longitude !== undefined && longitude !== '' && longitude !== null ? parseFloat(longitude) : null;
        const lat = Number.isNaN(latValue) ? null : latValue;
        const lng = Number.isNaN(lngValue) ? null : lngValue;

        const durationValue = recording_duration_hours !== undefined && recording_duration_hours !== '' && recording_duration_hours !== null
            ? parseInt(recording_duration_hours, 10)
            : 5;
        const recordingDuration = Number.isNaN(durationValue) ? 5 : durationValue;

        const cameraStatus = status || 'active';

        const result = execute(
            'INSERT INTO cameras (name, private_rtsp_url, description, location, group_name, area_id, enabled, is_tunnel, latitude, longitude, status, stream_key, enable_recording, recording_duration_hours, video_codec, stream_source, delivery_type, external_hls_url, external_stream_url, external_embed_url, external_snapshot_url, external_origin_mode, external_use_proxy, external_tls_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                name,
                deliveryConfig.deliveryType === 'internal_hls' ? private_rtsp_url : '',
                description || null,
                location || null,
                group_name || null,
                finalAreaId,
                isEnabled,
                isTunnel,
                lat,
                lng,
                cameraStatus,
                streamKey,
                isRecordingEnabled,
                recordingDuration,
                codecValue,
                deliveryConfig.compatStreamSource,
                deliveryConfig.deliveryType,
                deliveryConfig.externalHlsUrl,
                deliveryConfig.externalStreamUrl,
                deliveryConfig.externalEmbedUrl,
                deliveryConfig.externalSnapshotUrl,
                deliveryConfig.externalOriginMode,
                externalUseProxy,
                externalTlsMode,
            ]
        );

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CREATE_CAMERA', `Created camera: ${name}`, request.ip]
        );

        logCameraCreated({
            cameraId: result.lastInsertRowid,
            cameraName: name,
            createdByUserId: request.user.id,
            createdByUsername: request.user.username
        }, request);

        this.invalidateCameraCache();

        if (isEnabled && deliveryConfig.deliveryType === 'internal_hls') {
            try {
                const mtxResult = await mediaMtxService.updateCameraPath(streamKey, private_rtsp_url);
                if (!mtxResult.success) {
                    console.error(`[Camera] Failed to add MediaMTX path for camera ${result.lastInsertRowid}:`, mtxResult.error);
                }
            } catch (err) {
                console.error('MediaMTX add path error:', err.message);
            }
        }

        if (isEnabled && isRecordingEnabled && deliveryConfig.deliveryType === 'internal_hls') {
            try {
                const { recordingService } = await import('./recordingService.js');
                console.log(`[Camera ${result.lastInsertRowid}] Auto-starting recording (camera created with recording enabled)`);
                await recordingService.startRecording(result.lastInsertRowid);
            } catch (err) {
                console.error(`[Camera ${result.lastInsertRowid}] Failed to start recording:`, err.message);
            }
        }

        return {
            id: result.lastInsertRowid,
            name,
            stream_key: streamKey,
        };
    }

    async updateCamera(id, data, request, options = {}) {
        const {
            name,
            private_rtsp_url,
            description,
            location,
            group_name,
            area_id,
            enabled,
            is_tunnel,
            latitude,
            longitude,
            status,
            enable_recording,
            recording_duration_hours,
            video_codec,
            stream_source,
            delivery_type,
            external_hls_url,
            external_stream_url,
            external_embed_url,
            external_snapshot_url,
            external_origin_mode,
            external_use_proxy,
            external_tls_mode,
        } = data;

        const existingCamera = queryOne(
            `SELECT id, name, private_rtsp_url, enabled, stream_key, enable_recording, stream_source,
                    delivery_type, external_hls_url, external_stream_url, external_embed_url,
                    external_snapshot_url,
                    CASE
                        WHEN external_origin_mode IN ('direct', 'embed') THEN external_origin_mode
                        ELSE 'direct'
                    END as external_origin_mode,
                    COALESCE(external_use_proxy, 1) as external_use_proxy,
                    CASE
                        WHEN external_tls_mode IN ('strict', 'insecure') THEN external_tls_mode
                        ELSE 'strict'
                    END as external_tls_mode
             FROM cameras WHERE id = ?`,
            [id]
        );

        if (!existingCamera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }
        if (stream_source !== undefined && !['internal', 'external'].includes(stream_source)) {
            const err = new Error('Invalid stream source. Must be internal or external');
            err.statusCode = 400;
            throw err;
        }
        if (delivery_type !== undefined && !DELIVERY_TYPES.includes(delivery_type)) {
            const err = new Error('Invalid delivery type');
            err.statusCode = 400;
            throw err;
        }

        let streamKey = existingCamera.stream_key;
        if (!streamKey) {
            streamKey = uuidv4();
            execute('UPDATE cameras SET stream_key = ? WHERE id = ?', [streamKey, id]);
            console.log(`[Camera] Generated stream_key for legacy camera ${id}: ${streamKey}`);
        }

        const deliveryConfig = normalizeCameraPersistencePayload({
            stream_source,
            delivery_type,
            private_rtsp_url: private_rtsp_url !== undefined ? private_rtsp_url : existingCamera.private_rtsp_url,
            external_hls_url,
            external_stream_url,
            external_embed_url,
            external_snapshot_url,
            external_origin_mode,
        }, existingCamera, options);

        const updates = [];
        const values = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (private_rtsp_url !== undefined) {
            updates.push('private_rtsp_url = ?');
            values.push(private_rtsp_url || '');
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description || null);
        }
        if (location !== undefined) {
            updates.push('location = ?');
            values.push(location || null);
        }
        if (group_name !== undefined) {
            updates.push('group_name = ?');
            values.push(group_name || null);
        }
        if (area_id !== undefined) {
            updates.push('area_id = ?');
            const areaIdValue = area_id === '' || area_id === null ? null : parseInt(area_id, 10);
            values.push(Number.isNaN(areaIdValue) ? null : areaIdValue);
        }
        if (enabled !== undefined) {
            updates.push('enabled = ?');
            values.push(enabled === true || enabled === 1 ? 1 : 0);
        }
        if (is_tunnel !== undefined) {
            updates.push('is_tunnel = ?');
            values.push(is_tunnel === true || is_tunnel === 1 ? 1 : 0);
        }
        if (latitude !== undefined) {
            updates.push('latitude = ?');
            const latValue = latitude === '' || latitude === null ? null : parseFloat(latitude);
            values.push(Number.isNaN(latValue) ? null : latValue);
        }
        if (longitude !== undefined) {
            updates.push('longitude = ?');
            const lngValue = longitude === '' || longitude === null ? null : parseFloat(longitude);
            values.push(Number.isNaN(lngValue) ? null : lngValue);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status || 'active');
        }
        if (enable_recording !== undefined) {
            updates.push('enable_recording = ?');
            values.push(deliveryConfig.deliveryType === 'internal_hls' && (enable_recording === true || enable_recording === 1) ? 1 : 0);
        }
        if (recording_duration_hours !== undefined) {
            updates.push('recording_duration_hours = ?');
            const durationValue = recording_duration_hours === '' || recording_duration_hours === null ? null : parseInt(recording_duration_hours, 10);
            values.push(Number.isNaN(durationValue) ? null : durationValue);
        }
        if (video_codec !== undefined) {
            if (!['h264', 'h265'].includes(video_codec)) {
                const err = new Error('Invalid video codec. Must be h264 or h265');
                err.statusCode = 400;
                throw err;
            }
            updates.push('video_codec = ?');
            values.push(video_codec);
        }
        if (stream_source !== undefined || delivery_type !== undefined || external_hls_url !== undefined || external_stream_url !== undefined || external_embed_url !== undefined || external_snapshot_url !== undefined || external_origin_mode !== undefined) {
            updates.push('stream_source = ?');
            values.push(deliveryConfig.compatStreamSource);
            updates.push('delivery_type = ?');
            values.push(deliveryConfig.deliveryType);
            updates.push('external_hls_url = ?');
            values.push(deliveryConfig.externalHlsUrl);
            updates.push('external_stream_url = ?');
            values.push(deliveryConfig.externalStreamUrl);
            updates.push('external_embed_url = ?');
            values.push(deliveryConfig.externalEmbedUrl);
            updates.push('external_snapshot_url = ?');
            values.push(deliveryConfig.externalSnapshotUrl);
            updates.push('external_origin_mode = ?');
            values.push(deliveryConfig.externalOriginMode);
        }
        if (external_use_proxy !== undefined) {
            updates.push('external_use_proxy = ?');
            values.push(external_use_proxy === false || external_use_proxy === 0 ? 0 : 1);
        }
        if (external_tls_mode !== undefined) {
            if (!['strict', 'insecure'].includes(external_tls_mode)) {
                const err = new Error('Invalid external TLS mode. Must be strict or insecure');
                err.statusCode = 400;
                throw err;
            }
            updates.push('external_tls_mode = ?');
            values.push(external_tls_mode);
        }

        if (updates.length === 0) {
            const err = new Error('No fields to update');
            err.statusCode = 400;
            throw err;
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        execute(
            `UPDATE cameras SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'UPDATE_CAMERA', `Updated camera ID: ${id}`, request.ip]
        );

        logCameraUpdated({
            cameraId: parseInt(id),
            cameraName: existingCamera.name,
            updatedByUserId: request.user.id,
            updatedByUsername: request.user.username,
            changes: { name, description, location, group_name, area_id, enabled }
        }, request);

        this.invalidateCameraCache();

        const currentDeliveryType = deliveryConfig.deliveryType;
        const newEnabled = enabled !== undefined ? enabled : existingCamera.enabled;
        const newRtspUrl = private_rtsp_url !== undefined ? private_rtsp_url : existingCamera.private_rtsp_url;
        const rtspChanged = private_rtsp_url !== undefined && private_rtsp_url !== existingCamera.private_rtsp_url;
        const enabledChanged = enabled !== undefined && enabled !== existingCamera.enabled;

        // If stream source changed to external, remove MediaMTX path
        if (currentDeliveryType !== 'internal_hls') {
            try {
                await mediaMtxService.removeCameraPathByKey(streamKey);
            } catch (err) {
                console.error('MediaMTX remove path error (switched to external):', err.message);
            }
        } else if (newEnabled === 0 || newEnabled === false) {
            try {
                await mediaMtxService.removeCameraPathByKey(streamKey);
            } catch (err) {
                console.error('MediaMTX remove path error:', err.message);
            }
        } else if (rtspChanged || (enabledChanged && newEnabled)) {
            try {
                const mtxResult = await mediaMtxService.updateCameraPath(streamKey, newRtspUrl);
                if (!mtxResult.success) {
                    console.error(`[Camera] Failed to update MediaMTX path for camera ${id}:`, mtxResult.error);
                }
            } catch (err) {
                console.error('MediaMTX update path error:', err.message);
            }
        }

        if (enable_recording !== undefined) {
            const { recordingService } = await import('./recordingService.js');
            const newRecordingEnabled = enable_recording === true || enable_recording === 1;
            const oldRecordingEnabled = existingCamera.enable_recording === 1;
            const cameraEnabled = (newEnabled === 1 || newEnabled === true);

            if (newRecordingEnabled !== oldRecordingEnabled) {
                if (newRecordingEnabled && cameraEnabled && currentDeliveryType === 'internal_hls') {
                    console.log(`[Camera ${id}] Auto-starting recording (enable_recording changed to true)`);
                    try {
                        await recordingService.startRecording(parseInt(id));
                    } catch (err) {
                        console.error(`[Camera ${id}] Failed to start recording:`, err.message);
                    }
                } else if (!newRecordingEnabled) {
                    console.log(`[Camera ${id}] Auto-stopping recording (enable_recording changed to false)`);
                    try {
                        await recordingService.stopRecording(parseInt(id));
                    } catch (err) {
                        console.error(`[Camera ${id}] Failed to stop recording:`, err.message);
                    }
                }
            }
        }
    }

    async deleteCamera(id, request) {
        const camera = queryOne('SELECT id, name, stream_key FROM cameras WHERE id = ?', [id]);

        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        execute('DELETE FROM cameras WHERE id = ?', [id]);

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'DELETE_CAMERA', `Deleted camera: ${camera.name} (ID: ${id})`, request.ip]
        );

        logCameraDeleted({
            cameraId: parseInt(id),
            cameraName: camera.name,
            deletedByUserId: request.user.id,
            deletedByUsername: request.user.username
        }, request);

        this.invalidateCameraCache();

        try {
            if (camera.stream_key) {
                await mediaMtxService.removeCameraPathByKey(camera.stream_key);
            }
        } catch (err) {
            console.error('MediaMTX remove path error:', err.message);
        }
    }

    async bulkDeleteArea(areaId, request) {
        if (!areaId) {
            const err = new Error('Area ID is required');
            err.statusCode = 400;
            throw err;
        }

        const area = queryOne('SELECT name FROM areas WHERE id = ?', [areaId]);
        if (!area) {
            const err = new Error('Area not found');
            err.statusCode = 404;
            throw err;
        }

        const cameras = query('SELECT id, name, stream_key FROM cameras WHERE area_id = ?', [areaId]);
        if (cameras.length === 0) return { deletedCount: 0 };

        transaction(() => {
            execute('DELETE FROM cameras WHERE area_id = ?', [areaId]);
            
            execute(
                'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
                [request.user.id, 'DELETE_BULK_CAMERAS', `Deleted ${cameras.length} cameras from area: ${area.name}`, request.ip]
            );
        })();

        this.invalidateCameraCache();

        // Async cleanup (like MediaMTX paths)
        for (const camera of cameras) {
            logCameraDeleted({
                cameraId: camera.id,
                cameraName: camera.name,
                deletedByUserId: request.user.id,
                deletedByUsername: request.user.username
            }, request);

            if (camera.stream_key) {
                try {
                    await mediaMtxService.removeCameraPathByKey(camera.stream_key);
                } catch (err) {
                    console.error(`MediaMTX remove path error for ${camera.stream_key}:`, err.message);
                }
            }
        }

        return { deletedCount: cameras.length };
    }

    async bulkUpdateArea(areaId, bulkRequest, request) {
        if (!areaId) {
            const err = new Error('Area ID is required');
            err.statusCode = 400;
            throw err;
        }

        const area = queryOne('SELECT id, name FROM areas WHERE id = ?', [areaId]);
        if (!area) {
            const err = new Error('Area not found');
            err.statusCode = 404;
            throw err;
        }

        const { targetFilter, operation, payload, preview } = normalizeBulkAreaRequest(bulkRequest);

        if (!BULK_AREA_TARGET_FILTERS.includes(targetFilter)) {
            const err = new Error('Invalid bulk target filter');
            err.statusCode = 400;
            throw err;
        }

        if (!BULK_AREA_OPERATIONS.includes(operation)) {
            const err = new Error('Invalid bulk area operation');
            err.statusCode = 400;
            throw err;
        }

        const cameras = query(
            `SELECT c.*
             FROM cameras c
             WHERE c.area_id = ?
             ORDER BY c.id ASC`,
            [areaId]
        );

        const targetCameras = cameras.filter((camera) => matchesBulkTargetFilter(camera, targetFilter));
        const summary = buildBulkTargetSummary(targetCameras, {
            totalInArea: cameras.length,
            operation,
            payload,
        });

        if (preview && targetCameras.length === 0) {
            return {
                preview: true,
                area: { id: area.id, name: area.name },
                targetFilter,
                operation,
                summary,
                guidance: cameras.length === 0
                    ? 'Area ini belum memiliki kamera.'
                    : (targetFilter === 'external_hls_only'
                        ? 'Area ini memiliki kamera, tetapi tidak ada kamera external_hls yang eligible untuk policy proxy/TLS/origin.'
                        : 'Tidak ada kamera yang cocok dengan target filter yang dipilih.'),
            };
        }

        if (targetCameras.length === 0) {
            const err = new Error(
                cameras.length === 0
                    ? 'Area ini belum memiliki kamera'
                    : (targetFilter === 'external_hls_only'
                        ? 'Area ini memiliki kamera, tetapi tidak ada kamera external_hls yang eligible untuk policy proxy/TLS/origin.'
                        : 'No cameras matched the selected bulk target filter')
            );
            err.statusCode = 400;
            throw err;
        }

        if (requiresExternalHlsAreaPolicy(operation, payload) && targetFilter !== 'external_hls_only') {
            const err = new Error('Proxy/TLS/origin policy hanya boleh diterapkan dengan target filter external_hls_only.');
            err.statusCode = 400;
            throw err;
        }

        if (preview && summary.eligibleCount === 0) {
            return {
                preview: true,
                area: { id: area.id, name: area.name },
                targetFilter,
                operation,
                summary,
                guidance: 'Tidak ada kamera yang eligible untuk operasi ini. Tinjau blocked reasons sebelum apply.',
            };
        }

        if (summary.eligibleCount === 0) {
            const err = new Error('Tidak ada kamera yang eligible untuk operasi ini.');
            err.statusCode = 400;
            throw err;
        }

        const patches = [];

        for (const camera of targetCameras) {
            const deliveryProfile = getCameraDeliveryProfile(camera);
            const eligibility = getBulkEligibility(camera, operation, payload);
            if (!eligibility.eligible) {
                continue;
            }
            const patch = {};

            if (operation === 'policy_update' || operation === 'maintenance') {
                if (payload.enabled !== undefined) {
                    patch.enabled = payload.enabled;
                }
                if (payload.enable_recording !== undefined) {
                    patch.enable_recording = payload.enable_recording;
                }
                if (payload.video_codec !== undefined) {
                    patch.video_codec = payload.video_codec;
                }
                if (payload.delivery_type !== undefined) {
                    if (!DELIVERY_TYPES.includes(payload.delivery_type) || payload.delivery_type === 'internal_hls') {
                        const err = new Error('Bulk policy delivery type must be one of the persisted external delivery types.');
                        err.statusCode = 400;
                        throw err;
                    }
                    patch.delivery_type = payload.delivery_type;
                    patch.stream_source = 'external';
                }
                if (payload.external_origin_mode !== undefined) {
                    patch.external_origin_mode = payload.external_origin_mode;
                }
                if (payload.external_use_proxy !== undefined) {
                    patch.external_use_proxy = payload.external_use_proxy;
                }
                if (payload.external_tls_mode !== undefined) {
                    patch.external_tls_mode = payload.external_tls_mode;
                }
            }

            if (operation === 'normalization') {
                patch.stream_source = 'external';
                if (payload.clear_internal_rtsp) {
                    patch.private_rtsp_url = null;
                }

                if (payload.delivery_type !== undefined) {
                    if (!DELIVERY_TYPES.includes(payload.delivery_type) || payload.delivery_type === 'internal_hls') {
                        const err = new Error('Normalization delivery type must be one of the persisted external delivery types.');
                        err.statusCode = 400;
                        throw err;
                    }

                    const validationCandidate = {
                        ...camera,
                        stream_source: 'external',
                        delivery_type: payload.delivery_type,
                        private_rtsp_url: payload.clear_internal_rtsp ? null : camera.private_rtsp_url,
                    };

                    normalizeCameraPersistencePayload(validationCandidate, camera, {
                        allowIncompleteExternalMetadata: true,
                    });
                    patch.delivery_type = payload.delivery_type;
                }
            }

            if (Object.keys(patch).length > 0) {
                patches.push({ camera, patch });
            }
        }

        if (patches.length === 0) {
            const err = new Error('No valid bulk changes were produced for the selected cameras');
            err.statusCode = 400;
            throw err;
        }

        if (preview) {
            return {
                preview: true,
                area: { id: area.id, name: area.name },
                targetFilter,
                operation,
                summary,
                guidance: operation === 'normalization' && summary.unresolvedCount > 0
                    ? 'Sebagian kamera unresolved tetap membutuhkan Backup Restore untuk mengisi metadata source sebelum dianggap external valid.'
                    : null,
            };
        }

        let changes = 0;
        for (const item of patches) {
            await this.updateCamera(item.camera.id, {
                ...item.patch,
                private_rtsp_url: toNullableRtspValue(item.patch.private_rtsp_url),
            }, request, {
                allowIncompleteExternalMetadata: operation === 'normalization',
            });
            changes += 1;
        }

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [
                request.user.id,
                'BULK_UPDATE_AREA',
                `Bulk ${operation} on area ${area.name} (${area.id}) with target ${targetFilter}. Updated ${changes} cameras.`,
                request.ip || 'Unknown'
            ]
        );

        this.invalidateCameraCache();

        return {
            success: true,
            area: { id: area.id, name: area.name },
            targetFilter,
            operation,
            changes,
            summary,
            guidance: operation === 'normalization' && summary.unresolvedCount > 0
                ? 'Sebagian kamera unresolved masih membutuhkan Backup Restore untuk memulihkan URL source dari file backup.'
                : null,
        };
    }

    buildCameraRestorePreview(restoreRequest) {
        const normalizedRequest = normalizeRestoreRequest(restoreRequest);
        const { backupItems, matchMode, scope, applyPolicy } = normalizedRequest;

        if (applyPolicy !== 'repair_existing') {
            const err = new Error('Only repair_existing restore policy is supported');
            err.statusCode = 400;
            throw err;
        }

        if (!backupItems.length) {
            const err = new Error('Backup items are required');
            err.statusCode = 400;
            throw err;
        }

        const areas = query('SELECT id, name FROM areas ORDER BY id ASC');
        const cameras = query(
            `SELECT c.*, a.name as area_name
             FROM cameras c
             LEFT JOIN areas a ON c.area_id = a.id
             ORDER BY c.id ASC`
        );
        const areasById = new Map(areas.map((area) => [area.id, area]));
        const areasByName = new Map(areas.map((area) => [normalizeLookupKey(area.name), area]));

        let scopedCameras = cameras;
        if (scope.mode === 'unresolved_only') {
            scopedCameras = scopedCameras.filter((camera) => getCameraDeliveryProfile(camera).classification === 'external_unresolved');
        } else if (scope.mode === 'area_ids') {
            const areaIdSet = new Set(scope.areaIds);
            scopedCameras = scopedCameras.filter((camera) => areaIdSet.has(camera.area_id));
        }

        const camerasById = new Map(scopedCameras.map((camera) => [camera.id, camera]));
        const camerasByNameArea = new Map();
        for (const camera of scopedCameras) {
            const key = buildNameAreaKey(camera.name, camera.area_name);
            if (!camerasByNameArea.has(key)) {
                camerasByNameArea.set(key, []);
            }
            camerasByNameArea.get(key).push(camera);
        }

        const rows = backupItems.map((backupItem, index) => {
            const sourceMetadata = buildRestoreSourceMetadata(backupItem);
            const backupLabel = sourceMetadata.name || `Backup row ${index + 1}`;

            if (!sourceMetadata.name) {
                return {
                    status: 'invalid_backup_row',
                    reason: 'missing_name',
                    matchReason: null,
                    backupId: sourceMetadata.id,
                    backupName: backupLabel,
                    backupAreaName: sourceMetadata.areaName || null,
                    targetCameraId: null,
                    targetCameraName: null,
                    targetAreaName: null,
                    changedFields: [],
                };
            }

            const backupArea = sourceMetadata.areaName
                ? areasByName.get(normalizeLookupKey(sourceMetadata.areaName)) || null
                : null;

            let targetCamera = null;
            let matchReason = null;
            let ambiguousMatches = [];

            if (matchMode === 'id_then_name_area' && sourceMetadata.id !== null && camerasById.has(sourceMetadata.id)) {
                targetCamera = camerasById.get(sourceMetadata.id);
                matchReason = 'matched_by_id';
            } else {
                const key = buildNameAreaKey(sourceMetadata.name, sourceMetadata.areaName);
                const candidates = camerasByNameArea.get(key) || [];
                if (candidates.length === 1) {
                    targetCamera = candidates[0];
                    matchReason = 'matched_by_name_area';
                } else if (candidates.length > 1) {
                    ambiguousMatches = candidates;
                }
            }

            if (ambiguousMatches.length > 0) {
                return {
                    status: 'ambiguous_matches',
                    reason: 'multiple_candidates',
                    matchReason: null,
                    backupId: sourceMetadata.id,
                    backupName: backupLabel,
                    backupAreaName: sourceMetadata.areaName || null,
                    targetCameraId: null,
                    targetCameraName: null,
                    targetAreaName: null,
                    changedFields: [],
                    candidates: ambiguousMatches.slice(0, 5).map((camera) => ({
                        id: camera.id,
                        name: camera.name,
                        area_name: camera.area_name || null,
                    })),
                };
            }

            if (!targetCamera) {
                return {
                    status: 'missing_target',
                    reason: backupArea ? 'camera_not_found_in_scope' : 'target_missing',
                    matchReason: null,
                    backupId: sourceMetadata.id,
                    backupName: backupLabel,
                    backupAreaName: sourceMetadata.areaName || null,
                    targetCameraId: null,
                    targetCameraName: null,
                    targetAreaName: backupArea?.name || null,
                    changedFields: [],
                };
            }

            let patch;
            try {
                patch = buildRestorePatch(targetCamera, sourceMetadata);
            } catch (error) {
                return {
                    status: 'invalid_backup_row',
                    reason: 'backup_missing_source',
                    matchReason,
                    backupId: sourceMetadata.id,
                    backupName: backupLabel,
                    backupAreaName: sourceMetadata.areaName || null,
                    targetCameraId: targetCamera.id,
                    targetCameraName: targetCamera.name,
                    targetAreaName: targetCamera.area_name || null,
                    changedFields: [],
                    error: error.message,
                };
            }

            const changedFields = getRestoreChangedFields(targetCamera, patch);
            const status = changedFields.length > 0 ? 'matched_repairable' : 'matched_no_changes';
            const targetProfile = getCameraDeliveryProfile(targetCamera);

            return {
                status,
                reason: status === 'matched_no_changes' ? 'already_in_sync' : null,
                matchReason,
                backupId: sourceMetadata.id,
                backupName: backupLabel,
                backupAreaName: sourceMetadata.areaName || null,
                backupDeliveryType: sourceMetadata.deliveryType,
                targetDeliveryClassification: targetProfile.classification,
                targetEffectiveDeliveryType: targetProfile.effectiveDeliveryType,
                targetCameraId: targetCamera.id,
                targetCameraName: targetCamera.name,
                targetAreaName: targetCamera.area_name || null,
                changedFields,
                patch,
            };
        });

        const summary = buildRestoreResultSummary(rows);
        return {
            backupFileName: normalizedRequest.backupFileName,
            matchMode,
            scope,
            applyPolicy,
            summary: {
                ...summary,
                counts: summary.counts,
            },
            rows,
            canApply: summary.canApply,
        };
    }

    previewCameraRestore(restoreRequest) {
        const preview = this.buildCameraRestorePreview(restoreRequest);
        return {
            backupFileName: preview.backupFileName,
            matchMode: preview.matchMode,
            scope: preview.scope,
            applyPolicy: preview.applyPolicy,
            summary: preview.summary,
            counts: preview.summary.counts,
            canApply: preview.canApply,
            rows: preview.rows.map(({ patch, ...row }) => row),
        };
    }

    async applyCameraRestore(restoreRequest, request) {
        const preview = this.buildCameraRestorePreview(restoreRequest);
        const repairableRows = preview.rows.filter((row) => row.status === 'matched_repairable');

        if (!repairableRows.length) {
            const err = new Error('No repairable cameras were found in the backup preview');
            err.statusCode = 400;
            throw err;
        }

        let repaired = 0;
        for (const row of repairableRows) {
            await this.updateCamera(row.targetCameraId, {
                ...row.patch,
                private_rtsp_url: toNullableRtspValue(row.patch.private_rtsp_url),
            }, request);
            repaired += 1;
        }

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [
                request.user.id,
                'RESTORE_CAMERAS',
                `Restored ${repaired} cameras from backup ${preview.backupFileName || 'uploaded JSON'}`,
                request.ip || 'Unknown',
            ]
        );

        logAdminAction({
            action: 'BACKUP_RESTORE_APPLIED',
            repaired_count: repaired,
            backup_file_name: preview.backupFileName,
            skipped_count: preview.summary.counts.matched_no_changes + preview.summary.counts.missing_target + preview.summary.counts.ambiguous_matches + preview.summary.counts.invalid_backup_row,
            ambiguous_count: preview.summary.counts.ambiguous_matches,
            invalid_count: preview.summary.counts.invalid_backup_row,
        }, request);

        this.invalidateCameraCache();

        return {
            repaired,
            skipped: preview.summary.counts.matched_no_changes + preview.summary.counts.missing_target + preview.summary.counts.ambiguous_matches + preview.summary.counts.invalid_backup_row,
            counts: preview.summary.counts,
            backupFileName: preview.backupFileName,
        };
    }

    importCamerasTransaction(cameras, targetAreaName, request) {
        if (!cameras || !Array.isArray(cameras) || cameras.length === 0) return { imported: 0, skipped: 0, errors: [] };

        // 1. Ensure target area exists
        let areaId = null;
        const existingArea = queryOne('SELECT id FROM areas WHERE name = ? COLLATE NOCASE', [targetAreaName]);
        if (existingArea) {
            areaId = existingArea.id;
        } else {
            const insertArea = execute('INSERT INTO areas (name, description) VALUES (?, ?)', [targetAreaName, 'Auto-created during bulk import']);
            areaId = insertArea.lastInsertRowid;
        }

        // 2. Fetch existing cameras for duplicate checking (O(1) lookups)
        const allCameras = query('SELECT name, private_rtsp_url, external_hls_url, external_stream_url, external_embed_url FROM cameras');
        const existingNames = new Set(allCameras.map(c => c.name ? c.name.toLowerCase() : ''));
        const existingUrls = new Set();
        allCameras.forEach(c => {
            if (c.private_rtsp_url) existingUrls.add(c.private_rtsp_url.toLowerCase());
            if (c.external_hls_url) existingUrls.add(c.external_hls_url.toLowerCase());
            if (c.external_stream_url) existingUrls.add(c.external_stream_url.toLowerCase());
            if (c.external_embed_url) existingUrls.add(c.external_embed_url.toLowerCase());
        });

        // 3. Define the bulk insert operation via transaction
        const performImport = transaction((cameraList) => {
            let importedCount = 0;
            let skippedCount = 0;
            const errors = [];

            for (const cam of cameraList) {
                const rawName = cam.name || cam.title || cam.cctv_title || '';
                const rawSourceUrl = cam.external_stream_url || cam.external_hls_url || cam.url || cam.stream || cam.cctv_link || null;
                const rawRtspUrl = cam.private_rtsp_url || null;
                const rawEmbedUrl = cam.external_embed_url || cam.embed_url || cam.page_url || null;
                const rawSnapshotUrl = cam.external_snapshot_url || cam.thumbnail_url || cam.snapshot_url || null;
                const rawLat = cam.latitude !== undefined ? cam.latitude : (cam.lat !== undefined ? cam.lat : null);
                const rawLng = cam.longitude !== undefined ? cam.longitude : (cam.lng !== undefined ? cam.lng : null);

                const name = rawName ? String(rawName).trim() : '';
                const sourceUrl = rawSourceUrl ? String(rawSourceUrl).trim() : null;
                const rtspUrl = rawRtspUrl ? String(rawRtspUrl).trim() : null;
                const embedUrl = rawEmbedUrl ? String(rawEmbedUrl).trim() : null;
                const snapshotUrl = rawSnapshotUrl ? String(rawSnapshotUrl).trim() : null;
                const inferredDeliveryType = getEffectiveDeliveryType({
                    stream_source: cam.stream_source || (rtspUrl ? 'internal' : 'external'),
                    delivery_type: cam.delivery_type,
                    external_hls_url: cam.external_hls_url || null,
                    external_stream_url: sourceUrl,
                    external_embed_url: embedUrl,
                });
                
                // Duplicate Validation
                if (!name) {
                    errors.push(`Skipped: Missing name`);
                    skippedCount++;
                    continue;
                }
                
                if (existingNames.has(name.toLowerCase())) {
                    errors.push(`Skipped '${name}': Name already exists in database`);
                    skippedCount++;
                    continue;
                }

                const urlToCheck = sourceUrl || embedUrl || rtspUrl;
                if (urlToCheck && existingUrls.has(urlToCheck.toLowerCase())) {
                    errors.push(`Skipped '${name}': Stream URL is already used by another camera`);
                    skippedCount++;
                    continue;
                }

                const importDeliveryConfig = normalizeCameraPersistencePayload({
                    delivery_type: inferredDeliveryType,
                    stream_source: cam.stream_source,
                    private_rtsp_url: rtspUrl,
                    external_hls_url: inferredDeliveryType === 'external_hls' ? sourceUrl : null,
                    external_stream_url: sourceUrl,
                    external_embed_url: embedUrl,
                    external_snapshot_url: snapshotUrl,
                    external_origin_mode: cam.external_origin_mode,
                });
                const streamKey = uuidv4();
                execute(
                    'INSERT INTO cameras (name, private_rtsp_url, description, location, area_id, enabled, is_tunnel, latitude, longitude, status, stream_key, enable_recording, stream_source, delivery_type, external_hls_url, external_stream_url, external_embed_url, external_snapshot_url, external_origin_mode, external_use_proxy, external_tls_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        name,
                        rtspUrl || '',
                        cam.description || null,
                        cam.location || null,
                        areaId,
                        cam.enabled === false || cam.enabled === 0 ? 0 : 1,
                        0, // is_tunnel
                        rawLat !== null ? parseFloat(rawLat) : null,
                        rawLng !== null ? parseFloat(rawLng) : null,
                        'active',
                        streamKey,
                        importDeliveryConfig.deliveryType === 'internal_hls' && (cam.enable_recording === true || cam.enable_recording === 1) ? 1 : 0,
                        importDeliveryConfig.compatStreamSource,
                        importDeliveryConfig.deliveryType,
                        importDeliveryConfig.externalHlsUrl,
                        importDeliveryConfig.externalStreamUrl,
                        importDeliveryConfig.externalEmbedUrl,
                        importDeliveryConfig.externalSnapshotUrl,
                        importDeliveryConfig.externalOriginMode,
                        cam.external_use_proxy !== undefined ? cam.external_use_proxy : 1, // dynamically read from frontend overlay
                        cam.external_tls_mode || 'strict' // external_tls_mode
                    ]
                );
                
                // Prevent duplicates within the import payload itself
                existingNames.add(name.toLowerCase());
                if (urlToCheck) existingUrls.add(urlToCheck.toLowerCase());
                importedCount++;
            }

            return { imported: importedCount, skipped: skippedCount, errors };
        });

        // Execute transaction
        const result = performImport(cameras);

        // Audit Log and Cache Invalidations (outside transaction)
        if (result.imported > 0) {
            execute(
                'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
                [request.user.id, 'IMPORT_CAMERAS', `Bulk imported ${result.imported} cameras to area: ${targetAreaName}`, request.ip || 'Unknown']
            );
            this.invalidateCameraCache();
        }

        return result;
    }
}

export default new CameraService();
