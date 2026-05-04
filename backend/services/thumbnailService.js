/*
Purpose: Generate and maintain camera thumbnail images from internal RTSP/HLS and external stream sources.
Caller: Backend startup thumbnail scheduler, camera recovery hooks, and thumbnail refresh actions.
Deps: ffmpeg, filesystem thumbnail storage, database camera rows, delivery and internal RTSP policy utilities.
MainFuncs: ThumbnailService, buildFfmpegInputArgs(), generateAllThumbnails(), generateSingle(), generateThumbnail().
SideEffects: Executes ffmpeg, writes thumbnail files, updates camera thumbnail metadata in SQLite.
*/

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, unlinkSync, copyFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { query, execute } from '../database/database.js';
import { config } from '../config/config.js';
import { getEffectiveDeliveryType, getPrimaryExternalStreamUrl } from '../utils/cameraDelivery.js';
import { resolveInternalIngestPolicy } from '../utils/internalIngestPolicy.js';
import { buildFfmpegRtspInputArgs, resolveInternalRtspTransport } from '../utils/internalRtspTransportPolicy.js';
import { normalizeThumbnailStrategy } from '../utils/thumbnailStrategyPolicy.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const THUMBNAIL_DIR = join(__dirname, '..', 'data', 'thumbnails');
const INTERNAL_HLS_BASE_URL = (config.mediamtx?.hlsUrlInternal || 'http://localhost:8888').replace(/\/$/, '');
const THUMBNAIL_INTERVAL_MS = 5 * 60 * 1000;
const THUMBNAIL_CONCURRENCY = 3;
const THUMBNAIL_MAX_PER_RUN = 30;
const THUMBNAIL_STALE_MS = 60 * 60 * 1000;
const THUMBNAIL_FAILURE_BACKOFF_BASE_MS = 30 * 60 * 1000;
const THUMBNAIL_FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
const FFMPEG_TIMEOUT_MS = 15000;
const DEFAULT_PLACEHOLDER_COLOR = '0x111827';

if (!existsSync(THUMBNAIL_DIR)) {
    mkdirSync(THUMBNAIL_DIR, { recursive: true });
    console.log('[Thumbnail] Created directory:', THUMBNAIL_DIR);
}

class ThumbnailService {
    constructor() {
        this.isGenerating = false;
        this.generationInterval = null;
        this.ffmpegAvailable = null;
        this.inFlightCameraIds = new Set();
        this.thumbnailState = new Map();
        this.failureBackoff = new Map();
    }

    async checkFFmpeg() {
        if (this.ffmpegAvailable !== null) {
            return this.ffmpegAvailable;
        }

        try {
            await execAsync('ffmpeg -version', { timeout: 3000 });
            this.ffmpegAvailable = true;
            console.log('[Thumbnail] FFmpeg detected');
            return true;
        } catch {
            this.ffmpegAvailable = false;
            console.warn('[Thumbnail] FFmpeg not found - capture thumbnails limited');
            return false;
        }
    }

    async start() {
        const hasFFmpeg = await this.checkFFmpeg();
        if (!hasFFmpeg) {
            console.warn('[Thumbnail] Running without FFmpeg - only retained thumbnails will be available for unsupported sources');
        }

        console.log('[Thumbnail] Service started - generating every 5 minutes');

        setTimeout(() => {
            this.generateAllThumbnails().catch((error) => {
                console.error('[Thumbnail] Initial generation failed:', error.message);
            });
        }, 10000);

        this.generationInterval = setInterval(() => {
            this.generateAllThumbnails().catch((error) => {
                console.error('[Thumbnail] Interval generation failed:', error.message);
            });
        }, THUMBNAIL_INTERVAL_MS);
    }

    stop() {
        if (this.generationInterval) {
            clearInterval(this.generationInterval);
            this.generationInterval = null;
        }
        console.log('[Thumbnail] Service stopped');
    }

    normalizeExternalTlsMode(value) {
        return value === 'insecure' ? 'insecure' : 'strict';
    }

    isStrictOnDemandRtspCamera(camera) {
        return resolveInternalIngestPolicy(camera, {
            internal_ingest_policy_default: camera?.area_internal_ingest_policy_default,
            internal_on_demand_close_after_seconds: camera?.area_internal_on_demand_close_after_seconds,
        }).isStrictOnDemandProfile;
    }

    setThumbnailState(cameraId, patch = {}) {
        const previous = this.thumbnailState.get(cameraId) || {
            thumbnail_source_type: null,
            thumbnail_last_success_at: null,
            thumbnail_last_error_reason: null,
        };

        const next = { ...previous, ...patch };
        this.thumbnailState.set(cameraId, next);
        return next;
    }

    sanitizeErrorMessage(message = '') {
        return String(message).replace(/\b(rtsp|https?):\/\/([^:\s/@]+):([^@\s/]+)@/gi, '$1://****:****@');
    }

    getThumbnailAgeMs(camera) {
        if (!camera?.thumbnail_path || !camera?.thumbnail_updated_at) {
            return Number.POSITIVE_INFINITY;
        }

        const updatedAt = new Date(camera.thumbnail_updated_at).getTime();
        if (!Number.isFinite(updatedAt)) {
            return Number.POSITIVE_INFINITY;
        }

        return Math.max(0, Date.now() - updatedAt);
    }

    isThumbnailStale(camera) {
        return this.getThumbnailAgeMs(camera) >= THUMBNAIL_STALE_MS;
    }

    isInFailureBackoff(cameraId) {
        const state = this.failureBackoff.get(cameraId);
        return Boolean(state && Date.now() < state.nextRetryAt);
    }

    registerThumbnailFailure(cameraId) {
        const previous = this.failureBackoff.get(cameraId) || { failures: 0, nextRetryAt: 0 };
        const failures = previous.failures + 1;
        const backoffMs = Math.min(
            THUMBNAIL_FAILURE_BACKOFF_MAX_MS,
            THUMBNAIL_FAILURE_BACKOFF_BASE_MS * (2 ** (failures - 1))
        );
        this.failureBackoff.set(cameraId, {
            failures,
            nextRetryAt: Date.now() + backoffMs,
        });
    }

    clearThumbnailFailure(cameraId) {
        this.failureBackoff.delete(cameraId);
    }

    isBackgroundThumbnailAllowed(camera) {
        return !this.shouldSkipCamera({
            ...camera,
            _skipStrictOnDemandIdleThumbnail: true,
        }).skipped;
    }

    selectBackgroundThumbnailCandidates(cameras) {
        return cameras
            .filter((camera) => this.isBackgroundThumbnailAllowed(camera))
            .filter((camera) => this.isThumbnailStale(camera))
            .filter((camera) => !this.isInFailureBackoff(camera.id))
            .sort((a, b) => this.getThumbnailAgeMs(b) - this.getThumbnailAgeMs(a))
            .slice(0, THUMBNAIL_MAX_PER_RUN);
    }

    buildFfmpegInputArgs(sourceUrl, externalTlsMode = 'strict', rtspTransport = 'tcp') {
        const args = [];
        const normalizedTlsMode = this.normalizeExternalTlsMode(externalTlsMode);
        const isHttps = typeof sourceUrl === 'string' && sourceUrl.startsWith('https://');
        const isRtsp = typeof sourceUrl === 'string' && sourceUrl.startsWith('rtsp://');

        if (isHttps && normalizedTlsMode === 'insecure') {
            args.push('-tls_verify', '0');
        }

        if (isRtsp) {
            const rtspArgs = buildFfmpegRtspInputArgs(sourceUrl, rtspTransport);
            const inputIndex = rtspArgs.indexOf('-i');
            if (inputIndex >= 0) {
                rtspArgs.splice(inputIndex, 0, '-stimeout', '10000000');
                args.push(...rtspArgs);
                return args;
            }
            args.push('-stimeout', '10000000');
        } else {
            args.push('-rw_timeout', '10000000');
        }

        args.push('-i', sourceUrl);
        return args;
    }

    buildInternalHlsThumbnailStrategy(camera, externalTlsMode) {
        if (!camera.stream_key) {
            return { type: 'unavailable', reason: 'missing_internal_stream_key' };
        }

        return {
            type: 'internal_hls',
            sourceUrl: `${INTERNAL_HLS_BASE_URL}/${camera.stream_key}/index.m3u8`,
            externalTlsMode,
        };
    }

    resolveCameraThumbnailStrategies(camera) {
        const deliveryType = getEffectiveDeliveryType(camera);
        const externalStreamUrl = (getPrimaryExternalStreamUrl(camera) || '').trim();
        const externalSnapshotUrl = (camera.external_snapshot_url || '').trim();
        const externalTlsMode = this.normalizeExternalTlsMode(camera.external_tls_mode);
        const privateRtspUrl = typeof camera.private_rtsp_url === 'string' ? camera.private_rtsp_url.trim() : '';

        if (deliveryType === 'internal_hls') {
            const thumbnailStrategy = normalizeThumbnailStrategy(camera.thumbnail_strategy);
            const hlsStrategy = this.buildInternalHlsThumbnailStrategy(camera, externalTlsMode);

            if (thumbnailStrategy === 'hls_only') {
                return [hlsStrategy];
            }

            if (privateRtspUrl.startsWith('rtsp://')) {
                const rtspStrategy = {
                    type: 'internal_rtsp',
                    sourceUrl: privateRtspUrl,
                    externalTlsMode,
                    rtspTransport: resolveInternalRtspTransport(camera, {
                        internal_rtsp_transport_default: camera?.area_internal_rtsp_transport_default,
                    }),
                };

                if (thumbnailStrategy === 'hls_fallback' && hlsStrategy.type !== 'unavailable') {
                    return [rtspStrategy, hlsStrategy];
                }

                return [rtspStrategy];
            }

            return [hlsStrategy];
        }

        if (deliveryType === 'external_hls') {
            if (externalStreamUrl.startsWith('http://') || externalStreamUrl.startsWith('https://')) {
                return [{ type: 'external_hls', sourceUrl: externalStreamUrl, externalTlsMode }];
            }

            return [{ type: 'unavailable', reason: 'missing_external_hls_url' }];
        }

        if (deliveryType === 'external_mjpeg') {
            if (externalSnapshotUrl) {
                return [{ type: 'external_snapshot', sourceUrl: externalSnapshotUrl, externalTlsMode }];
            }

            if (externalStreamUrl.startsWith('http://') || externalStreamUrl.startsWith('https://')) {
                return [{ type: 'external_mjpeg', sourceUrl: externalStreamUrl, externalTlsMode }];
            }

            return [{ type: 'placeholder', reason: 'missing_mjpeg_thumbnail_source' }];
        }

        if (deliveryType === 'external_embed' || deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
            if (externalSnapshotUrl) {
                return [{ type: 'external_snapshot', sourceUrl: externalSnapshotUrl, externalTlsMode }];
            }

            return [{ type: 'placeholder', reason: 'missing_external_snapshot_source' }];
        }

        return [{ type: 'unavailable', reason: 'unsupported_delivery_type' }];
    }

    resolveCameraThumbnailStrategy(camera) {
        return this.resolveCameraThumbnailStrategies(camera)[0];
    }

    shouldSkipCamera(camera) {
        if (!camera || camera.enabled === 0) {
            return { skipped: true, reason: 'camera_unavailable' };
        }

        if (camera.status === 'maintenance') {
            return { skipped: true, reason: 'camera_maintenance' };
        }

        const deliveryType = getEffectiveDeliveryType(camera);
        const isInternal = deliveryType === 'internal_hls';
        const runtimeOnline = camera.runtime_is_online;

        if (!isInternal && (camera.is_online === 0 || runtimeOnline === 0)) {
            return { skipped: true, reason: 'camera_offline' };
        }

        if (camera?._skipStrictOnDemandIdleThumbnail && this.isStrictOnDemandRtspCamera(camera)) {
            return { skipped: true, reason: 'strict_on_demand_idle_thumbnail' };
        }

        return { skipped: false };
    }

    async processCamera(camera) {
        const skip = this.shouldSkipCamera(camera);
        if (skip.skipped) {
            return skip;
        }

        if (this.inFlightCameraIds.has(camera.id)) {
            return { skipped: true, reason: 'already_in_progress' };
        }

        const strategies = this.resolveCameraThumbnailStrategies(camera);

        this.inFlightCameraIds.add(camera.id);
        let lastError = null;
        try {
            for (let index = 0; index < strategies.length; index += 1) {
                const strategy = strategies[index];

                try {
                    if (strategy.type === 'unavailable') {
                        throw new Error(strategy.reason || 'No valid source URL for thumbnail generation');
                    }

                    if (strategy.type === 'placeholder') {
                        await this.generatePlaceholderThumbnail(camera.id);
                    } else {
                        await this.generateThumbnail(camera.id, strategy);
                    }

                    this.setThumbnailState(camera.id, {
                        thumbnail_source_type: strategy.type,
                        thumbnail_last_success_at: new Date().toISOString(),
                        thumbnail_last_error_reason: null,
                    });
                    return { skipped: false };
                } catch (error) {
                    lastError = error;
                    if (index < strategies.length - 1) {
                        console.warn(`[Thumbnail] Camera ${camera.id} failed with ${strategy.type}, trying fallback: ${this.sanitizeErrorMessage(error.message)}`);
                        continue;
                    }
                }
            }

            throw lastError || new Error('No valid source URL for thumbnail generation');
        } catch (error) {
            this.setThumbnailState(camera.id, {
                thumbnail_last_error_reason: this.sanitizeErrorMessage(error.message),
            });
            throw error;
        } finally {
            this.inFlightCameraIds.delete(camera.id);
        }
    }

    async generateAllThumbnails() {
        if (this.isGenerating) {
            console.log('[Thumbnail] Generation already in progress, skipping');
            return;
        }

        this.isGenerating = true;
        const startTime = Date.now();

        try {
            const cameras = query(`
                SELECT c.id, c.name, c.description, c.enabled, c.status, c.is_online, c.enable_recording, c.stream_key, c.stream_source, c.delivery_type,
                       c.internal_ingest_policy_override, c.internal_on_demand_close_after_seconds_override, c.source_profile,
                       c.internal_rtsp_transport_override,
                       CASE
                            WHEN c.thumbnail_strategy IN ('default', 'direct_rtsp', 'hls_fallback', 'hls_only')
                                THEN c.thumbnail_strategy
                            ELSE 'default'
                       END as thumbnail_strategy,
                       c.private_rtsp_url,
                       external_hls_url, external_stream_url, external_snapshot_url,
                       external_embed_url, external_tls_mode, thumbnail_path, thumbnail_updated_at,
                       crs.is_online as runtime_is_online,
                       CASE
                            WHEN a.internal_ingest_policy_default IN ('default', 'always_on', 'on_demand')
                                THEN a.internal_ingest_policy_default
                            ELSE 'default'
                       END as area_internal_ingest_policy_default,
                       a.internal_on_demand_close_after_seconds as area_internal_on_demand_close_after_seconds,
                       CASE
                            WHEN a.internal_rtsp_transport_default IN ('default', 'tcp', 'udp', 'auto')
                                THEN a.internal_rtsp_transport_default
                            ELSE 'default'
                       END as area_internal_rtsp_transport_default
                FROM cameras c
                LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id
                LEFT JOIN areas a ON a.id = c.area_id
                WHERE c.enabled = 1
            `);

            if (cameras.length === 0) {
                console.log('[Thumbnail] No enabled cameras found');
                return;
            }

            const candidates = this.selectBackgroundThumbnailCandidates(cameras);
            console.log(`[Thumbnail] Generating for ${candidates.length} of ${cameras.length} eligible cameras...`);

            let success = 0;
            let failed = 0;
            let cursor = 0;

            const workerCount = Math.min(THUMBNAIL_CONCURRENCY, candidates.length);
            const worker = async () => {
                while (true) {
                    const currentIndex = cursor;
                    cursor += 1;

                    if (currentIndex >= candidates.length) {
                        break;
                    }

                    const camera = candidates[currentIndex];
                    try {
                        camera._skipStrictOnDemandIdleThumbnail = true;
                        const result = await this.processCamera(camera);
                        if (!result?.skipped) {
                            success += 1;
                            this.clearThumbnailFailure(camera.id);
                        }
                    } catch (error) {
                        failed += 1;
                        this.registerThumbnailFailure(camera.id);
                        console.error(`[Thumbnail] Camera ${camera.id} (${camera.name}) failed:`, this.sanitizeErrorMessage(error.message));
                    }
                }
            };

            await Promise.all(Array.from({ length: workerCount }, () => worker()));

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[Thumbnail] Complete: ${success} success, ${failed} failed (${duration}s)`);
        } catch (error) {
            console.error('[Thumbnail] Generation error:', error.message);
        } finally {
            this.isGenerating = false;
        }
    }

    async updateThumbnailPath(cameraId) {
        execute(
            'UPDATE cameras SET thumbnail_path = ?, thumbnail_updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [`/api/thumbnails/${cameraId}.jpg`, cameraId]
        );
    }

    async generatePlaceholderThumbnail(cameraId) {
        if (this.ffmpegAvailable === false) {
            throw new Error('ffmpeg_unavailable');
        }

        const outputPath = join(THUMBNAIL_DIR, `${cameraId}.jpg`);
        const tempPath = join(THUMBNAIL_DIR, `${cameraId}_temp.jpg`);

        try {
            const ffmpegArgs = [
                '-loglevel', 'error',
                '-f', 'lavfi',
                '-i', `color=c=${DEFAULT_PLACEHOLDER_COLOR}:s=320x180:d=1`,
                '-vframes', '1',
                '-q:v', '8',
                tempPath,
                '-y'
            ];

            await execFileAsync('ffmpeg', ffmpegArgs, {
                timeout: FFMPEG_TIMEOUT_MS,
                maxBuffer: 1024 * 1024,
            });

            if (!existsSync(tempPath)) {
                throw new Error('Temporary placeholder thumbnail was not created');
            }

            copyFileSync(tempPath, outputPath);
            unlinkSync(tempPath);
            await this.updateThumbnailPath(cameraId);
        } catch (error) {
            if (existsSync(tempPath)) {
                try {
                    unlinkSync(tempPath);
                } catch {
                    // Ignore cleanup errors
                }
            }
            throw error;
        }
    }

    async generateThumbnail(cameraId, strategy) {
        if (this.ffmpegAvailable === false) {
            throw new Error('ffmpeg_unavailable');
        }

        const outputPath = join(THUMBNAIL_DIR, `${cameraId}.jpg`);
        const tempPath = join(THUMBNAIL_DIR, `${cameraId}_temp.jpg`);

        try {
            const ffmpegArgs = [
                '-loglevel', 'error',
                ...this.buildFfmpegInputArgs(strategy.sourceUrl, strategy.externalTlsMode, strategy.rtspTransport),
                '-vframes', '1',
                '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2',
                '-q:v', '8',
                tempPath,
                '-y'
            ];

            await execFileAsync('ffmpeg', ffmpegArgs, {
                timeout: FFMPEG_TIMEOUT_MS,
                maxBuffer: 1024 * 1024,
            });

            if (!existsSync(tempPath)) {
                throw new Error('Temporary thumbnail was not created');
            }

            copyFileSync(tempPath, outputPath);
            unlinkSync(tempPath);
            await this.updateThumbnailPath(cameraId);
        } catch (error) {
            if (existsSync(tempPath)) {
                try {
                    unlinkSync(tempPath);
                } catch {
                    // Ignore cleanup errors
                }
            }
            throw error;
        }
    }

    async generateSingle(
        cameraId,
        streamKey,
        streamSource = 'internal',
        externalHlsUrl = null,
        deliveryType = null,
        externalStreamUrl = null,
        externalSnapshotUrl = null,
        externalTlsMode = 'strict'
    ) {
        try {
            const camera = {
                id: cameraId,
                name: `Camera ${cameraId}`,
                stream_key: streamKey,
                stream_source: streamSource,
                delivery_type: deliveryType,
                private_rtsp_url: null,
                external_hls_url: externalHlsUrl,
                external_stream_url: externalStreamUrl,
                external_snapshot_url: externalSnapshotUrl,
                external_tls_mode: externalTlsMode,
            };
            const strategy = this.resolveCameraThumbnailStrategy(camera);

            if (strategy.type === 'unavailable') {
                return { success: false, error: strategy.reason || 'No valid source URL for thumbnail generation' };
            }

            if (strategy.type === 'placeholder') {
                await this.generatePlaceholderThumbnail(cameraId);
                return { success: true, source: 'placeholder' };
            }

            await this.generateThumbnail(cameraId, strategy);
            return { success: true, source: strategy.type };
        } catch (error) {
            console.error(`[Thumbnail] On-demand generation failed for ${cameraId}:`, this.sanitizeErrorMessage(error.message));
            return { success: false, error: this.sanitizeErrorMessage(error.message) };
        }
    }

    async refreshCameraThumbnail(cameraId) {
        const camera = query(
            `SELECT c.id, c.name, c.description, c.enabled, c.status, c.is_online, c.enable_recording, c.stream_key, c.stream_source, c.delivery_type,
                    c.internal_ingest_policy_override, c.internal_on_demand_close_after_seconds_override, c.source_profile,
                    c.internal_rtsp_transport_override,
                    CASE
                        WHEN c.thumbnail_strategy IN ('default', 'direct_rtsp', 'hls_fallback', 'hls_only')
                            THEN c.thumbnail_strategy
                        ELSE 'default'
                    END as thumbnail_strategy,
                    c.private_rtsp_url, c.external_hls_url, c.external_stream_url, c.external_snapshot_url,
                    c.external_embed_url, c.external_tls_mode, c.thumbnail_path,
                    crs.is_online as runtime_is_online,
                    CASE
                        WHEN a.internal_ingest_policy_default IN ('default', 'always_on', 'on_demand')
                            THEN a.internal_ingest_policy_default
                        ELSE 'default'
                    END as area_internal_ingest_policy_default,
                    a.internal_on_demand_close_after_seconds as area_internal_on_demand_close_after_seconds,
                    CASE
                        WHEN a.internal_rtsp_transport_default IN ('default', 'tcp', 'udp', 'auto')
                            THEN a.internal_rtsp_transport_default
                        ELSE 'default'
                    END as area_internal_rtsp_transport_default
             FROM cameras c
             LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id
             LEFT JOIN areas a ON a.id = c.area_id
             WHERE c.id = ?`,
            [cameraId]
        )?.[0];

        const skip = this.shouldSkipCamera(camera);
        if (skip.skipped) {
            return { success: false, skipped: true, reason: skip.reason };
        }

        const result = await this.processCamera(camera);
        if (result?.skipped) {
            return { success: false, skipped: true, reason: result.reason };
        }

        return { success: true };
    }
}

export default new ThumbnailService();
