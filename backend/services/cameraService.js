/*
Purpose: Camera CRUD, import/export, delivery policy normalization, and bulk area update orchestration.
Caller: Backend routes, background services, and admin operations.
Deps: connectionPool, camera delivery utilities, audit logger, cache middleware, health/runtime services.
MainFuncs: CameraService CRUD methods, bulkUpdateArea(), delivery normalization helpers.
SideEffects: Reads/writes camera data, updates runtime services, invalidates caches, writes audit logs.
*/

import axios from 'axios';
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
import { cacheGetOrSetSync, cacheInvalidate, cacheKey, CacheNamespace } from './cacheService.js';
import { sanitizeCameraThumbnail, sanitizeCameraThumbnailList } from './thumbnailPathService.js';
import cameraHealthService from './cameraHealthService.js';
import cameraRuntimeStateService from './cameraRuntimeStateService.js';
import {
    DELIVERY_TYPES,
    DELIVERY_TYPE_PATTERNS,
    EXTERNAL_HEALTH_MODES,
    getCameraDeliveryProfile,
    getCompatStreamSource,
    getEffectiveDeliveryType,
    getPrimaryExternalStreamUrl,
    normalizeExternalHealthMode,
    normalizeExternalOriginMode,
} from '../utils/cameraDelivery.js';
import {
    normalizeInternalIngestPolicy,
    normalizeOnDemandCloseAfterSeconds,
} from '../utils/internalIngestPolicy.js';

const BULK_AREA_TARGET_FILTERS = [
    'all',
    'internal_only',
    'external_only',
    'external_streams_only',
    'external_hls_only',
    'external_mjpeg_only',
    'external_probeable_only',
    'external_passive_only',
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

const IMPORT_DUPLICATE_MODES = [
    'skip_existing_name_or_url',
];

const IMPORT_AREA_MODES = [
    'single_target_area',
];

const IMPORT_SOURCE_FILTER_MODES = [
    'all',
    'online_only',
    'offline_only',
];

const IMPORT_SNAPSHOT_HANDLING_MODES = [
    'preserve',
    'clear',
    'derive_if_supported',
];

const IMPORT_LOCATION_MAPPING_MODES = [
    'name',
    'source_field',
    'area_plus_name',
];

const IMPORT_PRESET_PROFILES = [
    'generic_hls',
    'generic_mjpeg',
    'embed_only',
    'internal_rtsp_live_only',
    'jombang_mjpeg',
    'surakarta_flv',
];

const PUBLIC_PLAYBACK_MODES = [
    'inherit',
    'disabled',
    'preview_only',
    'admin_only',
];

const PUBLIC_PLAYBACK_PREVIEW_MINUTES = new Set([0, 10, 20, 30, 60]);
const CAMERA_READ_MODEL_TTL_MS = 15 * 1000;
const RECORDABLE_DELIVERY_TYPES = new Set(['internal_hls', 'external_hls']);

const CAMERA_RUNTIME_STATE_PROJECTION = `
    COALESCE(crs.is_online, c.is_online, 0) as is_online,
    COALESCE(crs.monitoring_state, CASE WHEN c.is_online = 1 THEN 'online' WHEN c.is_online = 0 THEN 'offline' ELSE 'unknown' END) as monitoring_state,
    COALESCE(crs.monitoring_reason, NULL) as monitoring_reason,
    COALESCE(crs.last_runtime_signal_at, NULL) as last_runtime_signal_at,
    COALESCE(crs.last_runtime_signal_type, NULL) as last_runtime_signal_type,
    COALESCE(crs.last_health_check_at, c.last_online_check) as last_health_check_at,
    COALESCE(crs.updated_at, c.last_online_check) as runtime_state_updated_at
`;

const PUBLIC_MAP_CAMERA_PROJECTION = `
    c.id,
    c.name,
    c.description,
    c.location,
    c.group_name,
    c.area_id,
    c.is_tunnel,
    c.latitude,
    c.longitude,
    c.status,
    c.enabled,
    c.thumbnail_path,
    c.thumbnail_updated_at,
    c.delivery_type,
    c.enable_recording,
    a.name as area_name,
    ${CAMERA_RUNTIME_STATE_PROJECTION}
`;

const PUBLIC_LANDING_CAMERA_PROJECTION = `
    c.id,
    c.name,
    c.description,
    c.location,
    c.group_name,
    c.area_id,
    c.is_tunnel,
    c.latitude,
    c.longitude,
    c.status,
    c.enabled,
    c.enable_recording,
    c.video_codec,
    c.stream_key,
    c.thumbnail_path,
    c.thumbnail_updated_at,
    c.stream_source,
    c.external_hls_url,
    c.delivery_type,
    c.external_stream_url,
    c.external_embed_url,
    c.external_snapshot_url,
    CASE
        WHEN c.external_origin_mode IN ('direct', 'embed') THEN c.external_origin_mode
        ELSE 'direct'
    END as external_origin_mode,
    COALESCE(c.external_use_proxy, 1) as external_use_proxy,
    CASE
        WHEN c.external_tls_mode IN ('strict', 'insecure') THEN c.external_tls_mode
        ELSE 'strict'
    END as external_tls_mode,
    CASE
        WHEN c.external_health_mode IN ('default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled') THEN c.external_health_mode
        ELSE 'default'
    END as external_health_mode,
    a.name as area_name,
    CASE
        WHEN a.external_health_mode_override IN ('default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled')
            THEN a.external_health_mode_override
        ELSE 'default'
    END as area_external_health_mode_override,
    ${CAMERA_RUNTIME_STATE_PROJECTION}
`;

const ADMIN_CAMERA_LIST_PROJECTION = `
    c.id,
    c.name,
    c.description,
    c.location,
    c.group_name,
    c.area_id,
    c.enabled,
    c.is_tunnel,
    c.latitude,
    c.longitude,
    c.status,
    c.enable_recording,
    CASE
        WHEN c.internal_ingest_policy_override IN ('default', 'always_on', 'on_demand') THEN c.internal_ingest_policy_override
        ELSE 'default'
    END as internal_ingest_policy_override,
    c.internal_on_demand_close_after_seconds_override,
    c.source_profile,
    c.recording_duration_hours,
    c.recording_status,
    c.last_recording_start,
    c.video_codec,
    c.stream_key,
    c.stream_source,
    c.delivery_type,
    c.external_hls_url,
    c.external_stream_url,
    c.external_embed_url,
    c.external_snapshot_url,
    c.external_origin_mode,
    c.external_use_proxy,
    c.external_tls_mode,
    c.external_health_mode,
    c.public_playback_mode,
    c.public_playback_preview_minutes,
    c.thumbnail_path,
    c.thumbnail_updated_at,
    c.created_at,
    c.updated_at,
    a.name as area_name,
    CASE
        WHEN a.external_health_mode_override IN ('default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled')
            THEN a.external_health_mode_override
        ELSE 'default'
    END as area_external_health_mode_override,
    CASE
        WHEN a.internal_ingest_policy_default IN ('default', 'always_on', 'on_demand')
            THEN a.internal_ingest_policy_default
        ELSE 'default'
    END as area_internal_ingest_policy_default,
    a.internal_on_demand_close_after_seconds as area_internal_on_demand_close_after_seconds,
    ${CAMERA_RUNTIME_STATE_PROJECTION}
`;

function normalizePublicPlaybackMode(value) {
    return PUBLIC_PLAYBACK_MODES.includes(value) ? value : 'inherit';
}

function normalizePublicPlaybackPreviewMinutes(value) {
    if (value === undefined) {
        return undefined;
    }

    if (value === null || value === '') {
        return null;
    }

    const parsed = parseInt(value, 10);
    if (!PUBLIC_PLAYBACK_PREVIEW_MINUTES.has(parsed)) {
        const err = new Error('Invalid public playback preview minutes');
        err.statusCode = 400;
        throw err;
    }

    return parsed;
}

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

    if (deliveryType === 'external_flv') {
        if (!externalStreamUrl) {
            if (allowIncompleteExternalMetadata) {
                return;
            }
            const err = new Error('External FLV URL is required for FLV cameras');
            err.statusCode = 400;
            throw err;
        }
        if (!DELIVERY_TYPE_PATTERNS.http.test(externalStreamUrl)) {
            const err = new Error('External FLV URL must start with http:// or https://');
            err.statusCode = 400;
            throw err;
        }
        if (!DELIVERY_TYPE_PATTERNS.flvHint.test(externalStreamUrl)) {
            const err = new Error('External FLV URL must end with .flv');
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

function extractImportItems(importRequest = {}) {
    if (Array.isArray(importRequest)) {
        return importRequest;
    }

    if (Array.isArray(importRequest?.cameras)) {
        return importRequest.cameras;
    }

    if (Array.isArray(importRequest?.data)) {
        return importRequest.data;
    }

    return [];
}

function normalizeImportRequest(importRequest = {}, legacyTargetArea = null) {
    if (Array.isArray(importRequest)) {
        return {
            targetArea: typeof legacyTargetArea === 'string' ? legacyTargetArea.trim() : '',
            cameras: importRequest,
            globalOverrides: {},
            importPolicy: {
                duplicateMode: 'skip_existing_name_or_url',
                areaMode: 'single_target_area',
                normalizeNames: true,
                dropOfflineSourceRows: false,
                filterSourceRows: 'all',
                snapshotHandling: 'preserve',
                locationMapping: 'name',
            },
            sourceProfile: null,
        };
    }

    const importPolicy = importRequest.importPolicy || {};

    return {
        targetArea: typeof importRequest.targetArea === 'string'
            ? importRequest.targetArea.trim()
            : (typeof legacyTargetArea === 'string' ? legacyTargetArea.trim() : ''),
        cameras: extractImportItems(importRequest),
        globalOverrides: importRequest.globalOverrides || {},
        importPolicy: {
            duplicateMode: IMPORT_DUPLICATE_MODES.includes(importPolicy.duplicateMode)
                ? importPolicy.duplicateMode
                : 'skip_existing_name_or_url',
            areaMode: IMPORT_AREA_MODES.includes(importPolicy.areaMode)
                ? importPolicy.areaMode
                : 'single_target_area',
            normalizeNames: importPolicy.normalizeNames !== false,
            dropOfflineSourceRows: Boolean(importPolicy.dropOfflineSourceRows),
            filterSourceRows: IMPORT_SOURCE_FILTER_MODES.includes(importPolicy.filterSourceRows)
                ? importPolicy.filterSourceRows
                : 'all',
            snapshotHandling: IMPORT_SNAPSHOT_HANDLING_MODES.includes(importPolicy.snapshotHandling)
                ? importPolicy.snapshotHandling
                : 'preserve',
            locationMapping: IMPORT_LOCATION_MAPPING_MODES.includes(importPolicy.locationMapping)
                ? importPolicy.locationMapping
                : 'name',
        },
        sourceProfile: IMPORT_PRESET_PROFILES.includes(importRequest.sourceProfile)
            ? importRequest.sourceProfile
            : null,
    };
}

function normalizeImportName(name, shouldNormalize = true) {
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (!shouldNormalize) {
        return normalized;
    }

    return normalized.replace(/\s+/g, ' ');
}

function inferImportDeliveryType(url, embedUrl = null, streamSource = null) {
    const normalizedUrl = typeof url === 'string' ? url.trim() : '';
    const normalizedEmbedUrl = typeof embedUrl === 'string' ? embedUrl.trim() : '';

    if ((streamSource || '').toLowerCase() === 'internal') {
        return 'internal_hls';
    }
    if (DELIVERY_TYPE_PATTERNS.websocket.test(normalizedUrl)) {
        return DELIVERY_TYPE_PATTERNS.jsmpegHint.test(normalizedUrl)
            ? 'external_jsmpeg'
            : 'external_custom_ws';
    }
    if (DELIVERY_TYPE_PATTERNS.zoneminderMjpeg.test(normalizedUrl)) {
        return 'external_mjpeg';
    }
    if (DELIVERY_TYPE_PATTERNS.flvHint.test(normalizedUrl)) {
        return 'external_flv';
    }
    if (DELIVERY_TYPE_PATTERNS.hlsHint.test(normalizedUrl)) {
        return 'external_hls';
    }
    if (DELIVERY_TYPE_PATTERNS.http.test(normalizedEmbedUrl) && !normalizedUrl) {
        return 'external_embed';
    }
    if (DELIVERY_TYPE_PATTERNS.http.test(normalizedUrl)) {
        return 'external_mjpeg';
    }

    return 'external_embed';
}

function extractWrappedExternalTarget(url) {
    const normalizedUrl = typeof url === 'string' ? url.trim() : '';
    if (!normalizedUrl) {
        return null;
    }

    const hashIndex = normalizedUrl.indexOf('#');
    if (hashIndex === -1) {
        return null;
    }

    const fragment = normalizedUrl.slice(hashIndex + 1).trim();
    if (/^https?:\/\//i.test(fragment) || /^wss?:\/\//i.test(fragment)) {
        return fragment;
    }

    return null;
}

function normalizeImportStatus(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'online') {
        return 'online';
    }
    if (normalized === 'offline') {
        return 'offline';
    }
    return 'unknown';
}

function applyDescriptionTemplate(template, tokens) {
    if (typeof template !== 'string' || template.trim() === '') {
        return null;
    }

    return template.replace(/\{(\w+)\}/g, (_, key) => {
        const value = tokens[key];
        return value === undefined || value === null ? '' : String(value);
    }).replace(/\s+\|\s+\|\s+/g, ' | ').trim();
}

function deriveSnapshotUrl(sourceRow = {}, snapshotHandling = 'preserve') {
    if (snapshotHandling === 'clear') {
        return null;
    }

    const existingSnapshot = sourceRow.external_snapshot_url
        || sourceRow.thumbnail_url
        || sourceRow.snapshot_url
        || null;

    if (existingSnapshot) {
        return existingSnapshot;
    }

    if (snapshotHandling === 'derive_if_supported') {
        return null;
    }

    return null;
}

function buildImportFieldMapping(sourceProfile = null) {
    if (sourceProfile === 'internal_rtsp_live_only') {
        return {
            name: 'name',
            streamUrl: 'private_rtsp_url (private only)',
            coordinates: 'latitude/longitude | lat/lng',
            sourceStatus: 'status',
            sourceCategory: 'source_tag',
            location: 'location | area_name | name',
        };
    }

    if (sourceProfile === 'jombang_mjpeg') {
        return {
            name: 'nama',
            streamUrl: 'url',
            coordinates: 'lat + lng',
            sourceStatus: 'status',
            sourceCategory: 'kategori',
            location: 'nama',
        };
    }

    if (sourceProfile === 'surakarta_flv') {
        return {
            name: 'title',
            streamUrl: 'arguments[0] fragment -> direct .flv URL',
            embedUrl: 'arguments[0] wrapper URL',
            coordinates: 'none',
            sourceStatus: 'implicit_online',
            sourceCategory: 'source_profile',
            location: 'title',
        };
    }

    return {
        name: 'name | title | cctv_title',
        streamUrl: 'external_stream_url | external_hls_url | url | stream | cctv_link',
        embedUrl: 'external_embed_url | embed_url | page_url',
        coordinates: 'latitude/longitude | lat/lng',
        sourceStatus: 'status',
        sourceCategory: 'kategori | category',
        location: 'location',
    };
}

function getImportProfileDefaults(sourceProfile = null) {
    switch (sourceProfile) {
        case 'internal_rtsp_live_only':
            return {
                delivery_type: 'internal_hls',
                enabled: 1,
                external_use_proxy: 0,
                external_tls_mode: 'strict',
                external_health_mode: 'default',
                external_origin_mode: 'direct',
                descriptionTemplate: 'SOURCE: PRIVATE RTSP LIVE ONLY | source_tag: {sourceTag} | notes: {notes}',
                locationMapping: 'source_field',
                source_profile: 'surabaya_private_rtsp',
                internal_ingest_policy_override: 'on_demand',
                internal_on_demand_close_after_seconds_override: 15,
            };
        case 'jombang_mjpeg':
            return {
                delivery_type: 'external_mjpeg',
                external_use_proxy: 1,
                external_tls_mode: 'strict',
                external_health_mode: 'passive_first',
                external_origin_mode: 'direct',
                enabled: 1,
                descriptionTemplate: 'SOURCE: JOMBANG V2 | kategori: {sourceCategory} | source_status: {sourceStatus}',
                locationMapping: 'name',
            };
        case 'generic_hls':
            return {
                delivery_type: 'external_hls',
                external_use_proxy: 1,
                external_tls_mode: 'strict',
                external_health_mode: 'hybrid_probe',
                external_origin_mode: 'direct',
                enabled: 1,
            };
        case 'generic_mjpeg':
            return {
                delivery_type: 'external_mjpeg',
                external_use_proxy: 1,
                external_tls_mode: 'strict',
                external_health_mode: 'passive_first',
                external_origin_mode: 'direct',
                enabled: 1,
            };
        case 'surakarta_flv':
            return {
                delivery_type: 'external_flv',
                external_use_proxy: 0,
                external_tls_mode: 'strict',
                external_health_mode: 'passive_first',
                external_origin_mode: 'direct',
                enabled: 1,
                descriptionTemplate: 'SOURCE: SURAKARTA FLV | source_profile: {sourceProfile}',
                locationMapping: 'name',
            };
        case 'embed_only':
            return {
                delivery_type: 'external_embed',
                external_use_proxy: 0,
                external_tls_mode: 'strict',
                external_health_mode: 'passive_first',
                external_origin_mode: 'embed',
                enabled: 1,
            };
        default:
            return {};
    }
}

function sourceFilterMatches(filterMode, sourceStatus) {
    if (filterMode === 'online_only') {
        return sourceStatus === 'online';
    }

    if (filterMode === 'offline_only') {
        return sourceStatus === 'offline';
    }

    return true;
}

function isInternalRtspLiveOnlyProfile(sourceProfile = null) {
    return sourceProfile === 'internal_rtsp_live_only';
}

function isInternalRtspImportRow(item = {}, sourceProfile = null) {
    const privateRtspUrl = typeof item.private_rtsp_url === 'string'
        ? item.private_rtsp_url.trim()
        : '';
    return isInternalRtspLiveOnlyProfile(sourceProfile) || Boolean(privateRtspUrl);
}

function maskSensitiveImportUrl(url, deliveryType) {
    if (deliveryType !== 'internal_hls' || typeof url !== 'string' || !url.trim()) {
        return url || null;
    }

    try {
        const parsed = new URL(url);
        const protocol = parsed.protocol || 'rtsp:';
        const host = parsed.hostname || '***';
        const port = parsed.port ? `:${parsed.port}` : '';
        const path = parsed.pathname || '';

        if (parsed.username || parsed.password) {
            const username = parsed.username ? decodeURIComponent(parsed.username) : 'user';
            return `${protocol}//${username}:***@${host}${port}${path}`;
        }

        return `${protocol}//${host}${port}${path}`;
    } catch {
        return 'rtsp://***';
    }
}

function buildImportWarnings(rows = [], sourceProfile = null) {
    const warningMap = new Map();

    const addWarning = (code, message) => {
        const current = warningMap.get(code) || { code, message, count: 0 };
        current.count += 1;
        warningMap.set(code, current);
    };

    for (const row of rows) {
        if (row.resolvedDeliveryType === 'external_mjpeg' && typeof row.resolvedUrl === 'string' && row.resolvedUrl.includes('token=')) {
            addWarning('tokenized_mjpeg_url', 'Beberapa URL MJPEG menggunakan token yang bisa berubah atau kedaluwarsa.');
        }
        if (
            ['external_mjpeg', 'external_embed', 'external_jsmpeg', 'external_custom_ws'].includes(row.resolvedDeliveryType)
            && !row.resolvedSnapshotUrl
        ) {
            addWarning('missing_snapshot', 'Sebagian kamera external non-HLS tidak memiliki snapshot URL.');
        }
        if (row.reason === 'duplicate_payload_url') {
            addWarning('duplicate_payload_url', 'Ada URL stream yang berulang di dalam payload import.');
        }
    }

    if (sourceProfile === 'jombang_mjpeg') {
        addWarning('jombang_tokenized_source', 'Preset Jombang v2 menggunakan MJPEG tokenized. Passive-first direkomendasikan.');
    }

    if (sourceProfile === 'internal_rtsp_live_only') {
        addWarning('private_rtsp_live_only', 'Profile ini private-only. RTSP tetap backend secret, preview/export umum akan disanitasi, dan recording dipaksa nonaktif.');
    }

    return Array.from(warningMap.values()).sort((left, right) => right.count - left.count);
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
        case 'external_streams_only':
            return deliveryProfile.classification !== 'internal_hls'
                && deliveryProfile.classification !== 'external_unresolved';
        case 'external_hls_only':
            return deliveryProfile.classification !== 'external_unresolved'
                && deliveryProfile.effectiveDeliveryType === 'external_hls';
        case 'external_mjpeg_only':
            return deliveryProfile.classification !== 'external_unresolved'
                && deliveryProfile.effectiveDeliveryType === 'external_mjpeg';
        case 'external_probeable_only':
            return ['external_hls', 'external_mjpeg', 'external_embed'].includes(deliveryProfile.effectiveDeliveryType);
        case 'external_passive_only':
            return ['external_flv', 'external_embed', 'external_jsmpeg', 'external_custom_ws'].includes(deliveryProfile.effectiveDeliveryType);
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

function isRecordingDisable(payload = {}) {
    return payload.enable_recording === 0 || payload.enable_recording === false;
}

function isRecordingEnable(payload = {}) {
    return payload.enable_recording === 1 || payload.enable_recording === true;
}

function isRecordableDeliveryType(deliveryType) {
    return RECORDABLE_DELIVERY_TYPES.has(deliveryType);
}

function isPublicStatusDisable(payload = {}) {
    return payload.enabled === 0 || payload.enabled === false;
}

function isHealthMonitoringDisable(payload = {}) {
    return payload.external_health_mode === 'disabled';
}

function isBulkSafeDisablePatch(patch = {}) {
    const patchKeys = Object.keys(patch);
    return patchKeys.length > 0
        && patchKeys.every((key) => ['enabled', 'enable_recording'].includes(key))
        && (patch.enabled === undefined || patch.enabled === 0 || patch.enabled === false)
        && (patch.enable_recording === undefined || patch.enable_recording === 0 || patch.enable_recording === false);
}

function requiresExternalHlsAreaPolicy(operation, payload = {}) {
    if (operation !== 'policy_update' && operation !== 'maintenance') {
        return false;
    }

    return payload.external_use_proxy !== undefined
        || payload.external_tls_mode !== undefined
        || payload.external_origin_mode !== undefined;
}

function requiresExternalStreamAreaPolicy(operation, payload = {}) {
    if (operation !== 'policy_update' && operation !== 'maintenance') {
        return false;
    }

    return isHealthMonitoringDisable(payload) || payload.external_health_mode !== undefined;
}

function getBulkEligibility(camera, operation, payload = {}) {
    const deliveryProfile = getCameraDeliveryProfile(camera);
    const effectiveDeliveryType = payload.delivery_type || deliveryProfile.effectiveDeliveryType;
    const isAreaPolicyOperation = operation === 'policy_update' || operation === 'maintenance';

    if (isAreaPolicyOperation && isPublicStatusDisable(payload) && Object.keys(payload).length === 1) {
        return { eligible: true, reason: null };
    }

    if (isAreaPolicyOperation && isRecordingEnable(payload) && !isRecordingDisable(payload)) {
        if (deliveryProfile.classification !== 'internal_hls') {
            return { eligible: false, reason: 'internal_only_policy' };
        }
    }

    if (isAreaPolicyOperation && payload.video_codec !== undefined) {
        if (deliveryProfile.classification !== 'internal_hls') {
            return { eligible: false, reason: 'internal_only_policy' };
        }
    }

    if (requiresExternalHlsAreaPolicy(operation, payload) && effectiveDeliveryType !== 'external_hls') {
        return { eligible: false, reason: 'external_hls_only_policy' };
    }

    if (requiresExternalStreamAreaPolicy(operation, payload)) {
        if (deliveryProfile.classification === 'internal_hls') {
            return { eligible: false, reason: 'external_only_policy' };
        }
        if (deliveryProfile.classification === 'external_unresolved') {
            return { eligible: false, reason: 'external_metadata_required' };
        }
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
        deliveryTypeBreakdown: [],
        externalHealthModeBreakdown: [],
        total: targetCameras.length,
        examples: targetCameras.slice(0, 10).map((camera) => ({
            id: camera.id,
            name: camera.name,
            delivery_type: getCameraDeliveryProfile(camera).effectiveDeliveryType,
            delivery_classification: getCameraDeliveryProfile(camera).classification,
            is_online: camera.is_online === 1 || camera.is_online === true,
            external_health_mode: camera.external_health_mode || 'default',
        })),
        blockedExamples: [],
    };
    const blockedReasonMap = new Map();
    const deliveryTypeMap = new Map();
    const healthModeMap = new Map();

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
        deliveryTypeMap.set(
            deliveryProfile.effectiveDeliveryType,
            (deliveryTypeMap.get(deliveryProfile.effectiveDeliveryType) || 0) + 1
        );
        if (deliveryProfile.classification !== 'internal_hls') {
            const healthMode = camera.external_health_mode || 'default';
            healthModeMap.set(healthMode, (healthModeMap.get(healthMode) || 0) + 1);
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

    summary.blockedReasons = Array.from(blockedReasonMap.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);
    summary.deliveryTypeBreakdown = Array.from(deliveryTypeMap.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count);
    summary.externalHealthModeBreakdown = Array.from(healthModeMap.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count);

    return summary;
}

class CameraService {
    invalidateCameraCache() {
        invalidateCache('/api/cameras');
        invalidateCache('/api/stream');
        cacheInvalidate(`${CacheNamespace.CAMERAS}:`);
        cacheInvalidate(`${CacheNamespace.STATS}:camera-`);
        console.log('[Cache] Camera cache invalidated');
    }

    getAllCameras() {
        return this.getAdminCameraList();
    }

    getActiveCameras() {
        return this.getPublicLandingCameraList();
    }

    getCameraById(id) {
        return this.getCameraDetailById(id);
    }

    getPublicMapCameraList() {
        cameraRuntimeStateService.seedMissingRows();
        const key = cacheKey(CacheNamespace.CAMERAS, 'public-map-camera-list');
        return cacheGetOrSetSync(key, () => sanitizeCameraThumbnailList(query(`
            SELECT ${PUBLIC_MAP_CAMERA_PROJECTION}
            FROM cameras c
            LEFT JOIN areas a ON c.area_id = a.id
            LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id
            WHERE c.enabled = 1
            ORDER BY c.is_tunnel ASC, c.id ASC
        `)).map((camera) => cameraHealthService.enrichCameraAvailability(camera)), CAMERA_READ_MODEL_TTL_MS);
    }

    getPublicLandingCameraList() {
        cameraRuntimeStateService.seedMissingRows();
        const key = cacheKey(CacheNamespace.CAMERAS, 'public-landing-camera-list');
        return cacheGetOrSetSync(key, () => sanitizeCameraThumbnailList(query(`
            SELECT ${PUBLIC_LANDING_CAMERA_PROJECTION}
            FROM cameras c
            LEFT JOIN areas a ON c.area_id = a.id
            LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id
            WHERE c.enabled = 1
            ORDER BY c.is_tunnel ASC, c.id ASC
        `)).map((camera) => cameraHealthService.enrichCameraAvailability(camera)), CAMERA_READ_MODEL_TTL_MS);
    }

    getAdminCameraList() {
        cameraRuntimeStateService.seedMissingRows();
        const key = cacheKey(CacheNamespace.CAMERAS, 'admin-camera-list');
        return cacheGetOrSetSync(key, () => sanitizeCameraThumbnailList(query(`
            SELECT ${ADMIN_CAMERA_LIST_PROJECTION}
            FROM cameras c
            LEFT JOIN areas a ON c.area_id = a.id
            LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id
            ORDER BY c.id ASC
        `)).map((camera) => cameraHealthService.enrichCameraAvailability(camera)), CAMERA_READ_MODEL_TTL_MS);
    }

    getCameraDetailById(id) {
        cameraRuntimeStateService.seedMissingRows();
        const camera = queryOne(
            `SELECT c.*, a.name as area_name,
                    CASE
                        WHEN a.external_health_mode_override IN ('default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled')
                            THEN a.external_health_mode_override
                        ELSE 'default'
                    END as area_external_health_mode_override,
                    ${CAMERA_RUNTIME_STATE_PROJECTION}
             FROM cameras c
             LEFT JOIN areas a ON c.area_id = a.id
             LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id
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
            external_health_mode,
            public_playback_mode,
            public_playback_preview_minutes,
            internal_ingest_policy_override,
            internal_on_demand_close_after_seconds_override,
            source_profile,
        } = data;
        const externalUseProxy = external_use_proxy === false || external_use_proxy === 0 ? 0 : 1;
        const externalTlsMode = external_tls_mode === 'insecure' ? 'insecure' : 'strict';
        const externalHealthMode = normalizeExternalHealthMode(external_health_mode);
        const publicPlaybackMode = normalizePublicPlaybackMode(public_playback_mode);
        const publicPlaybackPreviewMinutes = normalizePublicPlaybackPreviewMinutes(public_playback_preview_minutes);
        const internalIngestPolicyOverride = normalizeInternalIngestPolicy(internal_ingest_policy_override);
        const internalOnDemandCloseAfterSecondsOverride = normalizeOnDemandCloseAfterSeconds(
            internal_on_demand_close_after_seconds_override,
            null
        );

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

        if (external_health_mode !== undefined && !EXTERNAL_HEALTH_MODES.includes(external_health_mode)) {
            const err = new Error('Invalid external health mode');
            err.statusCode = 400;
            throw err;
        }

        if (public_playback_mode !== undefined && !PUBLIC_PLAYBACK_MODES.includes(public_playback_mode)) {
            const err = new Error('Invalid public playback mode');
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
        const isRecordingEnabled = isRecordableDeliveryType(deliveryConfig.deliveryType) && (enable_recording === true || enable_recording === 1) ? 1 : 0;

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
            'INSERT INTO cameras (name, private_rtsp_url, description, location, group_name, area_id, enabled, is_tunnel, latitude, longitude, status, stream_key, enable_recording, recording_duration_hours, video_codec, stream_source, delivery_type, external_hls_url, external_stream_url, external_embed_url, external_snapshot_url, external_origin_mode, external_use_proxy, external_tls_mode, external_health_mode, public_playback_mode, public_playback_preview_minutes, internal_ingest_policy_override, internal_on_demand_close_after_seconds_override, source_profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
                externalHealthMode,
                publicPlaybackMode,
                publicPlaybackPreviewMinutes,
                internalIngestPolicyOverride,
                internalOnDemandCloseAfterSecondsOverride,
                source_profile || null,
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

        if (isEnabled && isRecordingEnabled && isRecordableDeliveryType(deliveryConfig.deliveryType)) {
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
            external_health_mode,
            public_playback_mode,
            public_playback_preview_minutes,
            internal_ingest_policy_override,
            internal_on_demand_close_after_seconds_override,
            source_profile,
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
                    END as external_tls_mode,
                    CASE
                        WHEN external_health_mode IN ('default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled') THEN external_health_mode
                        ELSE 'default'
                    END as external_health_mode,
                    CASE
                        WHEN public_playback_mode IN ('inherit', 'disabled', 'preview_only', 'admin_only') THEN public_playback_mode
                        ELSE 'inherit'
                    END as public_playback_mode,
                    public_playback_preview_minutes,
                    CASE
                        WHEN internal_ingest_policy_override IN ('default', 'always_on', 'on_demand') THEN internal_ingest_policy_override
                        ELSE 'default'
                    END as internal_ingest_policy_override,
                    internal_on_demand_close_after_seconds_override,
                    source_profile
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

        if (external_health_mode !== undefined && !EXTERNAL_HEALTH_MODES.includes(external_health_mode)) {
            const err = new Error('Invalid external health mode');
            err.statusCode = 400;
            throw err;
        }

        if (public_playback_mode !== undefined && !PUBLIC_PLAYBACK_MODES.includes(public_playback_mode)) {
            const err = new Error('Invalid public playback mode');
            err.statusCode = 400;
            throw err;
        }
        if (internal_ingest_policy_override !== undefined && !['default', 'always_on', 'on_demand'].includes(internal_ingest_policy_override)) {
            const err = new Error('Invalid internal ingest policy override');
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
            stream_source: stream_source !== undefined ? stream_source : existingCamera.stream_source,
            delivery_type: delivery_type !== undefined ? delivery_type : existingCamera.delivery_type,
            private_rtsp_url: private_rtsp_url !== undefined ? private_rtsp_url : existingCamera.private_rtsp_url,
            external_hls_url: external_hls_url !== undefined ? external_hls_url : existingCamera.external_hls_url,
            external_stream_url: external_stream_url !== undefined ? external_stream_url : existingCamera.external_stream_url,
            external_embed_url: external_embed_url !== undefined ? external_embed_url : existingCamera.external_embed_url,
            external_snapshot_url: external_snapshot_url !== undefined ? external_snapshot_url : existingCamera.external_snapshot_url,
            external_origin_mode: external_origin_mode !== undefined ? external_origin_mode : existingCamera.external_origin_mode,
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
            values.push(isRecordableDeliveryType(deliveryConfig.deliveryType) && (enable_recording === true || enable_recording === 1) ? 1 : 0);
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
        if (external_health_mode !== undefined) {
            updates.push('external_health_mode = ?');
            values.push(normalizeExternalHealthMode(external_health_mode));
        }
        if (public_playback_mode !== undefined) {
            updates.push('public_playback_mode = ?');
            values.push(normalizePublicPlaybackMode(public_playback_mode));
        }
        if (public_playback_preview_minutes !== undefined) {
            updates.push('public_playback_preview_minutes = ?');
            values.push(normalizePublicPlaybackPreviewMinutes(public_playback_preview_minutes));
        }
        if (internal_ingest_policy_override !== undefined) {
            updates.push('internal_ingest_policy_override = ?');
            values.push(normalizeInternalIngestPolicy(internal_ingest_policy_override));
        }
        if (internal_on_demand_close_after_seconds_override !== undefined) {
            updates.push('internal_on_demand_close_after_seconds_override = ?');
            values.push(normalizeOnDemandCloseAfterSeconds(internal_on_demand_close_after_seconds_override, null));
        }
        if (source_profile !== undefined) {
            updates.push('source_profile = ?');
            values.push(source_profile || null);
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
                if (newRecordingEnabled && cameraEnabled && isRecordableDeliveryType(currentDeliveryType)) {
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

        const { targetFilter: requestedTargetFilter, operation, payload, preview } = normalizeBulkAreaRequest(bulkRequest);
        const targetFilter = requiresExternalHlsAreaPolicy(operation, payload)
            ? 'external_hls_only'
            : (requiresExternalStreamAreaPolicy(operation, payload)
                ? 'external_streams_only'
                : requestedTargetFilter);

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
                        : (targetFilter === 'external_streams_only'
                            ? 'Area ini memiliki kamera, tetapi tidak ada kamera external valid yang eligible untuk health monitoring policy.'
                            : 'Tidak ada kamera yang cocok dengan target filter yang dipilih.')),
            };
        }

        if (targetCameras.length === 0) {
            const err = new Error(
                cameras.length === 0
                    ? 'Area ini belum memiliki kamera'
                    : (targetFilter === 'external_hls_only'
                        ? 'Area ini memiliki kamera, tetapi tidak ada kamera external_hls yang eligible untuk policy proxy/TLS/origin.'
                        : (targetFilter === 'external_streams_only'
                            ? 'Area ini memiliki kamera, tetapi tidak ada kamera external valid yang eligible untuk health monitoring policy.'
                            : 'No cameras matched the selected bulk target filter'))
            );
            err.statusCode = 400;
            throw err;
        }

        if (preview && summary.eligibleCount === 0) {
            return {
                preview: true,
                area: { id: area.id, name: area.name },
                requestedTargetFilter,
                targetFilter,
                operation,
                summary,
                guidance: targetFilter !== requestedTargetFilter
                    ? (targetFilter === 'external_hls_only'
                        ? 'Target filter otomatis dikunci ke external_hls_only karena operasi ini hanya berlaku untuk kamera external HLS.'
                        : 'Target filter otomatis dikunci ke external_streams_only karena health monitoring policy hanya berlaku untuk kamera external yang valid.')
                    : 'Tidak ada kamera yang eligible untuk operasi ini. Tinjau blocked reasons sebelum apply.',
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
                if (payload.external_health_mode !== undefined) {
                    patch.external_health_mode = normalizeExternalHealthMode(payload.external_health_mode);
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
                requestedTargetFilter,
                targetFilter,
                operation,
                summary,
                guidance: targetFilter !== requestedTargetFilter
                    ? (targetFilter === 'external_hls_only'
                        ? 'Target filter otomatis dikunci ke external_hls_only karena operasi ini hanya berlaku untuk kamera external HLS.'
                        : 'Target filter otomatis dikunci ke external_streams_only karena health monitoring policy hanya berlaku untuk kamera external yang valid.')
                    : (operation === 'normalization' && summary.unresolvedCount > 0
                        ? 'Sebagian kamera unresolved tetap membutuhkan Backup Restore untuk mengisi metadata source sebelum dianggap external valid.'
                        : null),
            };
        }

        let changes = 0;
        for (const item of patches) {
            const allowIncompleteExternalMetadata = operation === 'normalization'
                || isBulkSafeDisablePatch(item.patch);
            await this.updateCamera(item.camera.id, {
                ...item.patch,
                private_rtsp_url: toNullableRtspValue(item.patch.private_rtsp_url),
            }, request, {
                allowIncompleteExternalMetadata,
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
            requestedTargetFilter,
            targetFilter,
            operation,
            changes,
            summary,
            guidance: targetFilter !== requestedTargetFilter
                ? (targetFilter === 'external_hls_only'
                    ? 'Target filter otomatis dikunci ke external_hls_only karena operasi ini hanya berlaku untuk kamera external HLS.'
                    : 'Target filter otomatis dikunci ke external_streams_only karena health monitoring policy hanya berlaku untuk kamera external yang valid.')
                : (operation === 'normalization' && summary.unresolvedCount > 0
                    ? 'Sebagian kamera unresolved masih membutuhkan Backup Restore untuk memulihkan URL source dari file backup.'
                    : null),
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

    async fetchImportSourceRows(sourceProfile) {
        if (sourceProfile === 'surakarta_flv') {
            const response = await axios.get('http://cariloka.com/atcscctvindon/cctvatcsindonlengkap/soloCCTV.json', {
                timeout: 15000,
                responseType: 'json',
                headers: {
                    Accept: 'application/json,text/plain,*/*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                },
            });

            const sourceRows = Array.isArray(response.data) ? response.data : [];
            return sourceRows.map((row, index) => {
                const wrapperUrl = Array.isArray(row.arguments) ? row.arguments[0] : null;
                const directUrl = extractWrappedExternalTarget(wrapperUrl);
                return {
                    title: row.title || '',
                    name: row.title || '',
                    location: row.title || '',
                    latitude: null,
                    longitude: null,
                    external_stream_url: directUrl,
                    external_embed_url: wrapperUrl,
                    delivery_type: 'external_flv',
                    stream_source: 'external',
                    external_use_proxy: 0,
                    external_tls_mode: 'strict',
                    external_health_mode: 'passive_first',
                    external_origin_mode: 'direct',
                    enabled: 1,
                    source_id: row.id || index + 1,
                    source_category: 'surakarta_flv',
                    source_status: 'online',
                    source_site: 'http://cariloka.com/atcscctvindon/cctvatcsindonlengkap/soloCCTV.json',
                    description: 'SOURCE: SURAKARTA FLV | source_profile: surakarta_flv',
                };
            });
        }

        if (sourceProfile !== 'jombang_mjpeg') {
            const err = new Error('Unsupported import source profile');
            err.statusCode = 400;
            throw err;
        }

        const response = await axios.get('https://cctv.jombangkab.go.id/v2/', {
            timeout: 15000,
            responseType: 'text',
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
        });

        const html = typeof response.data === 'string' ? response.data : '';
        const match = html.match(/const\s+cctvData\s*=\s*(\[[\s\S]*?\]);/);
        if (!match) {
            const err = new Error('Failed to extract Jombang CCTV dataset from source page');
            err.statusCode = 502;
            throw err;
        }

        const sourceRows = JSON.parse(match[1]);
        return sourceRows.map((row) => ({
            ...row,
            name: row.nama,
            location: row.nama,
            latitude: row.lat,
            longitude: row.lng,
            external_stream_url: row.url,
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
            external_use_proxy: 1,
            external_tls_mode: 'strict',
            external_health_mode: 'passive_first',
            external_origin_mode: 'direct',
            enabled: 1,
            source_id: row.id,
            source_category: row.kategori || null,
            source_status: normalizeImportStatus(row.status),
            source_site: 'https://cctv.jombangkab.go.id/v2/',
            description: `SOURCE: JOMBANG V2 | kategori: ${row.kategori || '-'} | source_status: ${normalizeImportStatus(row.status)}`,
        }));
    }

    async buildImportPlan(importRequest, legacyTargetArea = null) {
        const normalizedRequest = normalizeImportRequest(importRequest, legacyTargetArea);
        const profileDefaults = getImportProfileDefaults(normalizedRequest.sourceProfile);
        const globalOverrides = {
            ...profileDefaults,
            ...(normalizedRequest.globalOverrides || {}),
        };
        const effectiveSourceFilter = normalizedRequest.importPolicy.dropOfflineSourceRows
            && normalizedRequest.importPolicy.filterSourceRows === 'all'
            ? 'online_only'
            : normalizedRequest.importPolicy.filterSourceRows;

        const sourceRows = normalizedRequest.cameras.length > 0
            ? normalizedRequest.cameras
            : (normalizedRequest.sourceProfile
                ? await this.fetchImportSourceRows(normalizedRequest.sourceProfile)
                : []);

        if (!normalizedRequest.targetArea) {
            const err = new Error('Target area is required');
            err.statusCode = 400;
            throw err;
        }

        if (!sourceRows.length) {
            const err = new Error('No camera rows are available to import');
            err.statusCode = 400;
            throw err;
        }

        const allCameras = query('SELECT name, private_rtsp_url, external_hls_url, external_stream_url, external_embed_url FROM cameras');
        const seenNames = new Set(allCameras.map((camera) => normalizeLookupKey(camera.name)));
        const seenUrls = new Set();
        allCameras.forEach((camera) => {
            [camera.private_rtsp_url, camera.external_hls_url, camera.external_stream_url, camera.external_embed_url]
                .filter(Boolean)
                .forEach((url) => seenUrls.add(normalizeLookupKey(url)));
        });

        const rows = [];
        const importableRows = [];
        const deliveryTypeMap = new Map();
        const categoryMap = new Map();
        const sourceUrlMap = new Map();
        let onlineSourceCount = 0;
        let offlineSourceCount = 0;
        let missingCoordsCount = 0;

        for (let index = 0; index < sourceRows.length; index += 1) {
            const item = sourceRows[index] || {};
            const rawName = item.name || item.title || item.cctv_title || item.nama || '';
            const rawSourceUrl = item.external_stream_url || item.external_hls_url || item.url || item.stream || item.cctv_link || null;
            const rawRtspUrl = item.private_rtsp_url || null;
            const rawSourceTag = item.source_tag || null;
            const rawNotes = item.notes || null;
            const rawEmbedUrl = item.external_embed_url || item.embed_url || item.page_url || null;
            const wrappedSourceUrl = extractWrappedExternalTarget(rawSourceUrl) || extractWrappedExternalTarget(rawEmbedUrl);
            const effectiveSourceUrl = wrappedSourceUrl || rawSourceUrl;
            const effectiveEmbedUrl = rawEmbedUrl || rawSourceUrl || null;
            const rawLat = item.latitude !== undefined ? item.latitude : (item.lat !== undefined ? item.lat : null);
            const rawLng = item.longitude !== undefined ? item.longitude : (item.lng !== undefined ? item.lng : null);
            const sourceStatus = normalizeImportStatus(item.source_status || item.status || (normalizedRequest.sourceProfile === 'surakarta_flv' ? 'online' : null));
            const sourceCategory = item.source_category || item.kategori || item.category || rawSourceTag || (normalizedRequest.sourceProfile === 'surakarta_flv' ? 'surakarta_flv' : null);
            const forceInternalLiveOnly = isInternalRtspImportRow(item, normalizedRequest.sourceProfile);

            if (sourceStatus === 'online') {
                onlineSourceCount += 1;
            } else if (sourceStatus === 'offline') {
                offlineSourceCount += 1;
            }

            if (sourceCategory) {
                categoryMap.set(sourceCategory, (categoryMap.get(sourceCategory) || 0) + 1);
            }

            if (effectiveSourceUrl) {
                const urlKey = normalizeLookupKey(effectiveSourceUrl);
                sourceUrlMap.set(urlKey, (sourceUrlMap.get(urlKey) || 0) + 1);
            }

            if (!rawLat || !rawLng) {
                missingCoordsCount += 1;
            }

            const resolvedName = normalizeImportName(rawName, normalizedRequest.importPolicy.normalizeNames);
            const resolvedDeliveryType = forceInternalLiveOnly
                ? 'internal_hls'
                : (DELIVERY_TYPES.includes(globalOverrides.delivery_type)
                    ? globalOverrides.delivery_type
                    : getEffectiveDeliveryType({
                        stream_source: item.stream_source || (rawRtspUrl ? 'internal' : 'external'),
                        delivery_type: item.delivery_type || inferImportDeliveryType(effectiveSourceUrl, effectiveEmbedUrl, item.stream_source),
                        private_rtsp_url: rawRtspUrl,
                        external_hls_url: item.external_hls_url || null,
                        external_stream_url: effectiveSourceUrl,
                        external_embed_url: effectiveEmbedUrl,
                    }));
            const resolvedStreamSource = forceInternalLiveOnly || resolvedDeliveryType === 'internal_hls' ? 'internal' : 'external';
            const resolvedSourceUrl = typeof effectiveSourceUrl === 'string' ? effectiveSourceUrl.trim() : null;
            const resolvedEmbedUrl = typeof effectiveEmbedUrl === 'string' ? effectiveEmbedUrl.trim() : null;
            const snapshotHandling = IMPORT_SNAPSHOT_HANDLING_MODES.includes(globalOverrides.external_snapshot_url_handling)
                ? globalOverrides.external_snapshot_url_handling
                : normalizedRequest.importPolicy.snapshotHandling;
            const resolvedSnapshotUrl = deriveSnapshotUrl(item, snapshotHandling);
            const locationMapping = globalOverrides.syncLocationWithName
                ? 'name'
                : (IMPORT_LOCATION_MAPPING_MODES.includes(globalOverrides.locationMapping)
                    ? globalOverrides.locationMapping
                    : normalizedRequest.importPolicy.locationMapping);
            const resolvedLocation = locationMapping === 'area_plus_name'
                ? `${normalizedRequest.targetArea} - ${resolvedName}`
                : (locationMapping === 'source_field'
                    ? (item.location || item.alamat || item.address || item.area_name || resolvedName)
                    : resolvedName);
            const resolvedDescription = applyDescriptionTemplate(
                globalOverrides.descriptionTemplate || globalOverrides.description_template || profileDefaults.descriptionTemplate,
                {
                    name: resolvedName,
                    area: normalizedRequest.targetArea,
                    sourceCategory,
                    sourceStatus,
                    sourceProfile: normalizedRequest.sourceProfile || 'manual_upload',
                    description: item.description || '',
                    sourceTag: rawSourceTag || '',
                    notes: rawNotes || '',
                }
            ) || item.description || null;
            const resolvedTlsMode = globalOverrides.external_tls_mode || item.external_tls_mode || profileDefaults.external_tls_mode || 'strict';
            const resolvedHealthMode = normalizeExternalHealthMode(
                globalOverrides.external_health_mode
                || item.external_health_mode
                || profileDefaults.external_health_mode
            );
            const resolvedOriginMode = normalizeExternalOriginMode(
                globalOverrides.external_origin_mode
                || item.external_origin_mode
                || profileDefaults.external_origin_mode
            );
            const resolvedEnabled = globalOverrides.enabled !== undefined && globalOverrides.enabled !== null
                ? (globalOverrides.enabled === true || globalOverrides.enabled === 1 || globalOverrides.enabled === '1' ? 1 : 0)
                : (item.enabled === false || item.enabled === 0 ? 0 : 1);
            const resolvedProxy = globalOverrides.external_use_proxy !== undefined && globalOverrides.external_use_proxy !== null
                ? (globalOverrides.external_use_proxy === true || globalOverrides.external_use_proxy === 1 || globalOverrides.external_use_proxy === '1' ? 1 : 0)
                : (item.external_use_proxy !== undefined ? (item.external_use_proxy ? 1 : 0) : (profileDefaults.external_use_proxy !== undefined ? profileDefaults.external_use_proxy : 1));
            const resolvedRow = {
                index,
                sourceId: item.source_id || item.id || null,
                sourceCategory,
                sourceStatus,
                sourceSite: item.source_site || null,
                resolvedName,
                resolvedDeliveryType,
                resolvedUrl: resolvedDeliveryType === 'external_embed'
                    ? resolvedEmbedUrl
                    : (resolvedSourceUrl || rawRtspUrl || null),
                resolvedArea: normalizedRequest.targetArea,
                resolvedHealthMode,
                resolvedTlsMode,
                resolvedOriginMode,
                resolvedSnapshotUrl,
                resolvedLocation,
                resolvedStreamSource,
                resolvedRecordingEnabled: forceInternalLiveOnly ? 0 : null,
                sourceTag: rawSourceTag,
                sourceProfile: forceInternalLiveOnly
                    ? (item.source_profile || globalOverrides.source_profile || profileDefaults.source_profile || 'surabaya_private_rtsp')
                    : (item.source_profile || null),
                latitude: rawLat !== null && rawLat !== '' ? parseFloat(rawLat) : null,
                longitude: rawLng !== null && rawLng !== '' ? parseFloat(rawLng) : null,
                status: 'importable',
                reason: null,
                warnings: [],
                importData: null,
            };

            deliveryTypeMap.set(resolvedDeliveryType, (deliveryTypeMap.get(resolvedDeliveryType) || 0) + 1);

            if (!sourceFilterMatches(effectiveSourceFilter, sourceStatus)) {
                resolvedRow.status = 'filtered_out';
                resolvedRow.reason = 'source_filter_mismatch';
                rows.push(resolvedRow);
                continue;
            }

            if (!resolvedName) {
                resolvedRow.status = 'missing_required_field';
                resolvedRow.reason = 'missing_name';
                rows.push(resolvedRow);
                continue;
            }

            const duplicateNameKey = normalizeLookupKey(resolvedName);
            if (seenNames.has(duplicateNameKey)) {
                resolvedRow.status = 'duplicate_name';
                resolvedRow.reason = 'duplicate_existing_or_payload_name';
                rows.push(resolvedRow);
                continue;
            }

            const duplicateUrlKey = normalizeLookupKey(resolvedRow.resolvedUrl);
            if (duplicateUrlKey && seenUrls.has(duplicateUrlKey)) {
                resolvedRow.status = 'duplicate_url';
                resolvedRow.reason = 'duplicate_existing_or_payload_url';
                rows.push(resolvedRow);
                continue;
            }

            try {
                const deliveryConfig = normalizeCameraPersistencePayload({
                    stream_source: resolvedStreamSource,
                    delivery_type: resolvedDeliveryType,
                    private_rtsp_url: resolvedDeliveryType === 'internal_hls' ? rawRtspUrl : null,
                    external_hls_url: resolvedDeliveryType === 'external_hls' ? resolvedSourceUrl : null,
                    external_stream_url: resolvedDeliveryType === 'internal_hls' ? null : resolvedSourceUrl,
                    external_embed_url: resolvedEmbedUrl,
                    external_snapshot_url: resolvedSnapshotUrl,
                    external_origin_mode: resolvedOriginMode,
                });

                resolvedRow.importData = {
                    name: resolvedName,
                    private_rtsp_url: resolvedDeliveryType === 'internal_hls' ? (rawRtspUrl || '') : '',
                    description: resolvedDescription,
                    location: resolvedLocation,
                    enabled: resolvedEnabled,
                    latitude: resolvedRow.latitude,
                    longitude: resolvedRow.longitude,
                    enable_recording: deliveryConfig.deliveryType === 'internal_hls'
                        ? (forceInternalLiveOnly ? 0 : (item.enable_recording === true || item.enable_recording === 1 ? 1 : 0))
                        : 0,
                    internal_ingest_policy_override: deliveryConfig.deliveryType === 'internal_hls'
                        ? normalizeInternalIngestPolicy(
                            item.internal_ingest_policy_override
                            || globalOverrides.internal_ingest_policy_override
                            || profileDefaults.internal_ingest_policy_override
                            || 'default'
                        )
                        : 'default',
                    internal_on_demand_close_after_seconds_override: deliveryConfig.deliveryType === 'internal_hls'
                        ? normalizeOnDemandCloseAfterSeconds(
                            item.internal_on_demand_close_after_seconds_override
                            ?? globalOverrides.internal_on_demand_close_after_seconds_override
                            ?? profileDefaults.internal_on_demand_close_after_seconds_override
                            ?? null,
                            null
                        )
                        : null,
                    source_profile: deliveryConfig.deliveryType === 'internal_hls'
                        ? (resolvedRow.sourceProfile || null)
                        : null,
                    stream_source: deliveryConfig.compatStreamSource,
                    delivery_type: deliveryConfig.deliveryType,
                    external_hls_url: deliveryConfig.externalHlsUrl,
                    external_stream_url: deliveryConfig.externalStreamUrl,
                    external_embed_url: deliveryConfig.externalEmbedUrl,
                    external_snapshot_url: deliveryConfig.externalSnapshotUrl,
                    external_origin_mode: deliveryConfig.externalOriginMode,
                    external_use_proxy: resolvedProxy,
                    external_tls_mode: resolvedTlsMode === 'insecure' ? 'insecure' : 'strict',
                    external_health_mode: deliveryConfig.deliveryType === 'internal_hls' ? 'default' : resolvedHealthMode,
                };
                resolvedRow.resolvedRecordingEnabled = resolvedRow.importData.enable_recording;
                importableRows.push(resolvedRow);
                seenNames.add(duplicateNameKey);
                if (duplicateUrlKey) {
                    seenUrls.add(duplicateUrlKey);
                }
            } catch (error) {
                resolvedRow.status = resolvedName ? 'invalid_source' : 'missing_required_field';
                resolvedRow.reason = error.message;
                resolvedRow.importData = null;
            }

            rows.push(resolvedRow);
        }

        const summary = {
            totalRows: rows.length,
            importableCount: rows.filter((row) => row.status === 'importable').length,
            duplicateCount: rows.filter((row) => row.status === 'duplicate_name' || row.status === 'duplicate_url').length,
            invalidCount: rows.filter((row) => row.status === 'invalid_source' || row.status === 'missing_required_field').length,
            filteredOutCount: rows.filter((row) => row.status === 'filtered_out').length,
            onlineSourceCount,
            offlineSourceCount,
            deliveryTypeBreakdown: Array.from(deliveryTypeMap.entries()).map(([deliveryType, count]) => ({
                deliveryType,
                count,
            })).sort((left, right) => right.count - left.count),
        };

        return {
            targetArea: normalizedRequest.targetArea,
            sourceProfile: normalizedRequest.sourceProfile,
            sourceFieldMapping: buildImportFieldMapping(normalizedRequest.sourceProfile),
            sourceStats: {
                totalRows: sourceRows.length,
                onlineCount: onlineSourceCount,
                offlineCount: offlineSourceCount,
                unknownCount: sourceRows.length - onlineSourceCount - offlineSourceCount,
                missingCoordsCount,
                duplicateUrlCount: Array.from(sourceUrlMap.values()).filter((count) => count > 1).length,
                categoryBreakdown: Array.from(categoryMap.entries()).map(([category, count]) => ({ category, count })),
            },
            summary,
            rows: rows.map((row) => ({
                index: row.index,
                sourceId: row.sourceId,
                sourceCategory: row.sourceCategory,
                sourceStatus: row.sourceStatus,
                resolvedName: row.resolvedName,
                resolvedDeliveryType: row.resolvedDeliveryType,
                resolvedUrl: maskSensitiveImportUrl(row.resolvedUrl, row.resolvedDeliveryType),
                resolvedArea: row.resolvedArea,
                resolvedHealthMode: row.resolvedHealthMode,
                resolvedTlsMode: row.resolvedTlsMode,
                resolvedOriginMode: row.resolvedOriginMode,
                resolvedStreamSource: row.resolvedStreamSource,
                resolvedRecordingEnabled: row.resolvedRecordingEnabled,
                sourceTag: row.sourceTag,
                resolvedSnapshotUrl: row.resolvedSnapshotUrl,
                resolvedLocation: row.resolvedLocation,
                latitude: row.latitude,
                longitude: row.longitude,
                status: row.status,
                reason: row.reason,
            })),
            warnings: buildImportWarnings(rows, normalizedRequest.sourceProfile),
            canImport: importableRows.length > 0,
            importableRows,
        };
    }

    async previewImportCameras(importRequest, legacyTargetArea = null) {
        const plan = await this.buildImportPlan(importRequest, legacyTargetArea);
        return {
            targetArea: plan.targetArea,
            sourceProfile: plan.sourceProfile,
            fieldMapping: plan.sourceFieldMapping,
            sourceStats: plan.sourceStats,
            summary: plan.summary,
            rows: plan.rows,
            warnings: plan.warnings,
            canImport: plan.canImport,
        };
    }

    async importCamerasTransaction(importRequest, targetAreaName, request) {
        const plan = await this.buildImportPlan(importRequest, targetAreaName);
        if (!plan.importableRows.length) {
            const err = new Error('No importable cameras were found in the preview');
            err.statusCode = 400;
            throw err;
        }

        let areaId = null;
        const existingArea = queryOne('SELECT id FROM areas WHERE name = ? COLLATE NOCASE', [plan.targetArea]);
        if (existingArea) {
            areaId = existingArea.id;
        } else {
            const insertArea = execute('INSERT INTO areas (name, description) VALUES (?, ?)', [plan.targetArea, 'Auto-created during bulk import']);
            areaId = insertArea.lastInsertRowid;
        }

        const performImport = transaction((rowsToImport) => {
            let importedCount = 0;

            for (const row of rowsToImport) {
                const importData = row.importData;
                const streamKey = uuidv4();
                execute(
                    'INSERT INTO cameras (name, private_rtsp_url, description, location, area_id, enabled, is_tunnel, latitude, longitude, status, stream_key, enable_recording, stream_source, delivery_type, external_hls_url, external_stream_url, external_embed_url, external_snapshot_url, external_origin_mode, external_use_proxy, external_tls_mode, external_health_mode, internal_ingest_policy_override, internal_on_demand_close_after_seconds_override, source_profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        importData.name,
                        importData.private_rtsp_url || '',
                        importData.description || null,
                        importData.location || null,
                        areaId,
                        importData.enabled === 0 ? 0 : 1,
                        0,
                        importData.latitude,
                        importData.longitude,
                        'active',
                        streamKey,
                        importData.enable_recording === 1 ? 1 : 0,
                        importData.stream_source,
                        importData.delivery_type,
                        importData.external_hls_url,
                        importData.external_stream_url,
                        importData.external_embed_url,
                        importData.external_snapshot_url,
                        importData.external_origin_mode,
                        importData.external_use_proxy === 0 ? 0 : 1,
                        importData.external_tls_mode === 'insecure' ? 'insecure' : 'strict',
                        normalizeExternalHealthMode(importData.external_health_mode),
                        normalizeInternalIngestPolicy(importData.internal_ingest_policy_override),
                        normalizeOnDemandCloseAfterSeconds(importData.internal_on_demand_close_after_seconds_override, null),
                        importData.source_profile || null,
                    ]
                );
                importedCount += 1;
            }

            return importedCount;
        });

        const imported = performImport(plan.importableRows);
        const skipped = plan.summary.totalRows - imported;
        const importedInternalRows = plan.importableRows.filter((row) => (
            row.importData?.stream_source === 'internal'
            && row.importData?.delivery_type === 'internal_hls'
            && row.importData?.enabled !== 0
            && typeof row.importData?.private_rtsp_url === 'string'
            && row.importData.private_rtsp_url.startsWith('rtsp://')
        ));
        const errors = plan.rows
            .filter((row) => row.status !== 'importable')
            .map((row) => `Skipped '${row.resolvedName || `row ${row.index + 1}`}': ${row.reason || row.status}`);

        if (imported > 0) {
            execute(
                'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
                [
                    request.user.id,
                    'IMPORT_CAMERAS',
                    `Imported ${imported} cameras to area ${plan.targetArea}${plan.sourceProfile ? ` via source profile ${plan.sourceProfile}` : ''}`,
                    request.ip || 'Unknown',
                ]
            );
            this.invalidateCameraCache();

            if (importedInternalRows.length > 0) {
                try {
                    await mediaMtxService.syncCameras(1);
                } catch (error) {
                    console.error('[Camera Import] MediaMTX sync after internal import failed:', error.message);
                }
            }
        }

        return {
            imported,
            skipped,
            errors,
            summary: plan.summary,
            warnings: plan.warnings,
            sourceStats: plan.sourceStats,
        };
    }
}

export default new CameraService();
