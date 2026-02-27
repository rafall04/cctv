import { spawn, execFile } from 'child_process';
import { existsSync, mkdirSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { query, queryOne, execute } from '../database/connectionPool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base paths
const RECORDINGS_BASE_PATH = join(__dirname, '..', '..', 'recordings');
const execFileAsync = promisify(execFile);

// State tracking
const activeRecordings = new Map();

/**
 * Ensures a directory exists
 * @param {string} dirPath - The directory path
 */
const ensureDir = (dirPath) => {
    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
    }
};

class RecordingService {
    constructor() {
        ensureDir(RECORDINGS_BASE_PATH);
        
        // Start background tasks with safe intervals (no CPU pegging)
        this.cleanupInterval = setInterval(() => this.runGlobalCleanup(), 60 * 60 * 1000); // 1 hour
        this.healthInterval = setInterval(() => this.monitorHealth(), 30 * 1000); // 30 seconds
        
        // Run initial cleanup
        setTimeout(() => this.runGlobalCleanup(), 5000);
    }

    /**
     * Start recording for a camera
     * @param {number} cameraId
     */
    async startRecording(cameraId) {
        try {
            if (activeRecordings.has(cameraId)) {
                return { success: false, message: 'Already recording' };
            }

            const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
            if (!camera) return { success: false, message: 'Camera not found' };
            if (!camera.enabled) return { success: false, message: 'Camera disabled' };
            if (!camera.enable_recording) return { success: false, message: 'Recording not enabled' };
            if (!camera.private_rtsp_url || !camera.private_rtsp_url.startsWith('rtsp://')) {
                return { success: false, message: 'Invalid RTSP URL' };
            }

            const cameraDir = join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
            ensureDir(cameraDir);

            console.log(`[Recording] Starting camera ${cameraId} (${camera.name})`);

            const outputPattern = join(cameraDir, '%Y%m%d_%H%M%S.mp4');
            const ffmpegArgs = [
                '-rtsp_transport', 'tcp',
                '-i', camera.private_rtsp_url,
                '-c:v', 'copy',                 // 0% CPU streaming copy
                '-an',                          // No audio
                '-f', 'segment',                // Segment muxer
                '-segment_time', '600',         // 10 minutes chunks
                '-reset_timestamps', '1',
                '-segment_format', 'mp4',
                '-segment_atclocktime', '1',
                '-strftime', '1',
                outputPattern
            ];

            const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
            
            const recordingState = {
                process: ffmpeg,
                startTime: Date.now(),
                lastOutputTime: Date.now(),
                cameraDir,
                cameraId,
                camera,
                lastSegment: null,
                restartCount: 0
            };
            
            activeRecordings.set(cameraId, recordingState);

            // Update DB status
            execute(
                'UPDATE cameras SET recording_status = ?, last_recording_start = ? WHERE id = ?',
                ['recording', new Date().toISOString(), cameraId]
            );

            // Handle output for file tracking and health monitoring
            ffmpeg.stderr.on('data', (data) => {
                recordingState.lastOutputTime = Date.now();
                const output = data.toString();
                
                // Track segment creation by reading ffmpeg output
                if (output.includes('Opening') && output.includes('.mp4') && output.includes('for writing')) {
                    const match = output.match(/(\d{8}_\d{6}\.mp4)/);
                    if (match) {
                        const newSegment = match[1];
                        console.log(`[Recording] Camera ${cameraId} opened segment: ${newSegment}`);
                        
                        // If there was a previous segment, it's now fully closed and safe to process!
                        if (recordingState.lastSegment) {
                            this.processCompletedSegment(cameraId, recordingState.lastSegment, cameraDir);
                        }
                        recordingState.lastSegment = newSegment;
                    }
                }
            });

            ffmpeg.on('close', (code) => {
                console.log(`[Recording] Camera ${cameraId} process exited (Code: ${code})`);
                
                // Process the final segment if it exists
                if (recordingState.lastSegment) {
                    this.processCompletedSegment(cameraId, recordingState.lastSegment, cameraDir);
                }

                activeRecordings.delete(cameraId);
                execute('UPDATE cameras SET recording_status = ? WHERE id = ?', ['stopped', cameraId]);
            });

            return { success: true, message: 'Recording started' };
        } catch (error) {
            console.error(`[Recording] Error starting camera ${cameraId}:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Stop recording
     * @param {number} cameraId
     */
    async stopRecording(cameraId) {
        const state = activeRecordings.get(cameraId);
        if (!state) return { success: false, message: 'Not recording' };

        console.log(`[Recording] Stopping camera ${cameraId}...`);
        
        try {
            state.process.kill('SIGTERM');
            
            // Hard kill after 5s if hung
            setTimeout(() => {
                if (activeRecordings.has(cameraId) && !state.process.killed) {
                    console.warn(`[Recording] Camera ${cameraId} hung, sending SIGKILL`);
                    try { state.process.kill('SIGKILL'); } catch (e) {}
                }
            }, 5000);
            
            execute('UPDATE cameras SET recording_status = ? WHERE id = ?', ['stopped', cameraId]);
            return { success: true, message: 'Stop request sent' };
        } catch (error) {
            console.error(`[Recording] Stop error:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Auto start recordings for all enabled cameras
     */
    async autoStartRecordings() {
        console.log('[Recording] Auto-starting recordings...');
        const cameras = query('SELECT id FROM cameras WHERE enabled = 1 AND enable_recording = 1');
        
        for (const camera of cameras) {
            await this.startRecording(camera.id);
            // Stagger start by 1 second to avoid CPU spike on boot
            await new Promise(r => setTimeout(r, 1000));
        }
        console.log(`[Recording] Auto-started ${cameras.length} cameras`);
    }

    /**
     * Get real-time recording status
     * @param {number} cameraId 
     */
    getRecordingStatus(cameraId) {
        const state = activeRecordings.get(cameraId);
        if (!state) {
            return { isRecording: false, status: 'stopped' };
        }

        return {
            isRecording: true,
            status: 'recording',
            startTime: new Date(state.startTime),
            duration: Math.floor((Date.now() - state.startTime) / 1000),
            restartCount: state.restartCount
        };
    }

    /**
     * Get storage usage for a camera
     * @param {number} cameraId 
     */
    getStorageUsage(cameraId) {
        try {
            const result = queryOne(
                'SELECT SUM(file_size) as total_size, COUNT(*) as segment_count FROM recording_segments WHERE camera_id = ?',
                [cameraId]
            );

            return {
                totalSize: result.total_size || 0,
                segmentCount: result.segment_count || 0,
                totalSizeGB: ((result.total_size || 0) / 1024 / 1024 / 1024).toFixed(2)
            };
        } catch (error) {
            console.error(`[Recording] Storage error for ${cameraId}:`, error);
            return { totalSize: 0, segmentCount: 0, totalSizeGB: '0.00' };
        }
    }

    /**
     * Process a fully closed segment without any polling or infinite loops.
     */
    async processCompletedSegment(cameraId, filename, cameraDir) {
        const filePath = join(cameraDir, filename);
        
        try {
            // Verify file exists and has size
            if (!existsSync(filePath)) {
                console.warn(`[Segment] Missing completed file: ${filename}`);
                return;
            }
            
            const stats = statSync(filePath);
            if (stats.size < 500 * 1024) {
                console.warn(`[Segment] File too small, deleting: ${filename}`);
                await fs.unlink(filePath).catch(() => {});
                return;
            }

            console.log(`[Segment] Processing: ${filename} (${(stats.size/1024/1024).toFixed(2)} MB)`);

            // Apply faststart for web seeking (no heavy re-encode)
            const tempPath = filePath + '.faststart.mp4';
            try {
                await execFileAsync('ffmpeg', [
                    '-i', filePath,
                    '-c', 'copy',
                    '-movflags', '+faststart',
                    '-y', tempPath
                ], { timeout: 60000 }); // 60s max to prevent zombies

                // Replace original atomically if successful
                if (existsSync(tempPath) && statSync(tempPath).size > 1024) {
                    await fs.rename(tempPath, filePath);
                }
            } catch (ffmpegErr) {
                console.warn(`[Segment] faststart failed for ${filename}, keeping original.`, ffmpegErr.message);
                if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {});
            }

            // Extract timestamp from filename YYYYMMDD_HHMMSS.mp4
            const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
            if (!match) return;
            
            const [, year, month, day, hour, minute, second] = match;
            const startTimeStr = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
            const startTime = new Date(startTimeStr);
            
            // Get actual duration using ffprobe
            let duration = 600;
            try {
                const { stdout } = await execFileAsync('ffprobe', [
                    '-v', 'error',
                    '-show_entries', 'format=duration',
                    '-of', 'default=noprint_wrappers=1:nokey=1',
                    filePath
                ], { timeout: 5000 });
                if (stdout) duration = Math.round(parseFloat(stdout));
            } catch (e) {}

            const finalSize = statSync(filePath).size;
            
            // Avoid timezone timezone offset issues by storing ISO strictly
            const endTime = new Date(startTime.getTime() + duration * 1000);
            const startDb = startTime.toISOString().replace('T', ' ').substring(0, 19);
            const endDb = endTime.toISOString().replace('T', ' ').substring(0, 19);

            // DB Insert
            const existing = queryOne('SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?', [cameraId, filename]);
            if (!existing) {
                execute(
                    `INSERT INTO recording_segments (camera_id, filename, start_time, end_time, file_size, duration, file_path) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [cameraId, filename, startDb, endDb, finalSize, duration, filePath]
                );
                console.log(`[Segment] ✓ Registered in DB: ${filename}`);
            }

        } catch (error) {
            console.error(`[Segment] Processing error for ${filename}:`, error);
        }
    }

    /**
     * Restarts recording if health is bad
     */
    async monitorHealth() {
        const now = Date.now();
        for (const [cameraId, state] of activeRecordings.entries()) {
            // Tunnel timeout 10s, standard 30s
            const timeout = state.camera.is_tunnel ? 10000 : 30000;
            if (now - state.lastOutputTime > timeout) {
                console.log(`[Health] Camera ${cameraId} frozen, restarting...`);
                state.restartCount++;
                await this.stopRecording(cameraId);
                setTimeout(() => this.startRecording(cameraId), 3000);
            }
        }
    }

    /**
     * Efficient background cleanup that handles both DB and FS
     */
    async runGlobalCleanup() {
        console.log('[Cleanup] Starting global storage cleanup...');
        try {
            const cameras = query('SELECT id, recording_duration_hours FROM cameras');
            
            for (const camera of cameras) {
                const retentionHours = camera.recording_duration_hours || 5;
                const retentionMs = retentionHours * 60 * 60 * 1000;
                const cutoffTime = Date.now() - retentionMs;

                // 1. Clean DB entries
                const segments = query('SELECT id, file_path, start_time FROM recording_segments WHERE camera_id = ?', [camera.id]);
                for (const segment of segments) {
                    const segTime = new Date(segment.start_time).getTime();
                    if (segTime < cutoffTime) {
                        try {
                            if (existsSync(segment.file_path)) {
                                await fs.unlink(segment.file_path);
                            }
                            execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                        } catch (err) {
                            console.error(`[Cleanup] Failed to delete DB segment: ${segment.file_path}`, err);
                        }
                    } else if (!existsSync(segment.file_path) && (Date.now() - segTime > 60*60*1000)) {
                        // Orphan DB entry > 1 hour old
                        execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                    }
                }

                // 2. Clean orphaned filesystem files
                const cameraDir = join(RECORDINGS_BASE_PATH, `camera${camera.id}`);
                if (existsSync(cameraDir)) {
                    const files = await fs.readdir(cameraDir);
                    for (const file of files) {
                        const filePath = join(cameraDir, file);
                        const stats = statSync(filePath);
                        if (Date.now() - stats.mtimeMs > retentionMs) {
                            try {
                                await fs.unlink(filePath);
                                console.log(`[Cleanup] Deleted orphaned file: ${file}`);
                            } catch (e) {}
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[Cleanup] Global cleanup error:', error);
        }
    }
}

export const recordingService = new RecordingService();
