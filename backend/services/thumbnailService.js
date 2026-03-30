import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, unlinkSync, copyFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { query, execute } from '../database/database.js';
import { config } from '../config/config.js';
import { getEffectiveDeliveryType, getPrimaryExternalStreamUrl } from '../utils/cameraDelivery.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const THUMBNAIL_DIR = join(__dirname, '..', 'data', 'thumbnails');
const INTERNAL_HLS_BASE_URL = (config.mediamtx?.hlsUrlInternal || 'http://localhost:8888').replace(/\/$/, '');
const THUMBNAIL_INTERVAL_MS = 5 * 60 * 1000;
const THUMBNAIL_CONCURRENCY = 3;
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

    buildFfmpegInputArgs(sourceUrl, externalTlsMode = 'strict') {
        const args = [];
        const normalizedTlsMode = this.normalizeExternalTlsMode(externalTlsMode);
        const isHttps = typeof sourceUrl === 'string' && sourceUrl.startsWith('https://');
        const isRtsp = typeof sourceUrl === 'string' && sourceUrl.startsWith('rtsp://');

        if (isHttps && normalizedTlsMode === 'insecure') {
            args.push('-tls_verify', '0');
        }

        if (isRtsp) {
            args.push('-rtsp_transport', 'tcp');
        }

        args.push('-rw_timeout', '10000000');
        args.push('-i', sourceUrl);
        return args;
    }

    resolveCameraThumbnailStrategy(camera) {
        const deliveryType = getEffectiveDeliveryType(camera);
        const externalStreamUrl = (getPrimaryExternalStreamUrl(camera) || '').trim();
        const externalSnapshotUrl = (camera.external_snapshot_url || '').trim();
        const externalTlsMode = this.normalizeExternalTlsMode(camera.external_tls_mode);
        const privateRtspUrl = typeof camera.private_rtsp_url === 'string' ? camera.private_rtsp_url.trim() : '';

        if (deliveryType === 'internal_hls') {
            if (privateRtspUrl.startsWith('rtsp://')) {
                return {
                    type: 'internal_rtsp',
                    sourceUrl: privateRtspUrl,
                    externalTlsMode,
                };
            }

            if (!camera.stream_key) {
                return { type: 'unavailable', reason: 'missing_internal_stream_key' };
            }

            return {
                type: 'internal_hls',
                sourceUrl: `${INTERNAL_HLS_BASE_URL}/${camera.stream_key}/index.m3u8`,
                externalTlsMode,
            };
        }

        if (deliveryType === 'external_hls') {
            if (externalStreamUrl.startsWith('http://') || externalStreamUrl.startsWith('https://')) {
                return { type: 'external_hls', sourceUrl: externalStreamUrl, externalTlsMode };
            }

            return { type: 'unavailable', reason: 'missing_external_hls_url' };
        }

        if (deliveryType === 'external_mjpeg') {
            if (externalSnapshotUrl) {
                return { type: 'external_snapshot', sourceUrl: externalSnapshotUrl, externalTlsMode };
            }

            if (externalStreamUrl.startsWith('http://') || externalStreamUrl.startsWith('https://')) {
                return { type: 'external_mjpeg', sourceUrl: externalStreamUrl, externalTlsMode };
            }

            return { type: 'placeholder', reason: 'missing_mjpeg_thumbnail_source' };
        }

        if (deliveryType === 'external_embed' || deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
            if (externalSnapshotUrl) {
                return { type: 'external_snapshot', sourceUrl: externalSnapshotUrl, externalTlsMode };
            }

            return { type: 'placeholder', reason: 'missing_external_snapshot_source' };
        }

        return { type: 'unavailable', reason: 'unsupported_delivery_type' };
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

        const strategy = this.resolveCameraThumbnailStrategy(camera);

        this.inFlightCameraIds.add(camera.id);
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
            this.setThumbnailState(camera.id, {
                thumbnail_last_error_reason: error.message,
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
                SELECT c.id, c.name, c.enabled, c.status, c.is_online, c.stream_key, c.stream_source, c.delivery_type,
                       c.private_rtsp_url,
                       external_hls_url, external_stream_url, external_snapshot_url,
                       external_embed_url, external_tls_mode, thumbnail_path,
                       crs.is_online as runtime_is_online
                FROM cameras c
                LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id
                WHERE c.enabled = 1
            `);

            if (cameras.length === 0) {
                console.log('[Thumbnail] No enabled cameras found');
                return;
            }

            console.log(`[Thumbnail] Generating for ${cameras.length} cameras...`);

            let success = 0;
            let failed = 0;
            let cursor = 0;

            const workerCount = Math.min(THUMBNAIL_CONCURRENCY, cameras.length);
            const worker = async () => {
                while (true) {
                    const currentIndex = cursor;
                    cursor += 1;

                    if (currentIndex >= cameras.length) {
                        break;
                    }

                    const camera = cameras[currentIndex];
                    try {
                        const result = await this.processCamera(camera);
                        if (!result?.skipped) {
                            success += 1;
                        }
                    } catch (error) {
                        failed += 1;
                        console.error(`[Thumbnail] Camera ${camera.id} (${camera.name}) failed:`, error.message);
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
                ...this.buildFfmpegInputArgs(strategy.sourceUrl, strategy.externalTlsMode),
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
            console.error(`[Thumbnail] On-demand generation failed for ${cameraId}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async refreshCameraThumbnail(cameraId) {
        const camera = query(
            `SELECT c.id, c.name, c.enabled, c.status, c.is_online, c.stream_key, c.stream_source, c.delivery_type,
                    c.private_rtsp_url, c.external_hls_url, c.external_stream_url, c.external_snapshot_url,
                    c.external_embed_url, c.external_tls_mode, c.thumbnail_path,
                    crs.is_online as runtime_is_online
             FROM cameras c
             LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id
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
