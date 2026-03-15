import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, unlinkSync, copyFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { query, execute } from '../database/database.js';
import { config } from '../config/config.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const THUMBNAIL_DIR = join(__dirname, '..', 'data', 'thumbnails');
const INTERNAL_HLS_BASE_URL = (config.mediamtx?.hlsUrlInternal || 'http://localhost:8888').replace(/\/$/, '');
const THUMBNAIL_INTERVAL_MS = 5 * 60 * 1000;
const THUMBNAIL_CONCURRENCY = 3;
const FFMPEG_TIMEOUT_MS = 15000;

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
            console.warn('[Thumbnail] FFmpeg not found - thumbnail generation disabled');
            return false;
        }
    }

    async start() {
        const hasFFmpeg = await this.checkFFmpeg();
        if (!hasFFmpeg) {
            console.log('[Thumbnail] Service disabled (FFmpeg not available)');
            return;
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

    resolveCameraHlsUrl(camera) {
        if ((camera.stream_source || 'internal') === 'external') {
            const url = (camera.external_hls_url || '').trim();
            if (url.startsWith('http://') || url.startsWith('https://')) {
                return url;
            }
            return null;
        }

        if (!camera.stream_key) {
            return null;
        }

        return `${INTERNAL_HLS_BASE_URL}/${camera.stream_key}/index.m3u8`;
    }

    async processCamera(camera) {
        if (camera.is_online === 0) {
            return { skipped: true, reason: 'camera_offline' };
        }

        if (this.inFlightCameraIds.has(camera.id)) {
            return { skipped: true, reason: 'already_in_progress' };
        }

        const hlsUrl = this.resolveCameraHlsUrl(camera);

        if (!hlsUrl) {
            throw new Error('No valid HLS URL for camera source');
        }

        this.inFlightCameraIds.add(camera.id);
        try {
            await this.generateThumbnail(camera.id, hlsUrl);
            return { skipped: false };
        } finally {
            this.inFlightCameraIds.delete(camera.id);
        }
    }

    async generateAllThumbnails() {
        if (this.ffmpegAvailable === false) {
            return;
        }

        if (this.isGenerating) {
            console.log('[Thumbnail] Generation already in progress, skipping');
            return;
        }

        this.isGenerating = true;
        const startTime = Date.now();

        try {
            const cameras = query(`
                SELECT id, name, is_online, stream_key, stream_source, external_hls_url
                FROM cameras
                WHERE enabled = 1 AND is_online = 1
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

    async generateThumbnail(cameraId, hlsUrl) {
        const outputPath = join(THUMBNAIL_DIR, `${cameraId}.jpg`);
        const tempPath = join(THUMBNAIL_DIR, `${cameraId}_temp.jpg`);

        try {
            const ffmpegArgs = [
                '-loglevel', 'error',
                '-rw_timeout', '10000000',
                '-i', hlsUrl,
                '-vframes', '1',
                '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2',
                '-q:v', '8',
                tempPath,
                '-y'
            ];

            await execFileAsync('ffmpeg', ffmpegArgs, {
                timeout: FFMPEG_TIMEOUT_MS,
                maxBuffer: 1024 * 1024
            });

            if (!existsSync(tempPath)) {
                throw new Error('Temporary thumbnail was not created');
            }

            copyFileSync(tempPath, outputPath);
            unlinkSync(tempPath);

            execute(
                'UPDATE cameras SET thumbnail_path = ?, thumbnail_updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [`/api/thumbnails/${cameraId}.jpg`, cameraId]
            );
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

    async generateSingle(cameraId, streamKey, streamSource = 'internal', externalHlsUrl = null) {
        try {
            const camera = {
                id: cameraId,
                stream_key: streamKey,
                stream_source: streamSource,
                external_hls_url: externalHlsUrl
            };
            const hlsUrl = this.resolveCameraHlsUrl(camera);

            if (!hlsUrl) {
                return { success: false, error: 'No valid source URL for thumbnail generation' };
            }

            await this.generateThumbnail(cameraId, hlsUrl);
            return { success: true };
        } catch (error) {
            console.error(`[Thumbnail] On-demand generation failed for ${cameraId}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async refreshCameraThumbnail(cameraId) {
        if (this.ffmpegAvailable === false) {
            return { success: false, skipped: true, reason: 'ffmpeg_unavailable' };
        }

        const camera = query(
            `SELECT id, name, enabled, is_online, stream_key, stream_source, external_hls_url
             FROM cameras
             WHERE id = ?`,
            [cameraId]
        )?.[0];

        if (!camera || !camera.enabled) {
            return { success: false, skipped: true, reason: 'camera_unavailable' };
        }

        if (camera.is_online !== 1) {
            return { success: false, skipped: true, reason: 'camera_offline' };
        }

        const result = await this.processCamera(camera);
        if (result?.skipped) {
            return { success: false, skipped: true, reason: result.reason };
        }

        return { success: true };
    }
}

export default new ThumbnailService();
