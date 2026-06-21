/**
 * cameraImportHelpers.js
 * Purpose: Pure helpers + config constants for camera bulk-import (request/policy
 *   normalization, delivery inference, profile field-mapping/defaults, snapshot derivation,
 *   URL masking, warnings). Extracted verbatim from cameraService.js; behavior unchanged.
 * Caller: cameraService import methods (buildImportPlan / importCamerasTransaction / ...).
 * Deps: utils/cameraDelivery DELIVERY_TYPE_PATTERNS. No DB/class state.
 */
import { DELIVERY_TYPE_PATTERNS } from '../utils/cameraDelivery.js';

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

export {
    extractWrappedExternalTarget,
    normalizeImportStatus,
    normalizeImportRequest,
    getImportProfileDefaults,
    isInternalRtspImportRow,
    normalizeImportName,
    inferImportDeliveryType,
    deriveSnapshotUrl,
    applyDescriptionTemplate,
    sourceFilterMatches,
    buildImportFieldMapping,
    maskSensitiveImportUrl,
    buildImportWarnings,
    IMPORT_SNAPSHOT_HANDLING_MODES,
    IMPORT_LOCATION_MAPPING_MODES,
};
