import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import net from 'net';
import { config } from '../config/config.js';
import { query, queryOne, execute, transaction } from '../database/connectionPool.js';
import {
    sendCameraOfflineNotification,
    sendCameraOnlineNotification,
    isTelegramConfigured
} from './telegramService.js';
import { getTimezone } from './timezoneService.js';
import { recordingService } from './recordingService.js';
import thumbnailService from './thumbnailService.js';
import settingsService from './settingsService.js';
import cameraRuntimeStateService from './cameraRuntimeStateService.js';
import mediaMtxService from './mediaMtxService.js';
import {
    getCameraDeliveryProfile,
    getEffectiveDeliveryType,
    getPrimaryExternalStreamUrl,
    normalizeExternalHealthMode,
} from '../utils/cameraDelivery.js';
import {
    SHARED_CAMERA_STREAM_PROJECTION,
    SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION,
} from '../utils/cameraProjection.js';
import {
    buildInternalIngestPolicySummary,
    isStrictOnDemandSourceProfile,
} from '../utils/internalIngestPolicy.js';

const mediaMtxApiBaseUrl = `${(config.mediamtx?.apiUrl || 'http://localhost:9997').replace(/\/$/, '')}/v3`;

const EXTERNAL_REQUEST_TIMEOUT_MS = 10000;
const EXTERNAL_MAX_PDT_AGE_SEC = 120;
const EXTERNAL_STALE_SEQUENCE_THRESHOLD = 4; // Increased from 2 to 4 to tolerate CDN caching
const RUNTIME_SUCCESS_WINDOW_MS = 90 * 1000;
const MJPEG_RUNTIME_FRESH_WINDOW_MS = 60 * 1000;
const MJPEG_RUNTIME_GRACE_WINDOW_MS = 4 * 60 * 1000;
const MJPEG_PASSIVE_STALE_TIMEOUT_MS = 12 * 60 * 1000;
const HOT_CADENCE_MS = 20 * 1000;
const WARM_CADENCE_MS = 90 * 1000;
const COLD_CADENCE_MS = 5 * 60 * 1000;
const PASSIVE_ONLY_CADENCE_MS = 10 * 60 * 1000;
const CHECKPOINT_DB_WRITE_MS = 5 * 60 * 1000;
const DOMAIN_BACKOFF_BASE_MS = 60 * 1000;
const DOMAIN_BACKOFF_MAX_MS = 10 * 60 * 1000;
const HEALTH_LOOP_FLOOR_MS = 5 * 1000;
const HEALTH_LOOP_CEIL_MS = 30 * 1000;
const INTERNAL_PATH_REPAIR_BACKOFF_MS = 2 * 60 * 1000;

const PROBE_CACHE_TTLS_MS = {
    external_hls_playlist: 15 * 1000,
    external_mjpeg_stream_primary: 30 * 1000,
    external_snapshot_fallback: 45 * 1000,
    external_embed_primary: 45 * 1000,
    passive_external: 30 * 1000,
};

const SCORE_DECAY_ON_SUCCESS = 0.5;
const OFFLINE_SCORE_THRESHOLD = 3.0;

const FAILURE_WEIGHTS = {
    'ECONNREFUSED':             1.0,
    'http_404':                 1.0,
    'http_403':                 0.8,
    'tls_verification_failed':  0.8,
    'invalid_rtsp_url':         1.0,
    'rtsp_auth_failed':         1.0,
    'rtsp_stream_not_found':    1.0,
    'missing_external_hls_url': 1.0,
    'master_has_no_variant':    0.7,
    'media_playlist_has_no_segments': 0.6,
    'internal_stream_unreachable': 0.8,
    'stream_ended':             1.0,
    'stale_program_date_time':  0.4,
    'stale_media_sequence':     0.5,
    'snapshot_unreachable':     0.15,
    'mjpeg_invalid_content_type': 0.4,
    'probe_target_mismatch':    0.4,
    'ECONNABORTED':             0.2,  // Timeout
    'ETIMEDOUT':                0.2,
    'ENOTFOUND':                0.15,
    'request_error':            0.3
};

const HARD_OFFLINE_REASONS = new Set([
    'missing_external_source_metadata',
    'missing_external_hls_url',
    'missing_external_probe_target',
    'invalid_rtsp_url',
    'rtsp_auth_failed',
    'rtsp_stream_not_found',
    'http_401',
    'http_403',
    'http_404',
    'mjpeg_invalid_content_type',
    'invalid_m3u8',
    'master_has_no_variant',
    'nested_master_without_media',
    'media_playlist_has_no_segments',
]);

const BATCH_CONCURRENCY_PER_DOMAIN = 2;
const BATCH_DELAY_MS = 1500;
const TLS_VERIFICATION_ERROR_CODES = new Set([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function getTimestamp() {
    const timezone = getTimezone();
    return new Date().toLocaleString('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

function deriveMonitoringStateFromOnline(isOnline) {
    return isOnline ? 'online' : 'offline';
}

function isStrictInternalRtspHealthCamera(camera) {
    return isStrictOnDemandSourceProfile(camera);
}

function parseRtspResponse(rawResponse) {
    const raw = String(rawResponse || '');
    const [headerBlock = ''] = raw.split('\r\n\r\n');
    const lines = headerBlock
        .split('\r\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return null;
    }

    const statusLine = lines[0];
    const match = statusLine.match(/^RTSP\/1\.\d\s+(\d{3})\s*(.*)$/i);
    if (!match) {
        return null;
    }

    const headers = {};
    for (const line of lines.slice(1)) {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) {
            continue;
        }
        const headerName = line.slice(0, separatorIndex).trim().toLowerCase();
        const headerValue = line.slice(separatorIndex + 1).trim();
        headers[headerName] = headerValue;
    }

    return {
        statusCode: parseInt(match[1], 10),
        statusText: match[2] || '',
        headers,
        raw,
    };
}

function parseRtspAuthHeader(headerValue) {
    const normalized = String(headerValue || '').trim();
    if (!normalized) {
        return null;
    }

    const [schemeRaw, ...rest] = normalized.split(/\s+/);
    const scheme = (schemeRaw || '').trim();
    const parameterString = rest.join(' ').trim();
    const parameters = {};
    const regex = /([a-z0-9_-]+)=("([^"]*)"|([^,]+))/gi;
    let match = regex.exec(parameterString);

    while (match) {
        parameters[match[1].toLowerCase()] = (match[3] ?? match[4] ?? '').trim();
        match = regex.exec(parameterString);
    }

    return {
        scheme: scheme.toLowerCase(),
        parameters,
    };
}

function buildDigestAuthorization({ method, uri, username, password, challenge }) {
    const realm = challenge?.parameters?.realm;
    const nonce = challenge?.parameters?.nonce;
    if (!realm || !nonce || !username) {
        return null;
    }

    const qopRaw = challenge.parameters.qop || '';
    const qop = qopRaw
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .find((value) => value === 'auth');
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
    const response = qop
        ? crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest('hex')
        : crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');

    const parts = [
        `username="${username}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${uri}"`,
        `response="${response}"`,
    ];

    if (challenge.parameters.opaque) {
        parts.push(`opaque="${challenge.parameters.opaque}"`);
    }
    if (qop) {
        parts.push(`qop=${qop}`);
        parts.push(`nc=${nc}`);
        parts.push(`cnonce="${cnonce}"`);
    }
    if (challenge.parameters.algorithm) {
        parts.push(`algorithm=${challenge.parameters.algorithm}`);
    }

    return `Digest ${parts.join(', ')}`;
}

function buildBasicAuthorization({ username, password }) {
    if (!username) {
        return null;
    }
    const token = Buffer.from(`${username}:${password || ''}`).toString('base64');
    return `Basic ${token}`;
}

function buildRtspRequest({ method, uri, cseq, authorization = null }) {
    const lines = [
        `${method} ${uri} RTSP/1.0`,
        `CSeq: ${cseq}`,
        'User-Agent: RAF-NET-CCTV-Health/1.0',
        'Accept: application/sdp',
    ];

    if (authorization) {
        lines.push(`Authorization: ${authorization}`);
    }

    return `${lines.join('\r\n')}\r\n\r\n`;
}

function sendRtspRequest({ host, port, request, timeoutMs = 4000 }) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        let buffer = '';

        const settle = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(timeoutMs);

        socket.on('connect', () => {
            socket.write(request);
        });

        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            if (buffer.includes('\r\n\r\n')) {
                const parsed = parseRtspResponse(buffer);
                settle(parsed || { errorCode: 'request_error', raw: buffer });
            }
        });

        socket.on('timeout', () => {
            settle({ errorCode: 'ETIMEDOUT' });
        });

        socket.on('error', (error) => {
            settle({ errorCode: error?.code || 'request_error' });
        });

        socket.connect(port, host);
    });
}

async function probeRtspSource(rtspUrl, timeoutMs = 4000) {
    let parsedUrl;
    try {
        parsedUrl = new URL(rtspUrl);
    } catch {
        return {
            online: false,
            reason: 'invalid_rtsp_url',
            details: {
                probeTarget: rtspUrl,
            },
        };
    }

    const host = parsedUrl.hostname;
    const port = parseInt(parsedUrl.port, 10) || 554;
    const requestUri = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}`;
    const username = decodeURIComponent(parsedUrl.username || '');
    const password = decodeURIComponent(parsedUrl.password || '');

    const firstResponse = await sendRtspRequest({
        host,
        port,
        request: buildRtspRequest({
            method: 'DESCRIBE',
            uri: requestUri,
            cseq: 1,
        }),
        timeoutMs,
    });

    if (!firstResponse || firstResponse.errorCode) {
        return {
            online: false,
            reason: firstResponse?.errorCode || 'internal_stream_unreachable',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
            },
        };
    }

    if (firstResponse.statusCode === 200) {
        return {
            online: true,
            reason: 'rtsp_describe_ok',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: firstResponse.statusCode,
            },
        };
    }

    if ([404, 454].includes(firstResponse.statusCode)) {
        return {
            online: false,
            reason: 'rtsp_stream_not_found',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: firstResponse.statusCode,
            },
        };
    }

    if (firstResponse.statusCode !== 401) {
        return {
            online: false,
            reason: 'internal_stream_unreachable',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: firstResponse.statusCode,
            },
        };
    }

    const challenge = parseRtspAuthHeader(firstResponse.headers['www-authenticate']);
    const authorization = challenge?.scheme === 'digest'
        ? buildDigestAuthorization({
            method: 'DESCRIBE',
            uri: requestUri,
            username,
            password,
            challenge,
        })
        : challenge?.scheme === 'basic'
            ? buildBasicAuthorization({ username, password })
            : null;

    if (!authorization) {
        return {
            online: false,
            reason: 'rtsp_auth_failed',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: firstResponse.statusCode,
                rtspAuthScheme: challenge?.scheme || null,
            },
        };
    }

    const authenticatedResponse = await sendRtspRequest({
        host,
        port,
        request: buildRtspRequest({
            method: 'DESCRIBE',
            uri: requestUri,
            cseq: 2,
            authorization,
        }),
        timeoutMs,
    });

    if (!authenticatedResponse || authenticatedResponse.errorCode) {
        return {
            online: false,
            reason: authenticatedResponse?.errorCode || 'internal_stream_unreachable',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspAuthScheme: challenge?.scheme || null,
            },
        };
    }

    if (authenticatedResponse.statusCode === 200) {
        return {
            online: true,
            reason: 'rtsp_auth_ok',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: authenticatedResponse.statusCode,
                rtspAuthScheme: challenge?.scheme || null,
            },
        };
    }

    if ([404, 454].includes(authenticatedResponse.statusCode)) {
        return {
            online: false,
            reason: 'rtsp_stream_not_found',
            details: {
                probeTarget: rtspUrl,
                rtspHost: host,
                rtspPort: port,
                rtspStatusCode: authenticatedResponse.statusCode,
                rtspAuthScheme: challenge?.scheme || null,
            },
        };
    }

    return {
        online: false,
        reason: authenticatedResponse.statusCode === 401 ? 'rtsp_auth_failed' : 'internal_stream_unreachable',
        details: {
            probeTarget: rtspUrl,
            rtspHost: host,
            rtspPort: port,
            rtspStatusCode: authenticatedResponse.statusCode,
            rtspAuthScheme: challenge?.scheme || null,
        },
    };
}

function parsePlaylist(playlistText) {
    const normalizedText = String(playlistText || '').replace(/^\uFEFF/, '');
    const lines = normalizedText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0 || lines[0] !== '#EXTM3U') {
        return { ok: false, reason: 'invalid_m3u8' };
    }

    const entries = lines.filter((line) => !line.startsWith('#'));
    const isMaster = lines.some((line) => line.startsWith('#EXT-X-STREAM-INF'));

    let targetDuration = null;
    let mediaSequence = null;
    let lastProgramDateTimeMs = null;
    let hasEndList = false;

    for (const line of lines) {
        if (line === '#EXT-X-ENDLIST') {
            hasEndList = true;
        } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
            const value = parseInt(line.split(':')[1], 10);
            if (!Number.isNaN(value)) {
                targetDuration = value;
            }
        } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            const value = parseInt(line.split(':')[1], 10);
            if (!Number.isNaN(value)) {
                mediaSequence = value;
            }
        } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
            const pdtRaw = line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length);
            const parsed = Date.parse(pdtRaw);
            if (!Number.isNaN(parsed)) {
                lastProgramDateTimeMs = parsed;
            }
        }
    }

    return {
        ok: true,
        isMaster,
        entries,
        targetDuration,
        mediaSequence,
        lastProgramDateTimeMs,
        hasEndList
    };
}

function resolvePlaylistUrl(baseUrl, childPath) {
    try {
        return new URL(childPath, baseUrl).toString();
    } catch {
        return null;
    }
}

function normalizeExternalTlsMode(value) {
    return value === 'insecure' ? 'insecure' : 'strict';
}

function buildExternalRequestOptions(externalTlsMode) {
    const normalizedTlsMode = normalizeExternalTlsMode(externalTlsMode);
    return {
        externalTlsMode: normalizedTlsMode,
        httpsAgent: normalizedTlsMode === 'insecure'
            ? new https.Agent({ rejectUnauthorized: false, keepAlive: true })
            : undefined
    };
}

function buildExternalRequestHeaders(accept = '*/*') {
    return {
        Accept: accept,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
}

function mapExternalFetchError(error) {
    const errorCode = error?.code || '';
    if (TLS_VERIFICATION_ERROR_CODES.has(errorCode)) {
        return 'tls_verification_failed';
    }
    return errorCode || 'request_error';
}

function isExternalHttpDelivery(deliveryType) {
    return [
        'external_hls',
        'external_flv',
        'external_mjpeg',
        'external_embed',
        'external_jsmpeg',
        'external_custom_ws',
    ].includes(deliveryType);
}

function rawReasonIsHardConfig(reason) {
    return HARD_OFFLINE_REASONS.has(reason) || resolveErrorClass(reason) === 'config';
}

function shouldForceOfflineForHardConfig(camera, reason) {
    if (!rawReasonIsHardConfig(reason)) {
        return false;
    }

    if (reason !== 'missing_external_source_metadata') {
        return true;
    }

    return camera?.delivery_type === 'external_unresolved';
}

function withProbeDetails(baseDetails = {}, detailOverrides = {}) {
    return {
        ...baseDetails,
        ...detailOverrides,
    };
}

function extractProviderDomain(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
}

function resolveErrorClass(reason) {
    if (!reason) {
        return 'unknown';
    }

    if ([
        'missing_external_source_metadata',
        'missing_external_hls_url',
        'missing_external_probe_target',
        'invalid_rtsp_url',
        'rtsp_stream_not_found',
    ].includes(reason)) {
        return 'config';
    }

    if (reason === 'tls_verification_failed') {
        return 'tls';
    }

    if ([
        'http_401',
        'http_403',
        'rtsp_auth_failed',
    ].includes(reason)) {
        return 'auth_policy';
    }

    if ([
        'invalid_m3u8',
        'master_has_no_variant',
        'nested_master_without_media',
        'media_playlist_has_no_segments',
        'mjpeg_invalid_content_type',
    ].includes(reason)) {
        return 'format_protocol';
    }

    if ([
        'stream_ended',
        'stale_program_date_time',
        'stale_media_sequence',
    ].includes(reason)) {
        return 'stale';
    }

    if ([
        'probe_target_mismatch',
        'runtime_probe_tls_mismatch',
    ].includes(reason)) {
        return 'runtime_probe_mismatch';
    }

    if (
        reason.startsWith('http_')
        || [
            'ECONNREFUSED',
            'ECONNABORTED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'request_error',
            'internal_stream_unreachable',
            'provider_backoff_active',
        ].includes(reason)
    ) {
        return 'network_transient';
    }

    return 'unknown';
}

function resolveHealthProbeTarget(camera) {
    const deliveryProfile = getCameraDeliveryProfile(camera);
    const deliveryClassification = deliveryProfile.classification;
    const primaryExternalStreamUrl = getPrimaryExternalStreamUrl(camera);

    const base = {
        deliveryClassification,
        runtimeTarget: null,
        probeTarget: null,
        fallbackTargets: [],
        healthStrategy: 'unsupported',
        probeMethod: null,
    };

    if (deliveryClassification === 'internal_hls') {
        return {
            ...base,
            healthStrategy: 'internal_hls',
            probeMethod: 'internal_probe',
        };
    }

    if (deliveryClassification === 'external_hls') {
        return {
            ...base,
            runtimeTarget: primaryExternalStreamUrl,
            probeTarget: primaryExternalStreamUrl,
            healthStrategy: 'external_hls_playlist',
            probeMethod: 'hls_playlist',
        };
    }

    if (deliveryClassification === 'external_flv') {
        return {
            ...base,
            runtimeTarget: primaryExternalStreamUrl || camera.external_embed_url || null,
            probeTarget: camera.external_snapshot_url || camera.external_embed_url || null,
            fallbackTargets: camera.external_snapshot_url && camera.external_embed_url
                ? [camera.external_embed_url]
                : [],
            healthStrategy: camera.external_snapshot_url || camera.external_embed_url
                ? 'external_snapshot_fallback'
                : 'passive_external',
            probeMethod: camera.external_snapshot_url
                ? 'snapshot_probe'
                : (camera.external_embed_url ? 'embed_probe' : 'passive_assumed_online'),
        };
    }

    if (deliveryClassification === 'external_mjpeg') {
        return {
            ...base,
            runtimeTarget: primaryExternalStreamUrl,
            probeTarget: primaryExternalStreamUrl || camera.external_snapshot_url || null,
            fallbackTargets: camera.external_snapshot_url ? [camera.external_snapshot_url] : [],
            healthStrategy: primaryExternalStreamUrl ? 'external_mjpeg_stream_primary' : 'external_snapshot_fallback',
            probeMethod: primaryExternalStreamUrl ? 'mjpeg_stream_get' : 'snapshot_probe',
        };
    }

    if (deliveryClassification === 'external_embed') {
        return {
            ...base,
            runtimeTarget: camera.external_embed_url || camera.external_snapshot_url || null,
            probeTarget: camera.external_embed_url || camera.external_snapshot_url || null,
            fallbackTargets: camera.external_embed_url && camera.external_snapshot_url
                ? [camera.external_snapshot_url]
                : [],
            healthStrategy: camera.external_embed_url
                ? 'external_embed_primary'
                : (camera.external_snapshot_url ? 'external_snapshot_fallback' : 'passive_external'),
            probeMethod: camera.external_embed_url
                ? 'embed_probe'
                : (camera.external_snapshot_url ? 'snapshot_probe' : 'passive_assumed_online'),
        };
    }

    if (deliveryClassification === 'external_jsmpeg' || deliveryClassification === 'external_custom_ws') {
        const runtimeTarget = camera.external_stream_url || camera.external_embed_url || null;
        const probeTarget = camera.external_snapshot_url || camera.external_embed_url || null;
        return {
            ...base,
            runtimeTarget,
            probeTarget,
            fallbackTargets: [],
            healthStrategy: probeTarget ? 'external_snapshot_fallback' : 'passive_external',
            probeMethod: probeTarget
                ? (camera.external_snapshot_url ? 'snapshot_probe' : 'embed_probe')
                : 'passive_assumed_online',
        };
    }

    if (deliveryClassification === 'external_unresolved') {
        return {
            ...base,
            healthStrategy: 'external_unresolved_metadata',
            probeMethod: 'none',
        };
    }

    return base;
}

async function batchProbe(cameras, probeFn) {
    const domainGroups = new Map();
    for (const camera of cameras) {
        let hostname = '_internal_';
        const deliveryType = getEffectiveDeliveryType(camera);
        const probeResolution = resolveHealthProbeTarget(camera);
        const primaryTarget = probeResolution.probeTarget
            || probeResolution.runtimeTarget
            || probeResolution.fallbackTargets[0]
            || null;

        if (deliveryType !== 'internal_hls' && primaryTarget) {
            try { hostname = new URL(primaryTarget).hostname; } catch {}
        }
        if (!domainGroups.has(hostname)) domainGroups.set(hostname, []);
        domainGroups.get(hostname).push(camera);
    }

    const allResults = [];
    await Promise.all([...domainGroups.entries()].map(async ([domain, group]) => {
        for (let i = 0; i < group.length; i += BATCH_CONCURRENCY_PER_DOMAIN) {
            const batch = group.slice(i, i + BATCH_CONCURRENCY_PER_DOMAIN);
            const batchResults = await Promise.allSettled(batch.map(probeFn));
            allResults.push(...batchResults.map((r, idx) => ({
                result: r,
                camera: batch[idx]
            })));
            if (i + BATCH_CONCURRENCY_PER_DOMAIN < group.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
            }
        }
    }));
    return allResults;
}

class CameraHealthService {
    constructor() {
        this.checkInterval = null;
        this.isRunning = false;
        this.isChecking = false;
        this.lastCheck = null;
        this.lastCheckpointWriteAt = 0;
        this.offlineSince = new Map();
        this.healthState = new Map();
        this.domainHealth = new Map();
        this.probeCache = new Map();
        this.internalPathRepairBackoff = new Map();
        this.lastActivePathMap = new Map();
    }

    async probeInternalRtspSource(rtspUrl, timeoutMs = 4000) {
        return probeRtspSource(rtspUrl, timeoutMs);
    }

    async ensureInternalCameraPath(camera) {
        const pathName = camera.stream_key || `camera${camera.id}`;
        if (!camera?.private_rtsp_url || camera.enabled !== 1) {
            return { attempted: false, success: false, pathName };
        }

        const now = Date.now();
        const nextAllowedAt = this.internalPathRepairBackoff.get(pathName) || 0;
        if (nextAllowedAt > now) {
            return { attempted: false, success: false, pathName };
        }

        this.internalPathRepairBackoff.set(pathName, now + INTERNAL_PATH_REPAIR_BACKOFF_MS);

        try {
            const result = await mediaMtxService.updateCameraPath(pathName, camera.private_rtsp_url, camera);
            if (result?.success) {
                this.internalPathRepairBackoff.delete(pathName);
                return { attempted: true, success: true, pathName, action: result.action || null };
            }
        } catch (error) {
            console.error(`[CameraHealth] Failed to self-heal MediaMTX path ${pathName}:`, error.message);
        }

        return { attempted: true, success: false, pathName };
    }

    start(intervalMs = 30000) {
        if (this.isRunning) {
            console.log('[CameraHealth] Service already running');
            return;
        }

        this.isRunning = true;
        this.baseIntervalMs = Math.min(intervalMs, HEALTH_LOOP_CEIL_MS);
        console.log(`[CameraHealth] Starting health check service (interval: ${intervalMs / 1000}s)`);

        setTimeout(() => {
            const startTime = Date.now();
            this.checkAllCameras()
                .catch((error) => console.error('[CameraHealth] Initial check failed:', error.message))
                .finally(() => {
                    this.lastCheckDuration = Date.now() - startTime;
                    if (this.isRunning) this.scheduleNextCheck();
                });
        }, 10000);
    }

    scheduleNextCheck() {
        const now = Date.now();
        let nextDueAt = now + this.baseIntervalMs;
        for (const state of this.healthState.values()) {
            if (state?.nextCheckAt && state.nextCheckAt < nextDueAt) {
                nextDueAt = state.nextCheckAt;
            }
        }

        const durationFloor = this.lastCheckDuration
            ? Math.max(HEALTH_LOOP_FLOOR_MS, Math.ceil(this.lastCheckDuration * 1.2))
            : HEALTH_LOOP_FLOOR_MS;
        const dueDelay = Math.max(HEALTH_LOOP_FLOOR_MS, nextDueAt - now);
        const effectiveInterval = Math.min(
            HEALTH_LOOP_CEIL_MS,
            Math.max(durationFloor, dueDelay)
        );
            
        this.checkTimeout = setTimeout(() => {
            const startTime = Date.now();
            this.checkAllCameras()
                .catch((error) => console.error('[CameraHealth] Interval check failed:', error.message))
                .finally(() => {
                    this.lastCheckDuration = Date.now() - startTime;
                    if (this.isRunning) this.scheduleNextCheck();
                });
        }, effectiveInterval);
    }

    stop() {
        if (this.checkTimeout) {
            clearTimeout(this.checkTimeout);
            this.checkTimeout = null;
        }
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isRunning = false;
        this.isChecking = false;
        console.log('[CameraHealth] Service stopped');
    }

    ensureCameraState(cameraId, currentDbOnline) {
        if (!this.healthState.has(cameraId)) {
            this.healthState.set(cameraId, {
                effectiveOnline: currentDbOnline === 1,
                failureScore: 0,
                sequenceStaleCount: 0,
                lastMediaSequence: null,
                lastReason: null,
                lastDetails: null,
                needsConfirmation: false,
                state: currentDbOnline === 1 ? 'healthy' : 'offline',
                confidence: currentDbOnline === 1 ? 0.75 : 0.35,
                errorClass: null,
                lastProbeAt: null,
                nextCheckAt: 0,
                tier: 'hot',
                lastRuntimeSuccessAt: null,
                lastRuntimeFreshAt: null,
                lastRuntimeSignalType: null,
                lastRuntimeTarget: null,
                lastFreshFrameWindowExpiresAt: null,
                runtimeGraceUntil: null,
                providerDomain: null,
                domainBackoffUntil: null,
                stableSuccessCount: currentDbOnline === 1 ? 1 : 0,
                stableFailureCount: currentDbOnline === 1 ? 0 : 1,
                lastStateChangeAt: null,
            });
        }
        return this.healthState.get(cameraId);
    }

    getDomainState(domain) {
        if (!domain) {
            return null;
        }

        if (!this.domainHealth.has(domain)) {
            this.domainHealth.set(domain, {
                consecutiveFailures: 0,
                backoffUntil: 0,
                lastReason: null,
                lastSuccessAt: 0,
            });
        }

        return this.domainHealth.get(domain);
    }

    buildProbeCacheKey(probeResolution) {
        if (!probeResolution?.probeTarget) {
            return null;
        }

        return `${probeResolution.healthStrategy}:${probeResolution.probeTarget}`;
    }

    getProbeCacheTtlMs(probeResolution) {
        return PROBE_CACHE_TTLS_MS[probeResolution?.healthStrategy] || 0;
    }

    getCachedProbeResult(cacheKey) {
        if (!cacheKey) {
            return null;
        }

        const cached = this.probeCache.get(cacheKey);
        if (!cached) {
            return null;
        }

        if (cached.expiresAt <= Date.now()) {
            this.probeCache.delete(cacheKey);
            return null;
        }

        return {
            ...cached.result,
            details: withProbeDetails(cached.result.details, {
                cacheHit: true,
            }),
        };
    }

    setCachedProbeResult(cacheKey, probeResolution, result) {
        const ttlMs = this.getProbeCacheTtlMs(probeResolution);
        if (!cacheKey || ttlMs <= 0 || !result) {
            return;
        }

        this.probeCache.set(cacheKey, {
            expiresAt: Date.now() + ttlMs,
            result,
        });
    }

    cleanupProbeCache() {
        const now = Date.now();
        for (const [key, value] of this.probeCache.entries()) {
            if (value.expiresAt <= now) {
                this.probeCache.delete(key);
            }
        }
    }

    hasRecentRuntimeSuccess(state, now = Date.now()) {
        return Boolean(state?.lastRuntimeSuccessAt && (now - state.lastRuntimeSuccessAt) <= RUNTIME_SUCCESS_WINDOW_MS);
    }

    hasFreshMjpegRuntimeSignal(state, now = Date.now()) {
        return Boolean(
            state?.lastRuntimeFreshAt
            && state.lastFreshFrameWindowExpiresAt
            && state.lastFreshFrameWindowExpiresAt > now
        );
    }

    hasMjpegRuntimeGrace(state, now = Date.now()) {
        return Boolean(state?.runtimeGraceUntil && state.runtimeGraceUntil > now);
    }

    hasMjpegPassiveRuntime(state, now = Date.now()) {
        return Boolean(
            state?.lastRuntimeSuccessAt
            && (now - state.lastRuntimeSuccessAt) <= MJPEG_PASSIVE_STALE_TIMEOUT_MS
        );
    }

    buildPassiveMjpegResult(camera, baseDetails, state, reason = 'mjpeg_runtime_recent', extraDetails = {}) {
        return {
            online: true,
            reason,
            details: withProbeDetails(baseDetails, {
                probe_method: 'passive_runtime_only',
                assistedByRuntime: true,
                runtimeTarget: state?.lastRuntimeTarget || baseDetails.runtimeTarget || null,
                lastRuntimeSuccessAt: state?.lastRuntimeSuccessAt ? new Date(state.lastRuntimeSuccessAt).toISOString() : null,
                lastRuntimeFreshAt: state?.lastRuntimeFreshAt ? new Date(state.lastRuntimeFreshAt).toISOString() : null,
                lastRuntimeSignalType: state?.lastRuntimeSignalType || null,
                runtimeGraceUntil: state?.runtimeGraceUntil ? new Date(state.runtimeGraceUntil).toISOString() : null,
                healthMode: this.resolveExternalHealthMode(camera),
                ...extraDetails,
            }),
        };
    }

    evaluatePassiveRuntimeRaw(camera, baseDetails, reasonPrefix = 'mjpeg') {
        const state = this.ensureCameraState(camera.id, camera.is_online);
        const now = Date.now();

        if (this.hasFreshMjpegRuntimeSignal(state, now)) {
            return this.buildPassiveMjpegResult(camera, baseDetails, state, `${reasonPrefix}_runtime_recent`);
        }

        if (this.hasMjpegRuntimeGrace(state, now)) {
            return this.buildPassiveMjpegResult(camera, baseDetails, state, `${reasonPrefix}_runtime_grace`);
        }

        if (this.hasMjpegPassiveRuntime(state, now)) {
            return this.buildPassiveMjpegResult(camera, baseDetails, state, 'stale_passive');
        }

        return {
            online: false,
            reason: 'no_runtime_signal',
            details: withProbeDetails(baseDetails, {
                probe_method: 'passive_runtime_only',
                healthMode: this.resolveExternalHealthMode(camera),
            }),
        };
    }

    evaluatePassiveMjpegRaw(camera, baseDetails) {
        return this.evaluatePassiveRuntimeRaw(camera, baseDetails, 'mjpeg');
    }

    evaluateDisabledExternalRaw(camera, baseDetails) {
        const state = this.ensureCameraState(camera.id, camera.is_online);
        const now = Date.now();
        const deliveryType = getEffectiveDeliveryType(camera);

        if (deliveryType === 'external_mjpeg' || deliveryType === 'external_flv') {
            const runtimeReasonPrefix = deliveryType === 'external_flv' ? 'flv' : 'mjpeg';
            if (this.hasFreshMjpegRuntimeSignal(state, now)) {
                return this.buildPassiveMjpegResult(camera, baseDetails, state, `${runtimeReasonPrefix}_runtime_recent`, {
                    probe_method: 'none',
                    monitoringDisabled: true,
                });
            }

            if (this.hasMjpegRuntimeGrace(state, now)) {
                return this.buildPassiveMjpegResult(camera, baseDetails, state, `${runtimeReasonPrefix}_runtime_grace`, {
                    probe_method: 'none',
                    monitoringDisabled: true,
                });
            }

            if (this.hasMjpegPassiveRuntime(state, now)) {
                return this.buildPassiveMjpegResult(camera, baseDetails, state, 'stale_passive', {
                    probe_method: 'none',
                    monitoringDisabled: true,
                });
            }
        } else if (this.hasRecentRuntimeSuccess(state, now)) {
            return {
                online: true,
                reason: 'runtime_recent_success',
                details: withProbeDetails(baseDetails, {
                    probe_method: 'none',
                    monitoringDisabled: true,
                    lastRuntimeSuccessAt: state?.lastRuntimeSuccessAt ? new Date(state.lastRuntimeSuccessAt).toISOString() : null,
                    lastRuntimeFreshAt: state?.lastRuntimeFreshAt ? new Date(state.lastRuntimeFreshAt).toISOString() : null,
                    lastRuntimeSignalType: state?.lastRuntimeSignalType || null,
                }),
            };
        }

        if (!baseDetails.probeTarget) {
            return {
                online: true,
                reason: 'assumed_online_no_probe_target',
                details: withProbeDetails(baseDetails, {
                    probe_method: 'passive_assumed_online',
                    monitoringDisabled: true,
                    lastRuntimeSuccessAt: state?.lastRuntimeSuccessAt ? new Date(state.lastRuntimeSuccessAt).toISOString() : null,
                    lastRuntimeFreshAt: state?.lastRuntimeFreshAt ? new Date(state.lastRuntimeFreshAt).toISOString() : null,
                    lastRuntimeSignalType: state?.lastRuntimeSignalType || null,
                }),
            };
        }

        return {
            online: true,
            reason: 'health_check_disabled',
            details: withProbeDetails(baseDetails, {
                probe_method: 'none',
                monitoringDisabled: true,
                lastRuntimeSuccessAt: state?.lastRuntimeSuccessAt ? new Date(state.lastRuntimeSuccessAt).toISOString() : null,
                lastRuntimeFreshAt: state?.lastRuntimeFreshAt ? new Date(state.lastRuntimeFreshAt).toISOString() : null,
                lastRuntimeSignalType: state?.lastRuntimeSignalType || null,
                runtimeGraceUntil: state?.runtimeGraceUntil ? new Date(state.runtimeGraceUntil).toISOString() : null,
            }),
        };
    }

    recordRuntimeSignal(cameraId, { targetUrl = null, signalType = 'runtime_success', timestamp = Date.now(), success = true } = {}) {
        const state = this.ensureCameraState(cameraId, 0);
        const providerDomain = extractProviderDomain(targetUrl);

        state.providerDomain = providerDomain || state.providerDomain || null;
        state.nextCheckAt = Math.min(state.nextCheckAt || timestamp, timestamp + HOT_CADENCE_MS);
        state.tier = 'hot';

        if (success) {
            state.lastRuntimeSuccessAt = timestamp;
            state.lastRuntimeFreshAt = timestamp;
            state.lastRuntimeSignalType = signalType;
            state.lastRuntimeTarget = targetUrl || state.lastRuntimeTarget || null;
            state.lastFreshFrameWindowExpiresAt = timestamp + MJPEG_RUNTIME_FRESH_WINDOW_MS;
            state.runtimeGraceUntil = timestamp + MJPEG_RUNTIME_GRACE_WINDOW_MS;
            state.effectiveOnline = true;
            const isPassiveExternalTick = [
                'external_mjpeg_live_tick',
                'external_mjpeg_open',
                'external_flv_live_tick',
                'external_flv_runtime_playing',
            ].includes(signalType);
            state.state = isPassiveExternalTick
                ? 'degraded_runtime_recent'
                : (state.state === 'offline' ? 'degraded_runtime_recent' : (state.state || 'degraded_runtime_recent'));
            state.confidence = Math.max(state.confidence || 0.5, 0.7);
            state.lastStateChangeAt = timestamp;
            state.lastReason = isPassiveExternalTick
                ? (signalType.startsWith('external_flv') ? 'flv_runtime_recent' : 'mjpeg_runtime_recent')
                : 'runtime_recent_success';
            state.lastDetails = withProbeDetails(state.lastDetails, {
                runtimeTarget: targetUrl || state.lastRuntimeTarget || null,
                lastRuntimeSignalType: signalType,
                lastRuntimeFreshAt: new Date(timestamp).toISOString(),
                runtimeGraceUntil: new Date(state.runtimeGraceUntil).toISOString(),
            });

            const currentTimestamp = getTimestamp();
            execute(
                'UPDATE cameras SET is_online = 1, last_online_check = ? WHERE id = ? AND (is_online IS NULL OR is_online = 0)',
                [currentTimestamp, cameraId]
            );
            cameraRuntimeStateService.upsertRuntimeState(cameraId, {
                is_online: 1,
                monitoring_state: state.state || 'degraded_runtime_recent',
                monitoring_reason: state.lastReason || 'runtime_recent_success',
                last_runtime_signal_at: currentTimestamp,
                last_runtime_signal_type: signalType,
                last_health_check_at: currentTimestamp,
            });
        }

        return state;
    }

    shouldUseRuntimeAssist(rawResult, state) {
        if (!rawResult || rawResult.online || !state) {
            return false;
        }

        const errorClass = resolveErrorClass(rawResult.reason);
        if (!(errorClass === 'tls' || errorClass === 'network_transient' || errorClass === 'runtime_probe_mismatch')) {
            return false;
        }

        const deliveryClassification = rawResult.details?.delivery_classification || null;
        if (deliveryClassification === 'external_mjpeg') {
            const healthMode = this.resolveExternalHealthMode({ id: rawResult.details?.cameraId, delivery_type: 'external_mjpeg', external_health_mode: rawResult.details?.healthMode });
            if (healthMode === 'disabled' || healthMode === 'passive_first') {
                return false;
            }
            return this.hasFreshMjpegRuntimeSignal(state) || this.hasMjpegRuntimeGrace(state);
        }

        return this.hasRecentRuntimeSuccess(state);
    }

    applyRuntimeAssist(rawResult, state) {
        if (!this.shouldUseRuntimeAssist(rawResult, state)) {
            return rawResult;
        }

        const errorClass = resolveErrorClass(rawResult.reason);
        const now = Date.now();
        const deliveryClassification = rawResult.details?.delivery_classification || null;
        const hasFreshMjpegSignal = deliveryClassification === 'external_mjpeg' && this.hasFreshMjpegRuntimeSignal(state, now);
        const hasMjpegGrace = deliveryClassification === 'external_mjpeg' && this.hasMjpegRuntimeGrace(state, now);
        let assistedReason = errorClass === 'tls' ? 'runtime_probe_tls_mismatch' : 'runtime_recent_success';

        if (deliveryClassification === 'external_mjpeg') {
            if (hasFreshMjpegSignal) {
                assistedReason = 'mjpeg_runtime_recent';
            } else if (hasMjpegGrace) {
                assistedReason = 'mjpeg_runtime_grace';
            }
        }

        return {
            online: true,
            reason: assistedReason,
            details: withProbeDetails(rawResult.details, {
                underlyingReason: rawResult.reason,
                assistedByRuntime: true,
                lastRuntimeSuccessAt: state.lastRuntimeSuccessAt,
                lastRuntimeFreshAt: state.lastRuntimeFreshAt,
                lastRuntimeSignalType: state.lastRuntimeSignalType,
                runtimeTarget: state.lastRuntimeTarget || rawResult.details?.runtimeTarget || null,
                runtimeGraceUntil: state.runtimeGraceUntil ? new Date(state.runtimeGraceUntil).toISOString() : null,
            }),
        };
    }

    updateDomainHealth(domain, rawResult) {
        const domainState = this.getDomainState(domain);
        if (!domainState || !rawResult) {
            return null;
        }

        const errorClass = resolveErrorClass(rawResult.reason);
        const now = Date.now();

        if (rawResult.online) {
            domainState.consecutiveFailures = 0;
            domainState.backoffUntil = 0;
            domainState.lastReason = rawResult.reason;
            domainState.lastSuccessAt = now;
            return domainState;
        }

        if (errorClass === 'tls' || errorClass === 'network_transient' || errorClass === 'auth_policy') {
            domainState.consecutiveFailures += 1;
            const backoffMs = Math.min(
                DOMAIN_BACKOFF_MAX_MS,
                DOMAIN_BACKOFF_BASE_MS * Math.max(1, Math.min(domainState.consecutiveFailures, 5))
            );
            domainState.backoffUntil = now + backoffMs;
        }

        domainState.lastReason = rawResult.reason;
        return domainState;
    }

    resolveTier(camera, state, rawResult = null) {
        const deliveryProfile = getCameraDeliveryProfile(camera);

        if (deliveryProfile.classification === 'external_unresolved') {
            return 'cold';
        }

        if (deliveryProfile.classification === 'external_custom_ws' && !camera.external_snapshot_url && !camera.external_embed_url) {
            return 'cold';
        }

        if (this.hasRecentRuntimeSuccess(state) || state.needsConfirmation) {
            return 'hot';
        }

        if (rawResult && !rawResult.online) {
            return state.stableFailureCount >= 5 ? 'cold' : 'hot';
        }

        if (state.stableSuccessCount >= 3) {
            return 'warm';
        }

        return 'hot';
    }

    getNextCadenceMs(camera, state, rawResult = null) {
        const deliveryProfile = getCameraDeliveryProfile(camera);
        const lastDetails = rawResult?.details || state?.lastDetails || {};
        const internalPolicy = buildInternalIngestPolicySummary(camera, {
            internal_ingest_policy_default: camera?.area_internal_ingest_policy_default,
            internal_on_demand_close_after_seconds: camera?.area_internal_on_demand_close_after_seconds,
        });

        if (deliveryProfile.classification === 'external_unresolved') {
            return COLD_CADENCE_MS;
        }

        if (
            deliveryProfile.effectiveDeliveryType === 'internal_hls'
            && internalPolicy.isStrictOnDemandProfile
            && Number(lastDetails.real_viewer_count || 0) === 0
        ) {
            return PASSIVE_ONLY_CADENCE_MS;
        }

        if ((deliveryProfile.classification === 'external_jsmpeg' || deliveryProfile.classification === 'external_custom_ws')
            && !camera.external_snapshot_url
            && !camera.external_embed_url) {
            return PASSIVE_ONLY_CADENCE_MS;
        }

        const tier = this.resolveTier(camera, state, rawResult);
        state.tier = tier;

        if (tier === 'cold') {
            return COLD_CADENCE_MS;
        }

        if (tier === 'warm') {
            return WARM_CADENCE_MS;
        }

        return HOT_CADENCE_MS;
    }

    scheduleNextCameraCheck(camera, state, rawResult = null) {
        state.nextCheckAt = Date.now() + this.getNextCadenceMs(camera, state, rawResult);
        return state.nextCheckAt;
    }

    getExternalRequestOptions(camera) {
        return buildExternalRequestOptions(camera?.external_tls_mode);
    }

    getHealthStrategy(camera) {
        return resolveHealthProbeTarget(camera).healthStrategy;
    }

    resolveExternalHealthMode(camera) {
        const explicitMode = normalizeExternalHealthMode(camera?.external_health_mode);
        if (explicitMode !== 'default') {
            return explicitMode;
        }

        const areaOverrideMode = normalizeExternalHealthMode(camera?.area_external_health_mode_override);
        if (areaOverrideMode !== 'default') {
            return areaOverrideMode;
        }

        const deliveryType = getEffectiveDeliveryType(camera);
        const defaults = settingsService.getExternalHealthDefaults();

        if (deliveryType === 'external_mjpeg') {
            return defaults.external_mjpeg || 'passive_first';
        }

        if (deliveryType === 'external_hls') {
            return defaults.external_hls || 'hybrid_probe';
        }

        if (deliveryType === 'external_flv') {
            return defaults.external_flv || 'passive_first';
        }

        if (deliveryType === 'external_embed') {
            return defaults.external_embed || 'passive_first';
        }

        if (deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
            return defaults[deliveryType] || 'disabled';
        }

        return 'hybrid_probe';
    }

    getMonitoringState(camera, state) {
        const healthMode = this.resolveExternalHealthMode(camera);
        const deliveryType = getEffectiveDeliveryType(camera);

        if (camera?.status === 'maintenance') {
            return {
                health_mode: healthMode,
                monitoring_state: 'maintenance',
                monitoring_reason: 'maintenance',
            };
        }

        if (state?.state === 'unresolved') {
            return {
                health_mode: healthMode,
                monitoring_state: 'unresolved',
                monitoring_reason: state.lastReason || 'missing_external_source_metadata',
            };
        }

        if (healthMode === 'disabled') {
            return {
                health_mode: healthMode,
                monitoring_state: 'disabled',
                monitoring_reason: 'health_check_disabled',
            };
        }

        if ((deliveryType === 'external_mjpeg' || deliveryType === 'external_flv') && healthMode === 'passive_first') {
            if (this.hasFreshMjpegRuntimeSignal(state)) {
                return {
                    health_mode: healthMode,
                    monitoring_state: 'passive',
                    monitoring_reason: deliveryType === 'external_flv' ? 'flv_runtime_recent' : 'mjpeg_runtime_recent',
                };
            }

            if (this.hasMjpegRuntimeGrace(state)) {
                return {
                    health_mode: healthMode,
                    monitoring_state: 'stale',
                    monitoring_reason: deliveryType === 'external_flv' ? 'flv_runtime_grace' : 'mjpeg_runtime_grace',
                };
            }

            if (state?.lastRuntimeSuccessAt) {
                return {
                    health_mode: healthMode,
                    monitoring_state: 'stale',
                    monitoring_reason: deliveryType === 'external_flv' ? 'flv_runtime_stale' : 'mjpeg_runtime_stale',
                };
            }

            return {
                health_mode: healthMode,
                monitoring_state: state?.effectiveOnline ? 'passive' : 'offline',
                monitoring_reason: state?.lastReason || 'no_runtime_signal',
            };
        }

        if (!state?.effectiveOnline && !rawReasonIsHardConfig(state?.lastReason) && state?.errorClass && state.errorClass !== 'config') {
            return {
                health_mode: healthMode,
                monitoring_state: 'probe_failed',
                monitoring_reason: state.lastReason,
            };
        }

        return {
            health_mode: healthMode,
            monitoring_state: state?.effectiveOnline ? 'passive' : 'offline',
            monitoring_reason: state?.lastReason || 'unknown',
        };
    }

    async handleCameraStatusTransition(camera, previousOnline, nextOnline, rawReason) {
        if (previousOnline === nextOnline) {
            return;
        }

        if (nextOnline === 1) {
            try {
                if (camera.enabled && camera.enable_recording) {
                    await recordingService.handleCameraBecameOnline(camera.id);
                }
            } catch (error) {
                console.error(`[CameraHealth] Failed to auto-resume recording for camera ${camera.id}:`, error.message);
            }

            try {
                await thumbnailService.refreshCameraThumbnail(camera.id);
            } catch (error) {
                console.error(`[CameraHealth] Failed to refresh thumbnail for camera ${camera.id}:`, error.message);
            }

            return;
        }

        try {
            await recordingService.handleCameraBecameOffline(camera.id);
        } catch (error) {
            console.error(`[CameraHealth] Failed to suspend recording for camera ${camera.id}:`, error.message);
        }
    }

    async fetchPlaylist(url, requestOptions = {}, timeoutMs) {
        try {
            const isHttpsRequest = typeof url === 'string' && url.startsWith('https://');
            const response = await axios.get(url, {
                timeout: timeoutMs || EXTERNAL_REQUEST_TIMEOUT_MS,
                responseType: 'text',
                transformResponse: [(data) => data],
                headers: buildExternalRequestHeaders('application/vnd.apple.mpegurl,application/x-mpegURL,*/*'),
                validateStatus: (status) => status < 500,
                maxRedirects: 0,
                httpsAgent: isHttpsRequest ? requestOptions.httpsAgent : undefined
            });

            if (response.status >= 400) {
                return {
                    ok: false,
                    reason: `http_${response.status}`,
                    status: response.status
                };
            }

            return {
                ok: true,
                body: String(response.data || ''),
                status: response.status
            };
        } catch (error) {
            return {
                ok: false,
                reason: mapExternalFetchError(error),
                status: error.response?.status || null
            };
        }
    }

    async probeHttpAvailability(url, requestOptions = {}, options = {}) {
        if (!url) {
            return {
                online: false,
                reason: 'missing_external_probe_target',
                details: withProbeDetails(options.baseDetails, {
                    probe_method: options.probeMethod || 'generic_head_get',
                }),
            };
        }

        const timeoutMs = options.timeoutMs || EXTERNAL_REQUEST_TIMEOUT_MS;
        const acceptHeader = options.acceptHeader || '*/*';
        const isHttpsRequest = typeof url === 'string' && url.startsWith('https://');
        const baseConfig = {
            timeout: timeoutMs,
            validateStatus: (status) => status < 500,
            headers: buildExternalRequestHeaders(acceptHeader),
            maxRedirects: options.maxRedirects ?? 5,
            httpsAgent: isHttpsRequest ? requestOptions.httpsAgent : undefined,
        };

        try {
            const headResponse = await axios.head(url, baseConfig);
            if (headResponse.status >= 400) {
                if (headResponse.status !== 405 && headResponse.status !== 501) {
                    return {
                        online: false,
                        reason: `http_${headResponse.status}`,
                        details: withProbeDetails(options.baseDetails, {
                            probe_method: 'HEAD',
                            http_status: headResponse.status,
                            content_type: headResponse.headers?.['content-type'] || null,
                        })
                    };
                }
            } else {
                return {
                    online: true,
                    reason: options.successReason || 'http_reachable',
                    details: withProbeDetails(options.baseDetails, {
                        probe_method: 'HEAD',
                        http_status: headResponse.status,
                        content_type: headResponse.headers?.['content-type'] || null,
                    })
                };
            }
        } catch (error) {
            const mappedReason = mapExternalFetchError(error);
            if (mappedReason !== 'request_error') {
                return {
                    online: false,
                    reason: mappedReason,
                    details: withProbeDetails(options.baseDetails, {
                        probe_method: 'HEAD',
                        http_status: error.response?.status || null,
                    }),
                };
            }
        }

        try {
            const response = await axios.get(url, {
                ...baseConfig,
                responseType: 'stream',
            });

            if (response.status >= 400) {
                if (response.data?.destroy) {
                    response.data.destroy();
                }
                return {
                    online: false,
                    reason: `http_${response.status}`,
                    details: withProbeDetails(options.baseDetails, {
                        probe_method: 'GET',
                        http_status: response.status,
                        content_type: response.headers?.['content-type'] || null,
                    })
                };
            }

            if (response.data?.destroy) {
                response.data.destroy();
            }

            return {
                online: true,
                reason: options.successReason || 'http_reachable',
                details: withProbeDetails(options.baseDetails, {
                    probe_method: 'GET',
                    http_status: response.status,
                    content_type: response.headers?.['content-type'] || null,
                })
            };
        } catch (error) {
            return {
                online: false,
                reason: mapExternalFetchError(error),
                details: withProbeDetails(options.baseDetails, {
                    probe_method: 'GET',
                    http_status: error.response?.status || null,
                    content_type: error.response?.headers?.['content-type'] || null,
                })
            };
        }
    }

    async probeSnapshotUrl(url, requestOptions = {}, options = {}) {
        const result = await this.probeHttpAvailability(url, requestOptions, {
            ...options,
            acceptHeader: 'image/*,*/*;q=0.8',
            successReason: options.successReason || 'snapshot_reachable',
            probeMethod: 'snapshot_probe',
        });

        if (!result.online && result.reason?.startsWith('http_')) {
            return {
                ...result,
                reason: 'snapshot_unreachable',
            };
        }

        return result;
    }

    async probeEmbedUrl(url, requestOptions = {}, options = {}) {
        return this.probeHttpAvailability(url, requestOptions, {
            ...options,
            acceptHeader: 'text/html,*/*;q=0.8',
            successReason: options.successReason || 'embed_reachable',
            probeMethod: 'embed_probe',
        });
    }

    async probeMjpegStream(url, requestOptions = {}, options = {}) {
        if (!url) {
            return {
                online: false,
                reason: 'missing_external_probe_target',
                details: withProbeDetails(options.baseDetails, {
                    probe_method: 'mjpeg_stream_get',
                }),
            };
        }

        const timeoutMs = options.timeoutMs || EXTERNAL_REQUEST_TIMEOUT_MS;
        const isHttpsRequest = typeof url === 'string' && url.startsWith('https://');
        const requestConfig = {
            timeout: timeoutMs,
            validateStatus: (status) => status < 500,
            headers: buildExternalRequestHeaders('image/*,*/*;q=0.8'),
            maxRedirects: options.maxRedirects ?? 5,
            httpsAgent: isHttpsRequest ? requestOptions.httpsAgent : undefined,
            responseType: 'stream',
        };

        try {
            const response = await axios.get(url, requestConfig);
            const contentType = response.headers?.['content-type'] || null;
            const normalizedContentType = String(contentType || '').toLowerCase();

            if (response.status >= 400) {
                if (response.data?.destroy) {
                    response.data.destroy();
                }
                return {
                    online: false,
                    reason: `http_${response.status}`,
                    details: withProbeDetails(options.baseDetails, {
                        probe_method: 'GET',
                        http_status: response.status,
                        content_type: contentType,
                    }),
                };
            }

            const looksLikeMjpeg = normalizedContentType.includes('multipart/x-mixed-replace')
                || normalizedContentType.includes('image/jpeg')
                || normalizedContentType.includes('multipart/');

            if (response.data?.destroy) {
                response.data.destroy();
            }

            if (looksLikeMjpeg || response.data?.readable !== false) {
                return {
                    online: true,
                    reason: 'mjpeg_stream_opened',
                    details: withProbeDetails(options.baseDetails, {
                        probe_method: 'GET',
                        http_status: response.status,
                        content_type: contentType,
                    }),
                };
            }

            return {
                online: false,
                reason: 'mjpeg_invalid_content_type',
                details: withProbeDetails(options.baseDetails, {
                    probe_method: 'GET',
                    http_status: response.status,
                    content_type: contentType,
                }),
            };
        } catch (error) {
            return {
                online: false,
                reason: mapExternalFetchError(error),
                details: withProbeDetails(options.baseDetails, {
                    probe_method: 'GET',
                    http_status: error.response?.status || null,
                    content_type: error.response?.headers?.['content-type'] || null,
                }),
            };
        }
    }

    evaluateExternalFreshness(cameraId, mediaInfo) {
        const state = this.healthState.get(cameraId);

        if (mediaInfo.hasEndList) {
            return { ok: false, reason: 'stream_ended' };
        }

        if (mediaInfo.lastProgramDateTimeMs) {
            const ageSec = Math.max(0, (Date.now() - mediaInfo.lastProgramDateTimeMs) / 1000);
            const maxAge = Math.max(30, (mediaInfo.targetDuration || 5) * 4);
            if (ageSec > Math.min(maxAge, EXTERNAL_MAX_PDT_AGE_SEC)) {
                return {
                    ok: false,
                    reason: 'stale_program_date_time',
                    details: { ageSec: Math.round(ageSec) }
                };
            }

            if (state) {
                state.sequenceStaleCount = 0;
                if (Number.isFinite(mediaInfo.mediaSequence)) {
                    state.lastMediaSequence = mediaInfo.mediaSequence;
                }
            }

            return { ok: true, reason: 'fresh_program_date_time' };
        }

        if (Number.isFinite(mediaInfo.mediaSequence) && state) {
            if (state.lastMediaSequence !== null && mediaInfo.mediaSequence <= state.lastMediaSequence) {
                state.sequenceStaleCount += 1;
            } else {
                state.sequenceStaleCount = 0;
            }

            state.lastMediaSequence = mediaInfo.mediaSequence;

            if (state.sequenceStaleCount >= EXTERNAL_STALE_SEQUENCE_THRESHOLD) {
                return {
                    ok: false,
                    reason: 'stale_media_sequence',
                    details: { staleChecks: state.sequenceStaleCount }
                };
            }

            return { ok: true, reason: 'media_sequence_progressing' };
        }

        return { ok: true, reason: 'segment_present_no_freshness_marker' };
    }

    async probeExternalStream(cameraId, externalHlsUrl, requestOptions = {}, timeoutMs) {
        if (!externalHlsUrl) {
            return { online: false, reason: 'missing_external_hls_url' };
        }

        let currentUrl = externalHlsUrl;
        let parsedMedia = null;

        for (let depth = 0; depth < 3; depth += 1) {
            const playlistResponse = await this.fetchPlaylist(currentUrl, requestOptions, timeoutMs);
            if (!playlistResponse.ok) {
                return {
                    online: false,
                    reason: playlistResponse.reason,
                    details: { stage: depth === 0 ? 'master' : 'child', status: playlistResponse.status }
                };
            }

            const parsed = parsePlaylist(playlistResponse.body);
            if (!parsed.ok) {
                return {
                    online: false,
                    reason: parsed.reason,
                    details: { stage: depth === 0 ? 'master_parse' : 'child_parse' }
                };
            }

            if (!parsed.isMaster) {
                parsedMedia = parsed;
                break;
            }

            const nextChild = parsed.entries[0];
            if (!nextChild) {
                return {
                    online: false,
                    reason: 'master_has_no_variant'
                };
            }

            const nextUrl = resolvePlaylistUrl(currentUrl, nextChild);
            if (!nextUrl) {
                return {
                    online: false,
                    reason: 'invalid_variant_url'
                };
            }

            currentUrl = nextUrl;
        }

        if (!parsedMedia) {
            return {
                online: false,
                reason: 'nested_master_without_media'
            };
        }

        if (!parsedMedia.entries.length) {
            return {
                online: false,
                reason: 'media_playlist_has_no_segments'
            };
        }

        const freshness = this.evaluateExternalFreshness(cameraId, parsedMedia);
        if (!freshness.ok) {
            return {
                online: false,
                reason: freshness.reason,
                details: freshness.details || null
            };
        }

        return {
            online: true,
            reason: freshness.reason
        };
    }

    async getActivePaths() {
        const pathMap = new Map();

        try {
            const configResponse = await axios.get(`${mediaMtxApiBaseUrl}/config/paths/list`, {
                timeout: 5000
            });

            const configItems = configResponse.data?.items || [];
            for (const item of configItems) {
                pathMap.set(item.name, {
                    name: item.name,
                    configured: true,
                    ready: false,
                    sourceReady: false,
                    readers: 0,
                    realViewerCount: 0,
                    hasInternalReaderOnly: false,
                });
            }
        } catch (error) {
            console.error('[CameraHealth] Failed to get configured paths:', error.message);
            return pathMap;
        }

        try {
            const pathsResponse = await axios.get(`${mediaMtxApiBaseUrl}/paths/list`, {
                timeout: 5000
            });
            const activeItems = pathsResponse.data?.items || [];

            for (const item of activeItems) {
                const existing = pathMap.get(item.name) || {
                    name: item.name,
                    configured: false,
                    ready: false,
                    sourceReady: false,
                    readers: 0,
                    realViewerCount: 0,
                    hasInternalReaderOnly: false,
                };

                existing.ready = item.ready || false;
                existing.sourceReady = item.sourceReady || false;
                existing.readers = item.readers?.length || 0;
                existing.realViewerCount = (item.readers || []).filter((reader) => mediaMtxService.constructor.isRealViewer(reader)).length;
                existing.hasInternalReaderOnly = existing.readers > 0 && existing.realViewerCount === 0;

                pathMap.set(item.name, existing);
            }
        } catch (error) {
            console.warn('[CameraHealth] Failed to get active paths:', error.message);
        }

        this.lastActivePathMap = pathMap;
        return pathMap;
    }

    async evaluateCameraRaw(camera, activePaths, options = {}) {
        const probeResolution = resolveHealthProbeTarget(camera);
        const deliveryType = probeResolution.deliveryClassification;
        const healthMode = isExternalHttpDelivery(deliveryType)
            ? this.resolveExternalHealthMode(camera)
            : 'default';
        const providerDomain = extractProviderDomain(
            probeResolution.probeTarget
            || probeResolution.runtimeTarget
            || probeResolution.fallbackTargets[0]
            || null
        );
        const baseDetails = {
            delivery_classification: probeResolution.deliveryClassification,
            runtimeTarget: probeResolution.runtimeTarget,
            probeTarget: probeResolution.probeTarget,
            fallbackTarget: probeResolution.fallbackTargets[0] || null,
            probe_method: probeResolution.probeMethod,
            usedFallback: false,
            providerDomain,
            cameraId: camera.id,
            healthMode,
        };
        const domainState = this.getDomainState(providerDomain);
        const cacheKey = options.bustCache ? null : this.buildProbeCacheKey(probeResolution);

        if (cacheKey) {
            const cachedResult = this.getCachedProbeResult(cacheKey);
            if (cachedResult) {
                return cachedResult;
            }
        }

        if (
            providerDomain
            && domainState?.backoffUntil
            && domainState.backoffUntil > Date.now()
            && !options.bustCache
        ) {
            return {
                online: false,
                reason: 'provider_backoff_active',
                details: withProbeDetails(baseDetails, {
                    domainBackoffUntil: new Date(domainState.backoffUntil).toISOString(),
                }),
            };
        }

        if (deliveryType === 'external_hls') {
            let hlsUrl = probeResolution.probeTarget;
            if (options.bustCache && hlsUrl) {
                const sep = hlsUrl.includes('?') ? '&' : '?';
                hlsUrl = `${hlsUrl}${sep}_t=${Date.now()}`;
            }
            const result = await this.probeExternalStream(
                camera.id,
                hlsUrl,
                this.getExternalRequestOptions(camera),
                options.timeoutMs
            );
            const finalResult = {
                ...result,
                details: withProbeDetails(baseDetails, result.details),
            };
            this.setCachedProbeResult(cacheKey, probeResolution, finalResult);
            this.updateDomainHealth(providerDomain, finalResult);
            return finalResult;
        }

        if (deliveryType === 'external_mjpeg') {
            if (healthMode === 'disabled') {
                return this.evaluateDisabledExternalRaw(camera, baseDetails);
            }

            if (healthMode === 'passive_first') {
                return this.evaluatePassiveMjpegRaw(camera, baseDetails);
            }

            const requestOptions = this.getExternalRequestOptions(camera);
            const primaryTarget = probeResolution.probeTarget;
            const fallbackTarget = probeResolution.fallbackTargets[0] || null;

            if (primaryTarget) {
                const streamResult = await this.probeMjpegStream(primaryTarget, requestOptions, {
                    timeoutMs: options.timeoutMs,
                    baseDetails,
                });

                if (healthMode === 'hybrid_probe' && !streamResult.online) {
                    const assistedPassiveResult = this.evaluatePassiveMjpegRaw(camera, baseDetails);
                    if (assistedPassiveResult.online) {
                        this.setCachedProbeResult(cacheKey, probeResolution, assistedPassiveResult);
                        this.updateDomainHealth(providerDomain, streamResult);
                        return assistedPassiveResult;
                    }
                }

                if (streamResult.online || !fallbackTarget) {
                    this.setCachedProbeResult(cacheKey, probeResolution, streamResult);
                    this.updateDomainHealth(providerDomain, streamResult);
                    return streamResult;
                }

                const snapshotResult = await this.probeSnapshotUrl(fallbackTarget, requestOptions, {
                    timeoutMs: options.timeoutMs,
                    baseDetails: {
                        ...baseDetails,
                        usedFallback: true,
                    },
                });

                if (snapshotResult.online) {
                    const assistedResult = {
                        online: true,
                        reason: 'probe_target_mismatch',
                        details: withProbeDetails(snapshotResult.details, {
                            streamProbeReason: streamResult.reason,
                            usedFallback: true,
                        }),
                    };
                    this.setCachedProbeResult(cacheKey, probeResolution, assistedResult);
                    this.updateDomainHealth(providerDomain, assistedResult);
                    return assistedResult;
                }

                this.setCachedProbeResult(cacheKey, probeResolution, streamResult);
                this.updateDomainHealth(providerDomain, streamResult);
                return streamResult;
            }

            const fallbackResult = await this.probeSnapshotUrl(fallbackTarget, requestOptions, {
                timeoutMs: options.timeoutMs,
                baseDetails,
            });
            this.setCachedProbeResult(cacheKey, probeResolution, fallbackResult);
            this.updateDomainHealth(providerDomain, fallbackResult);
            return fallbackResult;
        }

        if (deliveryType === 'external_flv') {
            if (healthMode === 'disabled') {
                return this.evaluateDisabledExternalRaw(camera, baseDetails);
            }

            if (healthMode === 'passive_first') {
                return this.evaluatePassiveRuntimeRaw(camera, baseDetails, 'flv');
            }
        }

        if (deliveryType === 'external_embed' || deliveryType === 'external_flv' || deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
            if (healthMode === 'disabled') {
                return this.evaluateDisabledExternalRaw(camera, baseDetails);
            }

            const probeTarget = probeResolution.probeTarget;
            if (!probeTarget) {
                return {
                    online: camera.enabled === 1,
                    reason: 'assumed_online_no_probe_target',
                    details: withProbeDetails(baseDetails, {
                        probe_method: 'passive_assumed_online',
                    }),
                };
            }

            if (deliveryType === 'external_embed' && camera.external_embed_url) {
                const embedResult = await this.probeEmbedUrl(probeTarget, this.getExternalRequestOptions(camera), {
                    timeoutMs: options.timeoutMs,
                    baseDetails,
                });
                if (embedResult.online || !camera.external_snapshot_url) {
                    this.setCachedProbeResult(cacheKey, probeResolution, embedResult);
                    this.updateDomainHealth(providerDomain, embedResult);
                    return embedResult;
                }

                const snapshotResult = await this.probeSnapshotUrl(camera.external_snapshot_url, this.getExternalRequestOptions(camera), {
                    timeoutMs: options.timeoutMs,
                    baseDetails: {
                        ...baseDetails,
                        usedFallback: true,
                    },
                });

                if (snapshotResult.online) {
                    const assistedResult = {
                        online: true,
                        reason: 'probe_target_mismatch',
                        details: withProbeDetails(snapshotResult.details, {
                            embedProbeReason: embedResult.reason,
                            usedFallback: true,
                        }),
                    };
                    this.setCachedProbeResult(cacheKey, probeResolution, assistedResult);
                    this.updateDomainHealth(providerDomain, assistedResult);
                    return assistedResult;
                }

                this.setCachedProbeResult(cacheKey, probeResolution, embedResult);
                this.updateDomainHealth(providerDomain, embedResult);
                return embedResult;
            }

            if (camera.external_snapshot_url) {
                const snapshotResult = await this.probeSnapshotUrl(
                    probeTarget,
                    this.getExternalRequestOptions(camera),
                    {
                        timeoutMs: options.timeoutMs,
                        baseDetails,
                    }
                );
                this.setCachedProbeResult(cacheKey, probeResolution, snapshotResult);
                this.updateDomainHealth(providerDomain, snapshotResult);
                return snapshotResult;
            }

            const embedResult = await this.probeEmbedUrl(
                probeTarget,
                this.getExternalRequestOptions(camera),
                {
                    timeoutMs: options.timeoutMs,
                    baseDetails,
                }
            );
            this.setCachedProbeResult(cacheKey, probeResolution, embedResult);
            this.updateDomainHealth(providerDomain, embedResult);
            return embedResult;
        }

        if (deliveryType === 'external_unresolved') {
            return {
                online: false,
                reason: 'missing_external_source_metadata',
                details: withProbeDetails(baseDetails, {
                    stream_source: camera.stream_source || null,
                    delivery_type: camera.delivery_type || null,
                    has_private_rtsp: Boolean(camera.private_rtsp_url),
                    has_external_hls_url: Boolean(camera.external_hls_url),
                    has_external_stream_url: Boolean(camera.external_stream_url),
                    has_external_embed_url: Boolean(camera.external_embed_url),
                    has_external_snapshot_url: Boolean(camera.external_snapshot_url),
                }),
            };
        }

        if (deliveryType !== 'internal_hls') {
            return {
                online: camera.enabled === 1,
                reason: 'assumed_online_unknown_delivery',
                details: withProbeDetails(baseDetails),
            };
        }

        if (baseDetails.probe_method === 'internal_probe') {
            baseDetails.runtimeTarget = camera.private_rtsp_url || null;
        }

        const pathName = camera.stream_key || `camera${camera.id}`;
        const pathInfo = activePaths.get(pathName);
        const internalPolicy = buildInternalIngestPolicySummary(camera, {
            internal_ingest_policy_default: camera.area_internal_ingest_policy_default,
            internal_on_demand_close_after_seconds: camera.area_internal_on_demand_close_after_seconds,
        });
        const strictRtspHealth = camera.private_rtsp_url && internalPolicy.isStrictOnDemandProfile;
        baseDetails.policy_mode = internalPolicy.mode;
        baseDetails.close_after_seconds = internalPolicy.closeAfterSeconds;
        baseDetails.source_profile = internalPolicy.sourceProfile;
        baseDetails.pathName = pathName;
        baseDetails.pathConfigured = Boolean(pathInfo?.configured);
        baseDetails.pathReady = Boolean(pathInfo?.ready);
        baseDetails.pathSourceReady = Boolean(pathInfo?.sourceReady);
        baseDetails.reader_count = pathInfo?.readers ?? 0;
        baseDetails.real_viewer_count = pathInfo?.realViewerCount ?? 0;
        baseDetails.has_internal_reader_only = Boolean(pathInfo?.hasInternalReaderOnly);

        if (pathInfo && (pathInfo.ready || pathInfo.sourceReady || pathInfo.readers > 0)) {
            return {
                online: true,
                reason: 'mediamtx_path_ready',
                details: withProbeDetails(baseDetails),
            };
        }

        if (!pathInfo?.configured && camera.private_rtsp_url) {
            const repairResult = await this.ensureInternalCameraPath(camera);
            if (repairResult.success && !strictRtspHealth) {
                return {
                    online: true,
                    reason: 'mediamtx_path_repaired',
                    details: withProbeDetails(baseDetails, {
                        repairedPathName: repairResult.pathName,
                        repairedPathAction: repairResult.action || null,
                    }),
                };
            }
        }

        if (strictRtspHealth) {
            const rtspResult = await this.probeInternalRtspSource(camera.private_rtsp_url);
            return {
                online: rtspResult.online,
                reason: rtspResult.reason,
                details: withProbeDetails(baseDetails, rtspResult.details),
            };
        }

        if (pathInfo?.configured) {
            return {
                online: true,
                reason: 'mediamtx_path_configured_idle',
                details: withProbeDetails(baseDetails),
            };
        }

        if (camera.private_rtsp_url) {
            return {
                online: camera.enabled === 1,
                reason: 'internal_source_unverified_assumed_online',
                details: withProbeDetails(baseDetails),
            };
        }

        return {
            online: false,
            reason: 'internal_stream_unreachable',
            details: withProbeDetails(baseDetails),
        };
    }

    applyWeightedScoring(camera, rawResult) {
        const state = this.ensureCameraState(camera.id, camera.is_online);
        const now = Date.now();
        const errorClass = resolveErrorClass(rawResult.reason);
        const healthMode = this.resolveExternalHealthMode(camera);

        state.lastProbeAt = new Date(now).toISOString();
        state.errorClass = errorClass;
        state.providerDomain = rawResult.details?.providerDomain || state.providerDomain || extractProviderDomain(rawResult.details?.probeTarget || rawResult.details?.runtimeTarget);
        const domainState = this.getDomainState(state.providerDomain);
        state.domainBackoffUntil = domainState?.backoffUntil
            ? new Date(domainState.backoffUntil).toISOString()
            : null;

        if (healthMode === 'disabled' && !shouldForceOfflineForHardConfig(camera, rawResult.reason)) {
            state.failureScore = 0;
            state.needsConfirmation = false;
            state.effectiveOnline = rawResult.reason === 'health_check_disabled'
                ? Boolean(state.effectiveOnline || camera.is_online === 1)
                : true;
            state.stableSuccessCount += 1;
            state.stableFailureCount = 0;
            state.state = 'disabled';
            state.confidence = Math.max(state.confidence || 0.5, 0.6);
        } else if (rawResult.online) {
            const runtimeAssisted = rawResult.reason === 'runtime_recent_success' || rawResult.reason === 'runtime_probe_tls_mismatch';
            const stickyMjpeg = rawResult.reason === 'mjpeg_runtime_recent'
                || rawResult.reason === 'mjpeg_runtime_grace'
                || rawResult.reason === 'mjpeg_runtime_stale'
                || rawResult.reason === 'stale_passive';
            state.failureScore = runtimeAssisted
                ? Math.max(0, state.failureScore - SCORE_DECAY_ON_SUCCESS)
                : 0;
            state.needsConfirmation = false;
            state.effectiveOnline = true;
            state.stableSuccessCount += 1;
            state.stableFailureCount = 0;
            if (rawResult.reason === 'mjpeg_runtime_recent') {
                state.state = 'degraded_runtime_recent';
            } else if (rawResult.reason === 'mjpeg_runtime_grace' || rawResult.reason === 'mjpeg_runtime_stale' || rawResult.reason === 'stale_passive') {
                state.state = 'degraded_runtime_grace';
            } else {
                state.state = runtimeAssisted || stickyMjpeg || rawResult.reason === 'probe_target_mismatch'
                    ? 'degraded'
                    : 'healthy';
            }
            state.confidence = stickyMjpeg
                ? (
                    rawResult.reason === 'mjpeg_runtime_grace' || rawResult.reason === 'mjpeg_runtime_stale'
                        ? Math.max(0.55, state.confidence || 0.5)
                        : Math.max(0.72, state.confidence || 0.6)
                )
                : (runtimeAssisted ? Math.max(0.65, state.confidence || 0.5) : 0.98);
        } else {
            const weight = FAILURE_WEIGHTS[rawResult.reason] ?? 0.3;
            state.failureScore += weight;
            state.stableFailureCount += 1;
            state.stableSuccessCount = 0;
        }

        if (!rawResult.online && shouldForceOfflineForHardConfig(camera, rawResult.reason)) {
            state.failureScore = Math.max(state.failureScore, OFFLINE_SCORE_THRESHOLD);
            state.needsConfirmation = false;
            state.effectiveOnline = false;
        }

        // Only flag for confirmation if we are transitioning online->offline
        if (state.effectiveOnline && state.failureScore >= OFFLINE_SCORE_THRESHOLD) {
            state.needsConfirmation = true;
            state.state = 'suspect';
            state.confidence = Math.min(state.confidence || 0.6, 0.55);
        }

        // Transition offline->online happens instantly
        if (!state.effectiveOnline && state.failureScore === 0) {
            state.effectiveOnline = true;
        }

        if (!rawResult.online && !state.effectiveOnline) {
            const deliveryClassification = getCameraDeliveryProfile(camera).classification;
            if (deliveryClassification === 'external_unresolved') {
                state.state = 'unresolved';
            } else if (
                deliveryClassification === 'external_mjpeg'
                && (healthMode === 'passive_first' || healthMode === 'disabled')
                && rawResult.reason === 'no_runtime_signal'
                && state.lastRuntimeSuccessAt
            ) {
                state.state = 'stale_passive';
            } else {
                state.state = 'offline';
            }
            state.confidence = Math.max(0.15, Math.min(0.45, 1 - Math.min(state.failureScore / OFFLINE_SCORE_THRESHOLD, 1)));
        }

        state.lastReason = rawResult.reason;
        state.lastDetails = rawResult.details || null;
        state.lastStateChangeAt = state.lastStateChangeAt || new Date(now).toISOString();
        this.scheduleNextCameraCheck(camera, state, rawResult);
        return state.effectiveOnline ? 1 : 0;
    }

    async confirmationProbe(camera, activePaths) {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) {
                await new Promise(r => setTimeout(r, 3000));
            }
            
            const rawResult = await this.evaluateCameraRaw(camera, activePaths, {
                timeoutMs: Math.max(20000, Date.now() - this.lastCheck || 20000), // Extended timeout
                bustCache: true
            });
            
            if (rawResult.online) {
                return { confirmed: false, rawResult };
            }
        }
        return { confirmed: true, rawResult: null };
    }

    async evaluateCameraStatus(camera, activePaths, options = {}) {
        this.ensureCameraState(camera.id, camera.is_online);
        const baseRawResult = await this.evaluateCameraRaw(camera, activePaths, options);
        const state = this.healthState.get(camera.id);
        const rawResult = this.applyRuntimeAssist(baseRawResult, state);
        let isOnline = this.applyWeightedScoring(camera, rawResult);
        let effectiveRawResult = rawResult;

        if (state?.needsConfirmation && state.effectiveOnline) {
            const { confirmed, rawResult: confirmationRawResult } = await this.confirmationProbe(camera, activePaths);
            if (confirmed) {
                state.effectiveOnline = false;
                state.needsConfirmation = false;
                state.state = getCameraDeliveryProfile(camera).classification === 'external_unresolved' ? 'unresolved' : 'offline';
                isOnline = 0;
            } else {
                state.failureScore = Math.max(0, state.failureScore - SCORE_DECAY_ON_SUCCESS);
                state.needsConfirmation = false;
                if (confirmationRawResult) {
                    effectiveRawResult = this.applyRuntimeAssist(confirmationRawResult, state);
                    isOnline = this.applyWeightedScoring(camera, effectiveRawResult);
                }
            }
        }

        return {
            camera,
            isOnline,
            rawReason: effectiveRawResult.reason,
            rawDetails: effectiveRawResult.details || null,
        };
    }

    async checkAllCameras() {
        if (this.isChecking) {
            console.log('[CameraHealth] Previous check still running, skipping this tick');
            return;
        }

        this.isChecking = true;

        try {
            this.cleanupProbeCache();
            const activePaths = await this.getActivePaths();
            const cameras = query(`
                SELECT ${SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION}
                FROM cameras c
                LEFT JOIN areas a ON c.area_id = a.id
                WHERE c.enabled = 1
            `);

            const timestamp = getTimestamp();
            const activeCameraIds = new Set(cameras.map((camera) => camera.id));
            const now = Date.now();
            const dueCameras = cameras.filter((camera) => {
                const state = this.ensureCameraState(camera.id, camera.is_online);
                return !state.nextCheckAt || state.nextCheckAt <= now;
            });

            const probeResults = await batchProbe(dueCameras, async (camera) => {
                return this.evaluateCameraStatus(camera, activePaths);
            });

            const finalResults = probeResults
                .filter(p => p.result.status === 'fulfilled')
                .map(p => ({
                    cameraId: p.result.value.camera.id,
                    isOnline: p.result.value.isOnline,
                    timestamp
                }));

            const shouldCheckpoint = now - this.lastCheckpointWriteAt >= CHECKPOINT_DB_WRITE_MS;
            const batchUpdate = transaction((results) => {
                for (const res of results) {
                    execute('UPDATE cameras SET is_online = ?, last_online_check = ? WHERE id = ? AND (is_online != ? OR last_online_check IS NULL OR ? = 1)',
                        [res.isOnline, res.timestamp, res.cameraId, res.isOnline, shouldCheckpoint ? 1 : 0]
                    );
                    cameraRuntimeStateService.upsertRuntimeState(res.cameraId, {
                        is_online: res.isOnline,
                        monitoring_state: deriveMonitoringStateFromOnline(res.isOnline),
                        monitoring_reason: res.isOnline ? 'health_check_online' : 'health_check_offline',
                        last_health_check_at: res.timestamp,
                    });
                }
            });
            batchUpdate(finalResults);
            if (shouldCheckpoint) {
                this.lastCheckpointWriteAt = now;
            }

            let onlineCount = 0;
            let offlineCount = 0;
            let changedCount = 0;
            
            const wentOffline = [];
            const wentOnline = [];

            const processedIds = new Set();
            for (const { result, camera } of probeResults) {
                if (result.status !== 'fulfilled') {
                    console.error(`[CameraHealth] Camera ${camera.id} (${camera.name}) probe failed:`, result.reason?.message || result.reason);
                    continue;
                }

                processedIds.add(camera.id);
                const { camera, isOnline, rawReason } = result.value;
                const statusChanged = camera.is_online !== isOnline;

                if (statusChanged) {
                    await this.handleCameraStatusTransition(camera, camera.is_online, isOnline, rawReason);
                    changedCount += 1;
                    
                    if (isOnline) wentOnline.push(camera);
                    else wentOffline.push(camera);
                }

                if (isOnline) onlineCount += 1;
                else {
                    offlineCount += 1;
                    console.warn(`[CameraHealth] Camera ${camera.id} (${camera.name}) offline reason: ${rawReason}`);
                }
            }

            for (const camera of cameras) {
                if (processedIds.has(camera.id)) {
                    continue;
                }

                const state = this.ensureCameraState(camera.id, camera.is_online);
                if (state.effectiveOnline) {
                    onlineCount += 1;
                } else {
                    offlineCount += 1;
                }
            }

            if (isTelegramConfigured() && (wentOffline.length > 0 || wentOnline.length > 0)) {
                import('./telegramService.js').then(async (telegram) => {
                    const flipFlopIds = new Set(
                        wentOffline.filter(c => wentOnline.some(o => o.id === c.id)).map(c => c.id)
                    );
                    const realOffline = wentOffline.filter(c => !flipFlopIds.has(c.id));
                    const realOnline = wentOnline.filter(c => !flipFlopIds.has(c.id));
                    
                    if (realOffline.length > 0) {
                        for (const cam of realOffline) this.offlineSince.set(cam.id, Date.now());
                        telegram.sendMultipleCamerasOfflineNotification(realOffline).catch(e => console.error(e));
                    }
                    if (realOnline.length > 0) {
                        for (const cam of realOnline) this.offlineSince.delete(cam.id);
                        if (realOnline.length === 1) {
                            telegram.sendCameraOnlineNotification(realOnline[0]).catch(e => console.error(e));
                        } else if (telegram.sendMultipleCamerasOnlineNotification) {
                            telegram.sendMultipleCamerasOnlineNotification(realOnline).catch(e => console.error(e));
                        }
                    }
                }).catch(err => console.error('[CameraHealth] Error loading telegramService', err));
            }

            for (const cameraId of this.healthState.keys()) {
                if (!activeCameraIds.has(cameraId)) {
                    this.healthState.delete(cameraId);
                    this.offlineSince.delete(cameraId);
                }
            }

            this.lastCheck = new Date();
            console.log(`[CameraHealth] Check complete: ${onlineCount} online, ${offlineCount} offline (${changedCount} changed, ${dueCameras.length}/${cameras.length} probed)`);
        } catch (error) {
            console.error('[CameraHealth] Check failed:', error.message);
        } finally {
            this.isChecking = false;
        }
    }

    async getStatus() {
        try {
            const stats = queryOne(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN is_online = 1 THEN 1 ELSE 0 END) as online,
                    SUM(CASE WHEN is_online = 0 OR is_online IS NULL THEN 1 ELSE 0 END) as offline
                FROM cameras
                WHERE enabled = 1
            `);

            return {
                total: stats.total || 0,
                online: stats.online || 0,
                offline: stats.offline || 0,
                lastCheck: this.lastCheck,
                isRunning: this.isRunning
            };
        } catch (error) {
            return {
                total: 0,
                online: 0,
                offline: 0,
                lastCheck: this.lastCheck,
                isRunning: this.isRunning,
                error: error.message
            };
        }
    }

    getHealthDebugSnapshot() {
        const cameras = query(`
            SELECT ${SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION}
            FROM cameras c
            LEFT JOIN areas a ON c.area_id = a.id
            ORDER BY c.enabled DESC, c.id ASC
        `);

        return cameras.map((camera) => {
            const deliveryProfile = getCameraDeliveryProfile(camera);
            const state = this.ensureCameraState(camera.id, camera.is_online);
            const availability = this.getPublicAvailability(camera);
            const monitoring = this.getMonitoringState(camera, state);
            const internalPolicy = buildInternalIngestPolicySummary(camera, {
                internal_ingest_policy_default: camera.area_internal_ingest_policy_default,
                internal_on_demand_close_after_seconds: camera.area_internal_on_demand_close_after_seconds,
            });
            const activePath = this.lastActivePathMap.get(camera.stream_key || `camera${camera.id}`) || null;

            return {
                cameraId: camera.id,
                cameraName: camera.name,
                areaId: camera.area_id || null,
                areaName: camera.area_name || null,
                enabled: camera.enabled,
                lastOnlineCheck: camera.last_online_check || null,
                dbOnline: camera.is_online === 1,
                delivery_type: deliveryProfile.effectiveDeliveryType,
                delivery_classification: deliveryProfile.classification,
                healthStrategy: this.getHealthStrategy(camera),
                healthMode: monitoring.health_mode,
                monitoring_state: monitoring.monitoring_state,
                monitoring_reason: monitoring.monitoring_reason,
                source_profile: camera.source_profile || null,
                policy_mode: internalPolicy.mode,
                close_after_seconds: internalPolicy.closeAfterSeconds,
                camera_policy_override: internalPolicy.cameraPolicyOverride,
                area_policy_default: internalPolicy.areaPolicyDefault,
                path_name: camera.stream_key || `camera${camera.id}`,
                configured: activePath?.configured ?? Boolean(state.lastDetails?.pathConfigured),
                ready: activePath?.ready ?? Boolean(state.lastDetails?.pathReady),
                sourceReady: activePath?.sourceReady ?? Boolean(state.lastDetails?.pathSourceReady),
                reader_count: activePath?.readers ?? (state.lastDetails?.reader_count ?? 0),
                real_viewer_count: activePath?.realViewerCount ?? (state.lastDetails?.real_viewer_count ?? 0),
                has_internal_reader_only: activePath?.hasInternalReaderOnly ?? Boolean(state.lastDetails?.has_internal_reader_only),
                effectiveOnline: state.effectiveOnline,
                state: state.state,
                confidence: state.confidence,
                errorClass: state.errorClass,
                lastReason: state.lastReason,
                lastDetails: state.lastDetails,
                runtimeTarget: state.lastDetails?.runtimeTarget || null,
                probeTarget: state.lastDetails?.probeTarget || null,
                probeMethod: state.lastDetails?.probe_method || null,
                fallbackTarget: state.lastDetails?.fallbackTarget || null,
                usedFallback: state.lastDetails?.usedFallback || false,
                httpStatus: state.lastDetails?.http_status ?? null,
                contentType: state.lastDetails?.content_type || null,
                lastProbeAt: state.lastProbeAt,
                lastRuntimeSuccessAt: state.lastRuntimeSuccessAt ? new Date(state.lastRuntimeSuccessAt).toISOString() : null,
                lastRuntimeFreshAt: state.lastRuntimeFreshAt ? new Date(state.lastRuntimeFreshAt).toISOString() : null,
                lastRuntimeSignalType: state.lastRuntimeSignalType,
                runtimeGraceUntil: state.runtimeGraceUntil ? new Date(state.runtimeGraceUntil).toISOString() : null,
                providerDomain: state.providerDomain,
                domainBackoffUntil: state.domainBackoffUntil,
                tier: state.tier,
                failureScore: state.failureScore,
                needsConfirmation: state.needsConfirmation,
                availability_state: availability.availability_state,
                availability_reason: availability.availability_reason,
                availability_confidence: availability.availability_confidence,
            };
        });
    }

    getHealthDebugPage(queryParams = {}) {
        const normalized = this.normalizeHealthDebugQuery(queryParams);
        const snapshot = this.getHealthDebugSnapshot();
        const summary = this.buildHealthDebugSummary(snapshot);
        const filteredItems = this.filterHealthDebugItems(snapshot, normalized);
        const sortedItems = this.sortHealthDebugItems(filteredItems, normalized.sort);
        const totalItems = sortedItems.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / normalized.limit));
        const currentPage = Math.min(normalized.page, totalPages);
        const startIndex = (currentPage - 1) * normalized.limit;
        const items = sortedItems.slice(startIndex, startIndex + normalized.limit);

        return {
            summary,
            items,
            pagination: {
                page: currentPage,
                limit: normalized.limit,
                totalItems,
                totalPages,
                hasNextPage: currentPage < totalPages,
                hasPreviousPage: currentPage > 1,
            },
            filters: normalized,
        };
    }

    normalizeHealthDebugQuery(queryParams = {}) {
        const normalizeString = (value) => String(value || '').trim();
        const page = Math.max(1, Number.parseInt(queryParams.page, 10) || 1);
        const rawLimit = Number.parseInt(queryParams.limit, 10) || 25;
        const limit = Math.min(Math.max(rawLimit, 1), 100);
        const sort = normalizeString(queryParams.sort) || 'severity';

        return {
            state: normalizeString(queryParams.state).toLowerCase() || 'problem',
            deliveryType: normalizeString(queryParams.deliveryType).toLowerCase(),
            errorClass: normalizeString(queryParams.errorClass).toLowerCase(),
            policyMode: normalizeString(queryParams.policyMode).toLowerCase(),
            sourceProfile: normalizeString(queryParams.sourceProfile).toLowerCase(),
            activeWithoutViewer: normalizeString(queryParams.activeWithoutViewer).toLowerCase(),
            search: normalizeString(queryParams.search).toLowerCase(),
            page,
            limit,
            sort,
        };
    }

    buildHealthDebugSummary(items) {
        return items.reduce((summary, item) => {
            summary.total += 1;

            switch (item.state) {
                case 'healthy':
                    summary.healthy += 1;
                    break;
                case 'degraded':
                case 'suspect':
                case 'degraded_runtime_recent':
                case 'degraded_runtime_grace':
                case 'stale_passive':
                    summary.degraded += 1;
                    break;
                case 'offline':
                    summary.offline += 1;
                    break;
                case 'unresolved':
                    summary.unresolved += 1;
                    break;
                default:
                    break;
            }

            if (item.availability_state === 'online') {
                summary.publicOnline += 1;
            } else if (item.availability_state === 'degraded') {
                summary.publicDegraded += 1;
            } else if (item.availability_state === 'offline') {
                summary.publicOffline += 1;
            } else if (item.availability_state === 'maintenance') {
                summary.maintenance += 1;
            }

            return summary;
        }, {
            total: 0,
            healthy: 0,
            degraded: 0,
            offline: 0,
            unresolved: 0,
            publicOnline: 0,
            publicDegraded: 0,
            publicOffline: 0,
            maintenance: 0,
        });
    }

    filterHealthDebugItems(items, filters) {
        return items.filter((item) => {
            if (filters.state && filters.state !== 'all') {
                if (filters.state === 'problem') {
                    if (!['degraded', 'degraded_runtime_recent', 'degraded_runtime_grace', 'stale_passive', 'suspect', 'offline', 'unresolved'].includes(item.state)) {
                        return false;
                    }
                } else if (filters.state === 'degraded') {
                    if (!['degraded', 'degraded_runtime_recent', 'degraded_runtime_grace', 'stale_passive'].includes(item.state)) {
                        return false;
                    }
                } else if (item.state !== filters.state) {
                    return false;
                }
            }

            if (filters.deliveryType && item.delivery_type?.toLowerCase() !== filters.deliveryType) {
                return false;
            }

            if (filters.errorClass && (item.errorClass || '').toLowerCase() !== filters.errorClass) {
                return false;
            }

            if (filters.policyMode && (item.policy_mode || '').toLowerCase() !== filters.policyMode) {
                return false;
            }

            if (filters.sourceProfile && (item.source_profile || '').toLowerCase() !== filters.sourceProfile) {
                return false;
            }

            if (filters.activeWithoutViewer === 'yes' && !(item.reader_count > 0 && item.real_viewer_count === 0)) {
                return false;
            }

            if (filters.activeWithoutViewer === 'no' && item.reader_count > 0 && item.real_viewer_count === 0) {
                return false;
            }

            if (filters.search) {
                const haystack = [
                    item.cameraName,
                    item.areaName,
                    item.providerDomain,
                    item.lastReason,
                    item.runtimeTarget,
                    item.probeTarget,
                    item.source_profile,
                    item.policy_mode,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();

                if (!haystack.includes(filters.search)) {
                    return false;
                }
            }

            return true;
        });
    }

    sortHealthDebugItems(items, sortKey) {
        const severityRank = {
            offline: 0,
            unresolved: 1,
            suspect: 2,
            degraded: 3,
            degraded_runtime_grace: 3,
            stale_passive: 3,
            degraded_runtime_recent: 4,
            healthy: 5,
        };

        const confidenceValue = (item) => Number(item.confidence ?? 0);
        const normalizedSortKey = String(sortKey || 'severity').toLowerCase();

        return [...items].sort((left, right) => {
            if (normalizedSortKey === 'camera') {
                return String(left.cameraName || '').localeCompare(String(right.cameraName || ''))
                    || Number(left.cameraId || 0) - Number(right.cameraId || 0);
            }

            if (normalizedSortKey === 'confidence') {
                return confidenceValue(left) - confidenceValue(right)
                    || (severityRank[left.state] ?? 99) - (severityRank[right.state] ?? 99)
                    || String(left.cameraName || '').localeCompare(String(right.cameraName || ''));
            }

            return (severityRank[left.state] ?? 99) - (severityRank[right.state] ?? 99)
                || confidenceValue(left) - confidenceValue(right)
                || String(left.cameraName || '').localeCompare(String(right.cameraName || ''))
                || Number(left.cameraId || 0) - Number(right.cameraId || 0);
        });
    }

    getPublicAvailability(camera) {
        if (camera?.status === 'maintenance') {
            return {
                availability_state: 'maintenance',
                availability_reason: 'maintenance',
                availability_confidence: 1,
            };
        }

        const state = this.healthState.get(camera.id) || this.ensureCameraState(camera.id, camera.is_online);
        const lastReason = state.lastReason || null;
        const errorClass = state.errorClass || resolveErrorClass(lastReason);

        if (state.state === 'unresolved' || errorClass === 'config' || HARD_OFFLINE_REASONS.has(lastReason)) {
            return {
                availability_state: 'offline',
                availability_reason: lastReason || 'missing_external_source_metadata',
                availability_confidence: state.confidence ?? 0.2,
            };
        }

        if (state.state === 'healthy') {
            return {
                availability_state: 'online',
                availability_reason: lastReason || 'healthy',
                availability_confidence: state.confidence ?? 0.98,
            };
        }

        if (
            state.state === 'degraded'
            || state.state === 'suspect'
            || state.state === 'degraded_runtime_recent'
            || state.state === 'degraded_runtime_grace'
            || state.state === 'stale_passive'
        ) {
            return {
                availability_state: 'degraded',
                availability_reason: lastReason || state.state,
                availability_confidence: state.confidence ?? 0.65,
            };
        }

        if (state.effectiveOnline) {
            return {
                availability_state: 'degraded',
                availability_reason: lastReason || 'runtime_recent_success',
                availability_confidence: state.confidence ?? 0.65,
            };
        }

        return {
            availability_state: camera.is_online === 0 ? 'offline' : 'online',
            availability_reason: lastReason || (camera.is_online === 0 ? 'db_offline' : 'db_online'),
            availability_confidence: state.confidence ?? (camera.is_online === 0 ? 0.35 : 0.6),
        };
    }

    enrichCameraAvailability(camera) {
        const state = this.healthState.get(camera.id) || this.ensureCameraState(camera.id, camera.is_online);
        return {
            ...camera,
            ...this.getPublicAvailability(camera),
            ...this.getMonitoringState(camera, state),
        };
    }

    async checkCamera(cameraId) {
        try {
            const activePaths = await this.getActivePaths();
            const camera = queryOne(
                `SELECT ${SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION}
                 FROM cameras c
                 LEFT JOIN areas a ON c.area_id = a.id
                 WHERE c.id = ? AND c.enabled = 1`,
                [cameraId]
            );

            if (!camera) {
                return false;
            }

            const result = await this.evaluateCameraStatus(camera, activePaths, { bustCache: true });
            const timestamp = getTimestamp();

            execute(
                'UPDATE cameras SET is_online = ?, last_online_check = ? WHERE id = ? AND (is_online != ? OR last_online_check IS NULL OR ? = 1)',
                [result.isOnline, timestamp, camera.id, result.isOnline, 1]
            );
            cameraRuntimeStateService.upsertRuntimeState(camera.id, {
                is_online: result.isOnline,
                monitoring_state: deriveMonitoringStateFromOnline(result.isOnline),
                monitoring_reason: result.rawReason || (result.isOnline ? 'health_check_online' : 'health_check_offline'),
                last_health_check_at: timestamp,
            });

            if (camera.is_online !== result.isOnline) {
                await this.handleCameraStatusTransition(camera, camera.is_online, result.isOnline, result.rawReason);
            }

            this.lastCheck = new Date();
            return result.isOnline === 1;
        } catch (error) {
            console.error(`[CameraHealth] Check camera ${cameraId} failed:`, error.message);
            return false;
        }
    }
}

const cameraHealthService = new CameraHealthService();

export {
    CameraHealthService,
    buildExternalRequestOptions,
    mapExternalFetchError,
    normalizeExternalTlsMode,
    parsePlaylist,
    probeRtspSource,
};
export default cameraHealthService;



