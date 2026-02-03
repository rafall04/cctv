import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { query, execute } from '../database/database.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const THUMBNAIL_DIR = join(__dirname, '..', 'data', 'thumbnails');
const HLS_BASE_URL = 'http://localhost:8888';

// Ensure thumbnail directory exists
if (!existsSync(THUMBNAIL_DIR)) {
    mkdirSync(THUMBNAIL_DIR, { recursive: true });
    console.log('[Thumbnail] Created directory:', THUMBNAIL_DIR);
}

class ThumbnailService {
    constructor() {
        this.isGenerating = false;
        this.generationInterval = null;
        this.ffmpegAvailable = null;
    }

    /**
     * Check if FFmpeg is available
     */
    async checkFFmpeg() {
        if (this.ffmpegAvailable !== null) {
            return this.ffmpegAvailable;
        }

        try {
            await execAsync('ffmpeg -version', { timeout: 3000 });
            this.ffmpegAvailable = true;
            console.log('[Thumbnail] FFmpeg detected ✓');
            return true;
        } catch (error) {
            this.ffmpegAvailable = false;
            console.warn('[Thumbnail] FFmpeg not found - thumbnail generation disabled');
            console.warn('[Thumbnail] Install FFmpeg: https://ffmpeg.org/download.html');
            return false;
        }
    }

    /**
     * Start periodic thumbnail generation (every 5 minutes)
     */
    async start() {
        // Check FFmpeg availability first
        const hasFFmpeg = await this.checkFFmpeg();
        if (!hasFFmpeg) {
            console.log('[Thumbnail] Service disabled (FFmpeg not available)');
            return;
        }

        console.log('[Thumbnail] Service started - generating every 5 minutes');
        
        // Initial generation after 10 seconds
        setTimeout(() => this.generateAllThumbnails(), 10000);
        
        // Periodic generation every 5 minutes
        this.generationInterval = setInterval(() => {
            this.generateAllThumbnails();
        }, 5 * 60 * 1000);
    }

    /**
     * Stop periodic generation
     */
    stop() {
        if (this.generationInterval) {
            clearInterval(this.generationInterval);
            this.generationInterval = null;
        }
        console.log('[Thumbnail] Service stopped');
    }

    /**
     * Generate thumbnails for all enabled cameras
     */
    async generateAllThumbnails() {
        // Skip if FFmpeg not available
        if (this.ffmpegAvailable === false) {
            return;
        }

        if (this.isGenerating) {
            console.log('[Thumbnail] Generation already in progress, skipping...');
            return;
        }

        this.isGenerating = true;
        const startTime = Date.now();

        try {
            const cameras = query(
                'SELECT id, name, stream_key, enabled FROM cameras WHERE enabled = 1'
            );

            if (cameras.length === 0) {
                console.log('[Thumbnail] No enabled cameras found');
                this.isGenerating = false;
                return;
            }

            console.log(`[Thumbnail] Generating for ${cameras.length} cameras...`);

            let success = 0;
            let failed = 0;

            for (const camera of cameras) {
                if (!camera.stream_key) {
                    console.log(`[Thumbnail] Skipping camera ${camera.id}: no stream_key`);
                    failed++;
                    continue;
                }

                try {
                    console.log(`[Thumbnail] Processing camera ${camera.id} (${camera.name})...`);
                    await this.generateThumbnail(camera.id, camera.stream_key);
                    success++;
                    console.log(`[Thumbnail] ✓ Camera ${camera.id} success`);
                } catch (error) {
                    console.error(`[Thumbnail] ✗ Camera ${camera.id} (${camera.name}) failed:`, error.message);
                    failed++;
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[Thumbnail] Complete: ${success} success, ${failed} failed (${duration}s)`);

        } catch (error) {
            console.error('[Thumbnail] Generation error:', error);
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * Generate thumbnail for single camera
     * Ultra-optimized: 320x180, quality 60, ~10-15KB
     */
    async generateThumbnail(cameraId, streamKey) {
        const hlsUrl = `${HLS_BASE_URL}/${streamKey}/index.m3u8`;
        const outputPath = join(THUMBNAIL_DIR, `${cameraId}.jpg`);
        const tempPath = join(THUMBNAIL_DIR, `${cameraId}_temp.jpg`);

        try {
            // FFmpeg command: ultra-lightweight
            // -vframes 1: ambil 1 frame saja
            // -s 320x180: tiny resolution (16:9 ratio)
            // -q:v 8: JPEG quality ~60% (scale 2-31, lower=better)
            // -loglevel error: suppress verbose output
            const command = `ffmpeg -loglevel error -i "${hlsUrl}" -vframes 1 -s 320x180 -q:v 8 "${tempPath}" -y`;

            await execAsync(command, {
                timeout: 15000, // 15 detik timeout (increased for slow streams)
                maxBuffer: 1024 * 1024 // 1MB buffer
            });

            // Atomic replace (avoid serving partial file)
            if (existsSync(outputPath)) {
                unlinkSync(outputPath);
            }
            
            if (existsSync(tempPath)) {
                renameSync(tempPath, outputPath);
            } else {
                throw new Error('Temp file not created');
            }

            // Update database (path must match static server prefix)
            execute(
                'UPDATE cameras SET thumbnail_path = ?, thumbnail_updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [`/api/thumbnails/${cameraId}.jpg`, cameraId]
            );

            console.log(`[Thumbnail] Generated for camera ${cameraId}`);

        } catch (error) {
            // Cleanup temp file
            if (existsSync(tempPath)) {
                try {
                    unlinkSync(tempPath);
                } catch (cleanupError) {
                    console.error(`[Thumbnail] Cleanup error for ${cameraId}:`, cleanupError.message);
                }
            }
            throw error;
        }
    }

    /**
     * Generate thumbnail on-demand (for newly added camera)
     */
    async generateSingle(cameraId, streamKey) {
        try {
            await this.generateThumbnail(cameraId, streamKey);
            return { success: true };
        } catch (error) {
            console.error(`[Thumbnail] On-demand generation failed for ${cameraId}:`, error.message);
            return { success: false, error: error.message };
        }
    }
}

export default new ThumbnailService();
