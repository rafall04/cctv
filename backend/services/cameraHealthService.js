import axios from 'axios';
import net from 'net';
import { config } from '../config/config.js';
import { query, queryOne, execute } from '../database/connectionPool.js';
import {
    sendCameraOfflineNotification,
    sendCameraOnlineNotification,
    isTelegramConfigured
} from './telegramService.js';
import { getTimezone } from './timezoneService.js';

const mediaMtxApiBaseUrl = `${(config.mediamtx?.apiUrl || 'http://localhost:9997').replace(/\/$/, '')}/v3`;

const ONLINE_SUCCESS_THRESHOLD = 2;
const OFFLINE_FAIL_THRESHOLD = 3;
const EXTERNAL_REQUEST_TIMEOUT_MS = 10000;
const EXTERNAL_MAX_PDT_AGE_SEC = 120;
const EXTERNAL_STALE_SEQUENCE_THRESHOLD = 2;

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

    for (const line of lines) {
        if (line.startsWith('#EXT-X-TARGETDURATION:')) {
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
        lastProgramDateTimeMs
    };
}

function resolvePlaylistUrl(baseUrl, childPath) {
    try {
        return new URL(childPath, baseUrl).toString();
    } catch {
        return null;
    }
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
        console.log(`[CameraHealth] Starting health check service (interval: ${intervalMs / 1000}s)`);

        setTimeout(() => {
            this.checkAllCameras().catch((error) => {
                console.error('[CameraHealth] Initial check failed:', error.message);
            });
        }, 10000);

        this.checkInterval = setInterval(() => {
            this.checkAllCameras().catch((error) => {
                console.error('[CameraHealth] Interval check failed:', error.message);
            });
        }, intervalMs);
    }

    stop() {
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
                successStreak: 0,
                failStreak: 0,
                sequenceStaleCount: 0,
                lastMediaSequence: null,
                lastReason: null,
                lastDetails: null
            });
        }
        return this.healthState.get(cameraId);
    }

    async fetchPlaylist(url) {
        try {
            const response = await axios.get(url, {
                timeout: EXTERNAL_REQUEST_TIMEOUT_MS,
                responseType: 'text',
                transformResponse: [(data) => data],
                headers: {
                    Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
                    'User-Agent': 'cctv-healthcheck/1.0'
                },
                validateStatus: (status) => status < 500
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
                reason: error.code || 'request_error',
                status: error.response?.status || null
            };
        }
    }

    evaluateExternalFreshness(cameraId, mediaInfo) {
        const state = this.healthState.get(cameraId);

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

    async probeExternalStream(cameraId, externalHlsUrl) {
        if (!externalHlsUrl) {
            return { online: false, reason: 'missing_external_hls_url' };
        }

        let currentUrl = externalHlsUrl;
        let parsedMedia = null;

        for (let depth = 0; depth < 3; depth += 1) {
            const playlistResponse = await this.fetchPlaylist(currentUrl);
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

    async evaluateCameraRaw(camera, activePaths) {
        if ((camera.stream_source || 'internal') === 'external') {
            return this.probeExternalStream(camera.id, camera.external_hls_url);
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
                    return { online: true, reason: 'rtsp_tcp_online' };
                }
            } catch {
                return { online: false, reason: 'invalid_rtsp_url' };
            }
        }

        if (pathInfo && (pathInfo.ready || pathInfo.sourceReady || pathInfo.readers > 0)) {
            return { online: true, reason: 'mediamtx_path_ready' };
        }

        return { online: false, reason: 'internal_stream_unreachable' };
    }

    applyHysteresis(camera, rawResult) {
        const state = this.ensureCameraState(camera.id, camera.is_online);

        if (rawResult.online) {
            state.successStreak += 1;
            state.failStreak = 0;

            if (state.effectiveOnline || state.successStreak >= ONLINE_SUCCESS_THRESHOLD) {
                state.effectiveOnline = true;
            }
        } else {
            state.failStreak += 1;
            state.successStreak = 0;

            if (!state.effectiveOnline || state.failStreak >= OFFLINE_FAIL_THRESHOLD) {
                state.effectiveOnline = false;
            }
        }

        state.lastReason = rawResult.reason;
        state.lastDetails = rawResult.details || null;

        return state.effectiveOnline ? 1 : 0;
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
                SELECT id, name, location, is_online, stream_key, private_rtsp_url, stream_source, external_hls_url
                FROM cameras
                WHERE enabled = 1
            `);

            const timestamp = getTimestamp();
            const activeCameraIds = new Set(cameras.map((camera) => camera.id));

            const healthResults = await Promise.allSettled(cameras.map(async (camera) => {
                this.ensureCameraState(camera.id, camera.is_online);
                const rawResult = await this.evaluateCameraRaw(camera, activePaths);
                const isOnline = this.applyHysteresis(camera, rawResult);

                return {
                    camera,
                    isOnline,
                    rawReason: rawResult.reason
                };
            }));

            let onlineCount = 0;
            let offlineCount = 0;
            let changedCount = 0;

            for (const result of healthResults) {
                if (result.status !== 'fulfilled') {
                    continue;
                }

                const { camera, isOnline, rawReason } = result.value;

                execute(
                    'UPDATE cameras SET is_online = ?, last_online_check = ? WHERE id = ?',
                    [isOnline, timestamp, camera.id]
                );

                const statusChanged = camera.is_online !== isOnline;
                if (statusChanged) {
                    changedCount += 1;

                    if (isTelegramConfigured()) {
                        if (isOnline) {
                            let downtime = null;
                            if (this.offlineSince.has(camera.id)) {
                                downtime = Math.floor((Date.now() - this.offlineSince.get(camera.id)) / 1000);
                                this.offlineSince.delete(camera.id);
                            }

                            sendCameraOnlineNotification({
                                id: camera.id,
                                name: camera.name,
                                location: camera.location
                            }, downtime).catch((error) => {
                                console.error('[CameraHealth] Failed to send online notification:', error.message);
                            });
                        } else {
                            this.offlineSince.set(camera.id, Date.now());
                            sendCameraOfflineNotification({
                                id: camera.id,
                                name: camera.name,
                                location: camera.location
                            }).catch((error) => {
                                console.error('[CameraHealth] Failed to send offline notification:', error.message);
                            });
                        }
                    }
                }

                if (isOnline) {
                    onlineCount += 1;
                } else {
                    offlineCount += 1;
                }

                if (!isOnline) {
                    console.warn(`[CameraHealth] Camera ${camera.id} (${camera.name}) offline reason: ${rawReason}`);
                }
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

    async checkCamera(cameraId) {
        try {
            const activePaths = await this.getActivePaths();
            const camera = queryOne(
                `SELECT id, name, location, is_online, stream_key, private_rtsp_url, stream_source, external_hls_url
                 FROM cameras
                 WHERE id = ?`,
                [cameraId]
            );

            if (!camera) {
                return false;
            }

            this.ensureCameraState(camera.id, camera.is_online);
            const rawResult = await this.evaluateCameraRaw(camera, activePaths);
            const isOnline = this.applyHysteresis(camera, rawResult);
            const timestamp = getTimestamp();

            execute(
                'UPDATE cameras SET is_online = ?, last_online_check = ? WHERE id = ?',
                [isOnline, timestamp, camera.id]
            );

            this.lastCheck = new Date();
            return isOnline === 1;
        } catch (error) {
            console.error(`[CameraHealth] Check camera ${cameraId} failed:`, error.message);
            return false;
        }
    }
}

const cameraHealthService = new CameraHealthService();

export { CameraHealthService, parsePlaylist };
export default cameraHealthService;



