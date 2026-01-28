import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, queryOne, execute } from '../database/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base path untuk recordings
const RECORDINGS_BASE_PATH = join(__dirname, '..', '..', 'recordings');

// Active recording processes
const activeRecordings = new Map();

// Stream health monitoring
const streamHealthMap = new Map();

/**
 * Recording Service
 * Handles CCTV recording dengan stream copy (no re-encoding)
 */
class RecordingService {
    constructor() {
        // Ensure recordings directory exists
        if (!existsSync(RECORDINGS_BASE_PATH)) {
            mkdirSync(RECORDINGS_BASE_PATH, { recursive: true });
        }

        // Start health monitoring
        this.startHealthMonitoring();
    }

    /**
     * Start recording untuk camera
     */
    async startRecording(cameraId) {
        try {
            // Check if already recording
            if (activeRecordings.has(cameraId)) {
                console.log(`Camera ${cameraId} already recording`);
                return { success: false, message: 'Already recording' };
            }

            // Get camera data
            const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
            if (!camera) {
                return { success: false, message: 'Camera not found' };
            }

            // Validate RTSP URL
            if (!camera.private_rtsp_url || !camera.private_rtsp_url.startsWith('rtsp://')) {
                console.error(`Invalid RTSP URL for camera ${cameraId}: ${camera.private_rtsp_url}`);
                return { success: false, message: 'Invalid RTSP URL' };
            }

            // Check if camera is enabled
            if (!camera.enabled) {
                return { success: false, message: 'Camera is disabled' };
            }

            // Check if recording is enabled
            if (!camera.enable_recording) {
                return { success: false, message: 'Recording not enabled for this camera' };
            }

            // Create camera recording directory
            const cameraDir = join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
            if (!existsSync(cameraDir)) {
                mkdirSync(cameraDir, { recursive: true });
            }

            console.log(`Starting recording for camera ${cameraId} (${camera.name})`);
            console.log(`RTSP URL: ${camera.private_rtsp_url.replace(/:[^:@]+@/, ':****@')}`); // Hide password

            // FFmpeg command - stream copy with proper MP4 for web
            const outputPattern = join(cameraDir, '%Y%m%d_%H%M%S.mp4');
            const ffmpegArgs = [
                '-rtsp_transport', 'tcp',
                '-i', camera.private_rtsp_url,
                '-map', '0:v',                   // Map video only (skip audio)
                '-c:v', 'copy',                  // Copy video codec (0% CPU)
                '-an',                           // No audio
                '-f', 'segment',                 // Split ke segments
                '-segment_time', '600',          // 10 menit per file (akan dipotong di keyframe terdekat)
                '-segment_format', 'mp4',
                '-segment_format_options', 'movflags=+faststart', // Web-compatible MP4 dengan proper index
                '-segment_atclocktime', '1',     // Align dengan clock time
                '-reset_timestamps', '1',
                '-strftime', '1',
                outputPattern
            ];

            console.log(`FFmpeg recording: stream copy with web-compatible MP4 (0% CPU overhead)`);

            // Spawn ffmpeg process
            const ffmpeg = spawn('ffmpeg', ffmpegArgs);

            // Store process
            activeRecordings.set(cameraId, {
                process: ffmpeg,
                startTime: new Date(),
                camera: camera,
                currentSegment: null
            });

            // Initialize stream health
            streamHealthMap.set(cameraId, {
                lastDataTime: Date.now(),
                restartCount: 0
            });

            // Handle ffmpeg output
            let ffmpegOutput = '';
            
            ffmpeg.stdout.on('data', () => {
                // Update last data time
                const health = streamHealthMap.get(cameraId);
                if (health) {
                    health.lastDataTime = Date.now();
                }
            });

            ffmpeg.stderr.on('data', (data) => {
                const output = data.toString();
                ffmpegOutput += output;
                
                // Update last data time
                const health = streamHealthMap.get(cameraId);
                if (health) {
                    health.lastDataTime = Date.now();
                }

                // Detect new segment creation
                if (output.includes('Opening') && output.includes('.mp4')) {
                    const match = output.match(/(\d{8}_\d{6}\.mp4)/);
                    if (match) {
                        const filename = match[1];
                        this.onSegmentCreated(cameraId, filename);
                    }
                }
                
                // Log errors
                if (output.includes('error') || output.includes('Error') || output.includes('failed')) {
                    console.error(`[FFmpeg Camera ${cameraId}] ${output.trim()}`);
                }
            });

            ffmpeg.on('error', (error) => {
                console.error(`FFmpeg spawn error for camera ${cameraId}:`, error);
                activeRecordings.delete(cameraId);
            });

            ffmpeg.on('close', (code) => {
                if (code !== 0 && code !== null) {
                    console.error(`FFmpeg process for camera ${cameraId} exited with code ${code}`);
                    console.error(`Last FFmpeg output:\n${ffmpegOutput.slice(-1000)}`); // Last 1000 chars
                    this.logRestart(cameraId, 'process_crashed', false);
                } else {
                    console.log(`FFmpeg process for camera ${cameraId} stopped normally`);
                }
                activeRecordings.delete(cameraId);
            });

            // Update camera status
            execute(
                'UPDATE cameras SET recording_status = ?, last_recording_start = ? WHERE id = ?',
                ['recording', new Date().toISOString(), cameraId]
            );

            console.log(`✓ Started recording for camera ${cameraId}`);
            return { success: true, message: 'Recording started' };

        } catch (error) {
            console.error(`Error starting recording for camera ${cameraId}:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Stop recording untuk camera
     */
    async stopRecording(cameraId) {
        try {
            const recording = activeRecordings.get(cameraId);
            if (!recording) {
                return { success: false, message: 'Not recording' };
            }

            // Kill ffmpeg process
            recording.process.kill('SIGTERM');
            activeRecordings.delete(cameraId);
            streamHealthMap.delete(cameraId);

            // Update camera status
            execute(
                'UPDATE cameras SET recording_status = ? WHERE id = ?',
                ['stopped', cameraId]
            );

            console.log(`✓ Stopped recording for camera ${cameraId}`);
            return { success: true, message: 'Recording stopped' };

        } catch (error) {
            console.error(`Error stopping recording for camera ${cameraId}:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Restart recording (untuk auto-restart)
     */
    async restartRecording(cameraId, reason = 'manual') {
        console.log(`Restarting recording for camera ${cameraId}, reason: ${reason}`);
        
        const restartTime = new Date();
        
        // Stop current recording
        await this.stopRecording(cameraId);
        
        // Wait 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Start recording again
        const result = await this.startRecording(cameraId);
        
        // Log restart event
        const recoveryTime = new Date();
        this.logRestart(cameraId, reason, result.success, restartTime, recoveryTime);
        
        return result;
    }

    /**
     * Handle segment creation
     */
    onSegmentCreated(cameraId, filename) {
        const cameraDir = join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
        const filePath = join(cameraDir, filename);

        console.log(`[Segment] Detected new segment: camera${cameraId}/${filename}`);

        // Wait 15 seconds for FFmpeg to finish writing the file
        setTimeout(async () => {
            try {
                if (!existsSync(filePath)) {
                    console.warn(`[Segment] File not found: ${filePath}`);
                    return;
                }

                // Wait for file size to stabilize - check 3 times with 3s gaps
                console.log(`[Segment] Waiting for file size to stabilize: ${filename}`);
                
                let fileSize1 = statSync(filePath).size;
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                if (!existsSync(filePath)) {
                    console.warn(`[Segment] File disappeared during check: ${filePath}`);
                    return;
                }
                
                let fileSize2 = statSync(filePath).size;
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                if (!existsSync(filePath)) {
                    console.warn(`[Segment] File disappeared during check: ${filePath}`);
                    return;
                }
                
                let fileSize3 = statSync(filePath).size;

                // If file still growing, wait one more time
                if (fileSize3 > fileSize2 || fileSize2 > fileSize1) {
                    console.log(`[Segment] File still growing, waiting more... (${fileSize1} -> ${fileSize2} -> ${fileSize3})`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    if (!existsSync(filePath)) return;
                    fileSize3 = statSync(filePath).size;
                }

                const fileSize = fileSize3;

                console.log(`[Segment] Final file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

                // Skip if file is empty or too small (< 5MB = likely incomplete for 10min segment)
                if (fileSize < 5 * 1024 * 1024) {
                    console.warn(`[Segment] File too small, skipping: ${filename} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
                    return;
                }

                // Parse filename untuk get timestamp
                const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
                if (!match) {
                    console.warn(`[Segment] Invalid filename format: ${filename}`);
                    return;
                }

                const [, year, month, day, hour, minute, second] = match;
                const startTime = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
                const endTime = new Date(startTime.getTime() + 10 * 60 * 1000); // +10 menit

                // Check if already in database (prevent duplicates)
                const existing = queryOne(
                    'SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?',
                    [cameraId, filename]
                );

                if (existing) {
                    console.log(`[Segment] Already in database, updating size: ${filename}`);
                    // Update file size if different
                    execute(
                        'UPDATE recording_segments SET file_size = ? WHERE id = ?',
                        [fileSize, existing.id]
                    );
                    return;
                }

                // Save to database
                execute(
                    `INSERT INTO recording_segments 
                    (camera_id, filename, start_time, end_time, file_size, duration, file_path) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        cameraId,
                        filename,
                        startTime.toISOString(),
                        endTime.toISOString(),
                        fileSize,
                        600, // 10 menit
                        filePath
                    ]
                );

                console.log(`✓ Segment saved: camera${cameraId}/${filename} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

                // Auto-delete old segments
                this.cleanupOldSegments(cameraId);

            } catch (error) {
                console.error(`[Segment] Error handling segment creation:`, error);
            }
        }, 15000); // Wait 15 seconds initial delay
    }

    /**
     * Cleanup old segments (rolling buffer)
     */
    cleanupOldSegments(cameraId) {
        try {
            // First, cleanup database entries for files that don't exist
            const allSegments = query(
                'SELECT * FROM recording_segments WHERE camera_id = ?',
                [cameraId]
            );

            let cleanedCount = 0;
            allSegments.forEach(segment => {
                if (!existsSync(segment.file_path)) {
                    execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                    cleanedCount++;
                }
            });

            if (cleanedCount > 0) {
                console.log(`✓ Cleaned ${cleanedCount} orphaned database entries for camera ${cameraId}`);
            }

            // Get camera recording duration
            const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
            if (!camera) return;

            const maxSegments = camera.recording_duration_hours * 6; // 6 segments per jam

            // Get remaining segments (after cleanup)
            const segments = query(
                'SELECT * FROM recording_segments WHERE camera_id = ? ORDER BY start_time ASC',
                [cameraId]
            );

            // Delete oldest segments if exceeds max
            if (segments.length > maxSegments) {
                const toDelete = segments.slice(0, segments.length - maxSegments);
                
                toDelete.forEach(segment => {
                    // Delete file
                    if (existsSync(segment.file_path)) {
                        unlinkSync(segment.file_path);
                        console.log(`✓ Deleted old segment: ${segment.filename}`);
                    }

                    // Delete from database
                    execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                });
            }

        } catch (error) {
            console.error(`Error cleaning up segments for camera ${cameraId}:`, error);
        }
    }

    /**
     * Log restart event
     */
    logRestart(cameraId, reason, success = true, restartTime = new Date(), recoveryTime = null) {
        try {
            execute(
                `INSERT INTO restart_logs 
                (camera_id, reason, restart_time, recovery_time, success) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    cameraId,
                    reason,
                    restartTime.toISOString(),
                    recoveryTime ? recoveryTime.toISOString() : null,
                    success ? 1 : 0
                ]
            );
        } catch (error) {
            console.error('Error logging restart:', error);
        }
    }

    /**
     * Health monitoring - check stream health setiap 5 detik
     */
    startHealthMonitoring() {
        setInterval(() => {
            streamHealthMap.forEach((health, cameraId) => {
                const timeSinceData = Date.now() - health.lastDataTime;
                
                // Get camera info
                const camera = queryOne('SELECT is_tunnel FROM cameras WHERE id = ?', [cameraId]);
                if (!camera) return;

                // Timeout threshold
                const timeout = camera.is_tunnel === 1 ? 10000 : 30000; // 10s untuk tunnel, 30s untuk normal

                // Check if stream frozen
                if (timeSinceData > timeout) {
                    console.log(`⚠️ Camera ${cameraId} stream frozen (${timeSinceData}ms), restarting...`);
                    
                    // Increment restart count
                    health.restartCount++;
                    
                    // Restart recording
                    this.restartRecording(cameraId, 'stream_frozen');
                }
            });
        }, 5000); // Check every 5 seconds
    }

    /**
     * Get recording status
     */
    getRecordingStatus(cameraId) {
        const recording = activeRecordings.get(cameraId);
        const health = streamHealthMap.get(cameraId);

        if (!recording) {
            return {
                isRecording: false,
                status: 'stopped'
            };
        }

        return {
            isRecording: true,
            status: 'recording',
            startTime: recording.startTime,
            duration: Math.floor((Date.now() - recording.startTime.getTime()) / 1000),
            restartCount: health ? health.restartCount : 0
        };
    }

    /**
     * Get storage usage per camera
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
            console.error('Error getting storage usage:', error);
            return { totalSize: 0, segmentCount: 0, totalSizeGB: '0.00' };
        }
    }

    /**
     * Auto-start recordings on service init
     */
    async autoStartRecordings() {
        try {
            const cameras = query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');
            
            for (const camera of cameras) {
                console.log(`Auto-starting recording for camera ${camera.id}...`);
                await this.startRecording(camera.id);
                // Stagger starts
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (error) {
            console.error('Error auto-starting recordings:', error);
        }
    }
}

// Export singleton instance
export const recordingService = new RecordingService();
