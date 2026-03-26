import axios from 'axios';
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
import { getCameraDeliveryProfile, getEffectiveDeliveryType, getPrimaryExternalStreamUrl } from '../utils/cameraDelivery.js';
import { SHARED_CAMERA_STREAM_PROJECTION } from '../utils/cameraProjection.js';

const mediaMtxApiBaseUrl = `${(config.mediamtx?.apiUrl || 'http://localhost:9997').replace(/\/$/, '')}/v3`;

const EXTERNAL_REQUEST_TIMEOUT_MS = 10000;
const EXTERNAL_MAX_PDT_AGE_SEC = 120;
const EXTERNAL_STALE_SEQUENCE_THRESHOLD = 4; // Increased from 2 to 4 to tolerate CDN caching

const SCORE_DECAY_ON_SUCCESS = 0.5;
const OFFLINE_SCORE_THRESHOLD = 3.0;

const FAILURE_WEIGHTS = {
    'ECONNREFUSED':             1.0,
    'http_404':                 1.0,
    'http_403':                 0.8,
    'tls_verification_failed':  0.8,
    'invalid_rtsp_url':         1.0,
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

function checkTcpPort(host, port, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();

        socket.setTimeout(timeoutMs);

        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('error', () => {
            resolve(false);
        });

        socket.connect(port, host);
    });
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

function withProbeDetails(baseDetails = {}, detailOverrides = {}) {
    return {
        ...baseDetails,
        ...detailOverrides,
    };
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
        this.offlineSince = new Map();
        this.healthState = new Map();
    }

    start(intervalMs = 30000) {
        if (this.isRunning) {
            console.log('[CameraHealth] Service already running');
            return;
        }

        this.isRunning = true;
        this.baseIntervalMs = intervalMs;
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
        const effectiveInterval = this.lastCheckDuration
            ? Math.max(this.baseIntervalMs, Math.ceil(this.lastCheckDuration * 1.5))
            : this.baseIntervalMs;
            
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
                needsConfirmation: false
            });
        }
        return this.healthState.get(cameraId);
    }

    getExternalRequestOptions(camera) {
        return buildExternalRequestOptions(camera?.external_tls_mode);
    }

    getHealthStrategy(camera) {
        return resolveHealthProbeTarget(camera).healthStrategy;
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
                    readers: 0
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
                    readers: 0
                };

                existing.ready = item.ready || false;
                existing.sourceReady = item.sourceReady || false;
                existing.readers = item.readers?.length || 0;

                pathMap.set(item.name, existing);
            }
        } catch (error) {
            console.warn('[CameraHealth] Failed to get active paths:', error.message);
        }

        return pathMap;
    }

    async evaluateCameraRaw(camera, activePaths, options = {}) {
        const probeResolution = resolveHealthProbeTarget(camera);
        const deliveryType = probeResolution.deliveryClassification;
        const baseDetails = {
            delivery_classification: probeResolution.deliveryClassification,
            runtimeTarget: probeResolution.runtimeTarget,
            probeTarget: probeResolution.probeTarget,
            fallbackTarget: probeResolution.fallbackTargets[0] || null,
            probe_method: probeResolution.probeMethod,
            usedFallback: false,
        };

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
            return {
                ...result,
                details: withProbeDetails(baseDetails, result.details),
            };
        }

        if (deliveryType === 'external_mjpeg') {
            const requestOptions = this.getExternalRequestOptions(camera);
            const primaryTarget = probeResolution.probeTarget;
            const fallbackTarget = probeResolution.fallbackTargets[0] || null;

            if (primaryTarget) {
                const streamResult = await this.probeMjpegStream(primaryTarget, requestOptions, {
                    timeoutMs: options.timeoutMs,
                    baseDetails,
                });

                if (streamResult.online || !fallbackTarget) {
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
                    return {
                        online: true,
                        reason: 'probe_target_mismatch',
                        details: withProbeDetails(snapshotResult.details, {
                            streamProbeReason: streamResult.reason,
                            usedFallback: true,
                        }),
                    };
                }

                return streamResult;
            }

            return this.probeSnapshotUrl(fallbackTarget, requestOptions, {
                timeoutMs: options.timeoutMs,
                baseDetails,
            });
        }

        if (deliveryType === 'external_embed' || deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
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
                    return {
                        online: true,
                        reason: 'probe_target_mismatch',
                        details: withProbeDetails(snapshotResult.details, {
                            embedProbeReason: embedResult.reason,
                            usedFallback: true,
                        }),
                    };
                }

                return embedResult;
            }

            if (camera.external_snapshot_url) {
                return this.probeSnapshotUrl(
                    probeTarget,
                    this.getExternalRequestOptions(camera),
                    {
                        timeoutMs: options.timeoutMs,
                        baseDetails,
                    }
                );
            }

            return this.probeEmbedUrl(
                probeTarget,
                this.getExternalRequestOptions(camera),
                {
                    timeoutMs: options.timeoutMs,
                    baseDetails,
                }
            );
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

        if (camera.private_rtsp_url) {
            try {
                const parsedUrl = new URL(camera.private_rtsp_url);
                const host = parsedUrl.hostname;
                const port = parseInt(parsedUrl.port, 10) || 554;
                const tcpOnline = await checkTcpPort(host, port);
                if (tcpOnline) {
                    return {
                        online: true,
                        reason: 'rtsp_tcp_online',
                        details: withProbeDetails(baseDetails, {
                            probeTarget: camera.private_rtsp_url,
                        }),
                    };
                }
            } catch {
                return {
                    online: false,
                    reason: 'invalid_rtsp_url',
                    details: withProbeDetails(baseDetails, {
                        probeTarget: camera.private_rtsp_url,
                    }),
                };
            }
        }

        if (pathInfo && (pathInfo.ready || pathInfo.sourceReady || pathInfo.readers > 0)) {
            return {
                online: true,
                reason: 'mediamtx_path_ready',
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

        if (rawResult.online) {
            // Instant Recovery! A single success wipes out the failure memory completely.
            state.failureScore = 0;
            state.needsConfirmation = false;
            state.effectiveOnline = true;
        } else {
            const weight = FAILURE_WEIGHTS[rawResult.reason] ?? 0.3;
            state.failureScore += weight;
        }

        // Only flag for confirmation if we are transitioning online->offline
        if (state.effectiveOnline && state.failureScore >= OFFLINE_SCORE_THRESHOLD) {
            state.needsConfirmation = true;
        }

        // Transition offline->online happens instantly
        if (!state.effectiveOnline && state.failureScore === 0) {
            state.effectiveOnline = true;
        }

        state.lastReason = rawResult.reason;
        state.lastDetails = rawResult.details || null;
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
        const rawResult = await this.evaluateCameraRaw(camera, activePaths, options);
        const state = this.healthState.get(camera.id);
        let isOnline = this.applyWeightedScoring(camera, rawResult);
        let effectiveRawResult = rawResult;

        if (state?.needsConfirmation && state.effectiveOnline) {
            const { confirmed, rawResult: confirmationRawResult } = await this.confirmationProbe(camera, activePaths);
            if (confirmed) {
                state.effectiveOnline = false;
                state.needsConfirmation = false;
                isOnline = 0;
            } else {
                state.failureScore = Math.max(0, state.failureScore - SCORE_DECAY_ON_SUCCESS);
                state.needsConfirmation = false;
                if (confirmationRawResult) {
                    effectiveRawResult = confirmationRawResult;
                    isOnline = this.applyWeightedScoring(camera, confirmationRawResult);
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
            const activePaths = await this.getActivePaths();
            const cameras = query(`
                SELECT ${SHARED_CAMERA_STREAM_PROJECTION}
                FROM cameras c
                WHERE c.enabled = 1
            `);

            const timestamp = getTimestamp();
            const activeCameraIds = new Set(cameras.map((camera) => camera.id));

            const probeResults = await batchProbe(cameras, async (camera) => {
                return this.evaluateCameraStatus(camera, activePaths);
            });

            const finalResults = probeResults
                .filter(p => p.result.status === 'fulfilled')
                .map(p => ({
                    cameraId: p.result.value.camera.id,
                    isOnline: p.result.value.isOnline,
                    timestamp
                }));

            const batchUpdate = transaction((results) => {
                for (const res of results) {
                    execute('UPDATE cameras SET is_online = ?, last_online_check = ? WHERE id = ?',
                        [res.isOnline, res.timestamp, res.cameraId]
                    );
                }
            });
            batchUpdate(finalResults);

            let onlineCount = 0;
            let offlineCount = 0;
            let changedCount = 0;
            
            const wentOffline = [];
            const wentOnline = [];

            for (const { result, camera } of probeResults) {
                if (result.status !== 'fulfilled') {
                    console.error(`[CameraHealth] Camera ${camera.id} (${camera.name}) probe failed:`, result.reason?.message || result.reason);
                    continue;
                }

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
            console.log(`[CameraHealth] Check complete: ${onlineCount} online, ${offlineCount} offline (${changedCount} changed)`);
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
            SELECT ${SHARED_CAMERA_STREAM_PROJECTION}
            FROM cameras c
            ORDER BY c.enabled DESC, c.id ASC
        `);

        return cameras.map((camera) => {
            const deliveryProfile = getCameraDeliveryProfile(camera);
            const state = this.ensureCameraState(camera.id, camera.is_online);

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
                effectiveOnline: state.effectiveOnline,
                lastReason: state.lastReason,
                lastDetails: state.lastDetails,
                runtimeTarget: state.lastDetails?.runtimeTarget || null,
                probeTarget: state.lastDetails?.probeTarget || null,
                probeMethod: state.lastDetails?.probe_method || null,
                fallbackTarget: state.lastDetails?.fallbackTarget || null,
                usedFallback: state.lastDetails?.usedFallback || false,
                httpStatus: state.lastDetails?.http_status ?? null,
                contentType: state.lastDetails?.content_type || null,
                failureScore: state.failureScore,
                needsConfirmation: state.needsConfirmation,
            };
        });
    }

    async checkCamera(cameraId) {
        try {
            const activePaths = await this.getActivePaths();
            const camera = queryOne(
                `SELECT ${SHARED_CAMERA_STREAM_PROJECTION}
                 FROM cameras c
                 WHERE c.id = ? AND c.enabled = 1`,
                [cameraId]
            );

            if (!camera) {
                return false;
            }

            const result = await this.evaluateCameraStatus(camera, activePaths, { bustCache: true });
            const timestamp = getTimestamp();

            execute(
                'UPDATE cameras SET is_online = ?, last_online_check = ? WHERE id = ?',
                [result.isOnline, timestamp, camera.id]
            );

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
    parsePlaylist
};
export default cameraHealthService;



