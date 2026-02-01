import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, statSync, renameSync, readdirSync } from 'fs';
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

// Failed re-mux tracking (prevent infinite loop on corrupt files)
// Using database for persistence across restarts
const initFailedFilesTable = () => {
    try {
        execute(`
            CREATE TABLE IF NOT EXISTS failed_remux_files (
                camera_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                fail_count INTEGER DEFAULT 1,
                last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (camera_id, filename)
            )
        `);
    } catch (error) {
        console.error('[FailedFiles] Error creating table:', error);
    }
};

// Initialize table on module load
initFailedFilesTable();

// Helper functions for failed files tracking
const isFileFailed = (cameraId, filename) => {
    const result = queryOne(
        'SELECT fail_count FROM failed_remux_files WHERE camera_id = ? AND filename = ?',
        [cameraId, filename]
    );
    return result && result.fail_count >= 3;
};

const incrementFailCount = (cameraId, filename) => {
    try {
        // Try to insert or update
        const existing = queryOne(
            'SELECT fail_count FROM failed_remux_files WHERE camera_id = ? AND filename = ?',
            [cameraId, filename]
        );
        
        if (existing) {
            execute(
                'UPDATE failed_remux_files SET fail_count = fail_count + 1, last_attempt = CURRENT_TIMESTAMP WHERE camera_id = ? AND filename = ?',
                [cameraId, filename]
            );
        } else {
            execute(
                'INSERT INTO failed_remux_files (camera_id, filename, fail_count) VALUES (?, ?, 1)',
                [cameraId, filename]
            );
        }
    } catch (error) {
        console.error('[FailedFiles] Error incrementing fail count:', error);
    }
};

const removeFailedFile = (cameraId, filename) => {
    try {
        execute(
            'DELETE FROM failed_remux_files WHERE camera_id = ? AND filename = ?',
            [cameraId, filename]
        );
    } catch (error) {
        console.error('[FailedFiles] Error removing failed file:', error);
    }
};

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

        // CRITICAL: Initialize cleanup throttle map
        this.lastCleanupTime = {};

        // Start health monitoring
        this.startHealthMonitoring();
        
        // Start periodic segment scanner (fallback if FFmpeg output detection fails)
        this.startSegmentScanner();
        
        // Start background cleanup for corrupt files (gradual, non-blocking)
        this.startBackgroundCleanup();
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

            // FFmpeg command - stream copy with optimized MP4 for seeking
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
                // CRITICAL: Optimized for HTTP Range Requests and seeking
                // - frag_keyframe: Create keyframe-aligned fragments
                // - empty_moov: Put moov atom at start (enables seeking)
                // - default_base_moof: Use default base for moof boxes
                '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
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

                // Detect new segment creation - multiple patterns for different FFmpeg versions
                // Pattern 1: "Opening 'filename.mp4' for writing"
                // Pattern 2: "[segment @ ...] Opening 'filename.mp4' for writing"
                // Pattern 3: Just the filename in output when segment starts
                if ((output.includes('Opening') || output.includes('segment')) && output.includes('.mp4')) {
                    const match = output.match(/(\d{8}_\d{6}\.mp4)/);
                    if (match) {
                        const filename = match[1];
                        console.log(`[FFmpeg] Detected segment creation: ${filename}`);
                        this.onSegmentCreated(cameraId, filename);
                    }
                }
                
                // Additional detection: Look for segment completion messages
                if (output.includes('Closing') && output.includes('.mp4')) {
                    const match = output.match(/(\d{8}_\d{6}\.mp4)/);
                    if (match) {
                        const filename = match[1];
                        console.log(`[FFmpeg] Detected segment completion: ${filename}`);
                        // Don't call onSegmentCreated here, it's already called on Opening
                    }
                }
                
                // Log all segment-related messages for debugging
                if (output.includes('.mp4') && (output.includes('segment') || output.includes('Opening') || output.includes('Closing'))) {
                    console.log(`[FFmpeg Segment Debug] ${output.trim()}`);
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
        // CRITICAL: Check if this file has failed re-mux before (prevent infinite loop)
        if (isFileFailed(cameraId, filename)) {
            // Skip file that has failed 3+ times (likely corrupt)
            return;
        }

        const cameraDir = join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
        const filePath = join(cameraDir, filename);

        console.log(`[Segment] Detected new segment: camera${cameraId}/${filename}`);

        // Optimized wait: 3 seconds (reduced from 15s)
        // FFmpeg should have closed file by now with proper segment settings
        setTimeout(async () => {
            try {
                if (!existsSync(filePath)) {
                    console.warn(`[Segment] File not found: ${filePath}`);
                    return;
                }

                // Quick file size check - 2 times with 2s gaps (reduced from 3x3s)
                console.log(`[Segment] Checking file stability: ${filename}`);
                
                let fileSize1 = statSync(filePath).size;
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                if (!existsSync(filePath)) {
                    console.warn(`[Segment] File disappeared during check: ${filePath}`);
                    return;
                }
                
                let fileSize2 = statSync(filePath).size;

                // If still growing, wait 3s more (reduced from 5s)
                if (fileSize2 > fileSize1) {
                    console.log(`[Segment] File still growing, waiting... (${fileSize1} -> ${fileSize2})`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    if (!existsSync(filePath)) return;
                    fileSize2 = statSync(filePath).size;
                }

                const fileSize = fileSize2;

                console.log(`[Segment] Final file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

                // Skip if file is empty or too small (< 5MB = likely incomplete for 10min segment)
                if (fileSize < 5 * 1024 * 1024) {
                    console.warn(`[Segment] File too small, skipping: ${filename} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
                    return;
                }

                // Reduced wait: 3 seconds (optimized from 5s)
                console.log(`[Segment] Final wait to ensure file is complete: ${filename}`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Quick final check
                if (!existsSync(filePath)) {
                    console.warn(`[Segment] File disappeared: ${filePath}`);
                    return;
                }
                
                const finalCheck = statSync(filePath).size;
                if (Math.abs(finalCheck - fileSize) > 1024 * 100) { // Allow 100KB difference
                    console.log(`[Segment] File still changing (${fileSize} -> ${finalCheck}), will retry later: ${filename}`);
                    return;
                }

                // CRITICAL FIX: Re-mux file to create proper MP4 index for seeking
                console.log(`[Segment] Re-muxing file to fix MP4 index: ${filename}`);
                const tempPath = filePath + '.remux.mp4';
                
                // Clean up any existing temp files first
                if (existsSync(tempPath)) {
                    console.log(`[Segment] Cleaning up existing temp file: ${tempPath}`);
                    unlinkSync(tempPath);
                }
                
                // Quick ffprobe check (with shorter timeout)
                try {
                    const { execSync } = await import('child_process');
                    const ffprobeOutput = execSync(
                        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
                        { encoding: 'utf8', timeout: 3000 } // Reduced from 5s to 3s
                    ).trim();
                    
                    if (!ffprobeOutput || parseFloat(ffprobeOutput) < 1) {
                        console.log(`[Segment] File not ready (duration: ${ffprobeOutput}s), will retry later: ${filename}`);
                        
                        // Track failed attempt in database
                        incrementFailCount(cameraId, filename);
                        
                        return;
                    }
                    
                    console.log(`[Segment] File is complete, duration: ${ffprobeOutput}s`);
                } catch (error) {
                    console.log(`[Segment] ffprobe check failed, file not ready: ${filename}`);
                    
                    // Track failed attempt in database
                    incrementFailCount(cameraId, filename);
                    
                    return;
                }
                
                // Perform re-mux with optimized settings for seeking
                await new Promise((resolve, reject) => {
                    const ffmpeg = spawn('ffmpeg', [
                        '-i', filePath,
                        '-c', 'copy',                    // Copy streams (no re-encode)
                        '-movflags', '+faststart',       // Move moov atom to start (CRITICAL for seeking)
                        '-fflags', '+genpts',            // Generate presentation timestamps
                        '-avoid_negative_ts', 'make_zero', // Normalize timestamps
                        '-y',                            // Overwrite
                        tempPath
                    ]);

                    let ffmpegError = '';
                    ffmpeg.stderr.on('data', (data) => {
                        ffmpegError += data.toString();
                    });

                    ffmpeg.on('close', (code) => {
                        if (code === 0) {
                            console.log(`[Segment] Re-mux successful: ${filename}`);
                            resolve();
                        } else {
                            console.error(`[Segment] Re-mux failed (code ${code}):`, ffmpegError.slice(-500));
                            // Clean up failed temp file
                            if (existsSync(tempPath)) {
                                unlinkSync(tempPath);
                            }
                            reject(new Error(`FFmpeg re-mux failed with code ${code}`));
                        }
                    });

                    ffmpeg.on('error', (error) => {
                        console.error(`[Segment] Re-mux spawn error:`, error);
                        // Clean up on error
                        if (existsSync(tempPath)) {
                            unlinkSync(tempPath);
                        }
                        reject(error);
                    });
                });

                // Replace original with re-muxed file
                if (existsSync(tempPath)) {
                    const tempStats = statSync(tempPath);
                    console.log(`[Segment] Re-muxed file size: ${(tempStats.size / 1024 / 1024).toFixed(2)} MB`);
                    
                    // Delete original and rename temp
                    unlinkSync(filePath);
                    renameSync(tempPath, filePath);
                    
                    console.log(`[Segment] ✓ File replaced with re-muxed version`);
                } else {
                    console.error(`[Segment] Re-muxed file not found: ${tempPath}`);
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

                // Get final file size after re-mux
                const finalStats = statSync(filePath);
                const finalSize = finalStats.size;

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
                        [finalSize, existing.id]
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
                        finalSize,
                        600, // 10 menit
                        filePath
                    ]
                );

                console.log(`✓ Segment saved: camera${cameraId}/${filename} (${(finalSize / 1024 / 1024).toFixed(2)} MB)`);

                // CRITICAL FIX: Wait 3 seconds before cleanup to ensure file is fully written
                // This prevents race condition where cleanup runs before file is saved
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Auto-delete old segments (with safety checks inside)
                this.cleanupOldSegments(cameraId);

            } catch (error) {
                console.error(`[Segment] Error handling segment creation:`, error);
            }
        }, 3000); // Wait 3 seconds initial delay (optimized from 15s)
    }

    /**
     * Cleanup old segments (rolling buffer)
     * CRITICAL FIX: Add safety buffer to prevent deleting files being processed
     */
    cleanupOldSegments(cameraId) {
        try {
            // SAFETY: Don't cleanup if called too frequently (prevent race condition)
            const now = Date.now();
            if (!this.lastCleanupTime) this.lastCleanupTime = {};
            
            const lastCleanup = this.lastCleanupTime[cameraId] || 0;
            const timeSinceLastCleanup = now - lastCleanup;
            
            // Only cleanup once per 60 seconds (prevent race condition with new segments)
            if (timeSinceLastCleanup < 60000) {
                console.log(`[Cleanup] Skipping cleanup for camera ${cameraId} (last cleanup ${Math.round(timeSinceLastCleanup/1000)}s ago)`);
                return;
            }
            
            this.lastCleanupTime[cameraId] = now;

            // First, cleanup database entries for files that don't exist
            // BUT: Only delete entries older than 5 minutes (safety buffer)
            const allSegments = query(
                'SELECT * FROM recording_segments WHERE camera_id = ?',
                [cameraId]
            );

            let cleanedCount = 0;
            allSegments.forEach(segment => {
                // SAFETY: Only cleanup entries older than 5 minutes
                const segmentAge = Date.now() - new Date(segment.start_time).getTime();
                const isOldEnough = segmentAge > 5 * 60 * 1000; // 5 minutes
                
                if (isOldEnough && !existsSync(segment.file_path)) {
                    console.log(`[Cleanup] ⚠️ File not found (age: ${Math.round(segmentAge/60000)}min), deleting DB entry: ${segment.file_path}`);
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

            // CRITICAL FIX: Add safety buffer - keep extra 2 segments (20 minutes)
            // This prevents deleting files that are being processed
            const safetyBuffer = 2;
            const effectiveMaxSegments = maxSegments + safetyBuffer;

            // Delete oldest segments if exceeds max (with safety buffer)
            if (segments.length > effectiveMaxSegments) {
                const toDelete = segments.slice(0, segments.length - effectiveMaxSegments);
                
                console.log(`[Cleanup] Camera ${cameraId}: ${segments.length} segments, max ${maxSegments} (+ ${safetyBuffer} buffer), deleting ${toDelete.length} oldest`);
                
                toDelete.forEach(segment => {
                    // SAFETY: Double-check segment is old enough (at least 15 minutes old)
                    const segmentAge = Date.now() - new Date(segment.start_time).getTime();
                    if (segmentAge < 15 * 60 * 1000) {
                        console.log(`[Cleanup] ⚠️ Skipping recent segment (age: ${Math.round(segmentAge/60000)}min): ${segment.filename}`);
                        return;
                    }
                    
                    // Delete file
                    if (existsSync(segment.file_path)) {
                        unlinkSync(segment.file_path);
                        console.log(`✓ Deleted old segment: ${segment.filename} (age: ${Math.round(segmentAge/60000)}min)`);
                    }

                    // Delete from database
                    execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                });
            } else {
                console.log(`[Cleanup] Camera ${cameraId}: ${segments.length} segments, max ${maxSegments} (+ ${safetyBuffer} buffer), no cleanup needed`);
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
     * Periodic segment scanner - fallback if FFmpeg output detection fails
     * Scans recording folders every 60 seconds for new MP4 files
     */
    startSegmentScanner() {
        // Initial cleanup of temp files
        this.cleanupTempFiles();
        
        setInterval(() => {
            // Get all active recordings
            activeRecordings.forEach((recording, cameraId) => {
                const cameraDir = join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
                
                if (!existsSync(cameraDir)) return;

                try {
                    // Get all MP4 files in directory (exclude temp files)
                    const files = readdirSync(cameraDir)
                        .filter(f => {
                            // Only match: YYYYMMDD_HHMMSS.mp4 (exactly)
                            return /^\d{8}_\d{6}\.mp4$/.test(f);
                        });

                    // Check each file
                    files.forEach(filename => {
                        // CRITICAL: Skip files that have failed re-mux 3+ times (from database)
                        if (isFileFailed(cameraId, filename)) {
                            return;
                        }
                        
                        // Check if already in database
                        const existing = queryOne(
                            'SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?',
                            [cameraId, filename]
                        );

                        if (!existing) {
                            const filePath = join(cameraDir, filename);
                            const stats = statSync(filePath);
                            
                            // Only process files that are at least 30 seconds old (likely complete)
                            const fileAge = Date.now() - stats.mtimeMs;
                            if (fileAge > 30000) {
                                console.log(`[Scanner] Found unregistered segment: ${filename} (age: ${Math.round(fileAge/1000)}s)`);
                                // Trigger segment processing
                                this.onSegmentCreated(cameraId, filename);
                            }
                        }
                    });
                } catch (error) {
                    console.error(`[Scanner] Error scanning camera ${cameraId}:`, error);
                }
            });
        }, 60000); // Scan every 60 seconds
    }

    /**
     * Cleanup temp files from failed re-mux attempts
     */
    cleanupTempFiles() {
        try {
            console.log('[Cleanup] Scanning for temp files...');
            
            if (!existsSync(RECORDINGS_BASE_PATH)) return;
            
            const cameraDirs = readdirSync(RECORDINGS_BASE_PATH);
            let cleanedCount = 0;
            let dbCleanedCount = 0;
            
            cameraDirs.forEach(cameraDir => {
                const fullPath = join(RECORDINGS_BASE_PATH, cameraDir);
                if (!statSync(fullPath).isDirectory()) return;
                
                // Extract camera ID from directory name (e.g., "camera1" -> 1)
                const cameraIdMatch = cameraDir.match(/camera(\d+)/);
                if (!cameraIdMatch) return;
                const cameraId = parseInt(cameraIdMatch[1]);
                
                const files = readdirSync(fullPath);
                files.forEach(file => {
                    // Delete any .temp.mp4 or .remux.mp4 files
                    if (file.includes('.temp.mp4') || file.includes('.remux.mp4')) {
                        const filePath = join(fullPath, file);
                        unlinkSync(filePath);
                        cleanedCount++;
                        console.log(`[Cleanup] Deleted temp file: ${cameraDir}/${file}`);
                    }
                });
                
                // Cleanup database entries for files that don't exist
                const dbSegments = query(
                    'SELECT * FROM recording_segments WHERE camera_id = ?',
                    [cameraId]
                );
                
                dbSegments.forEach(segment => {
                    // SAFETY: Only cleanup entries older than 5 minutes
                    const segmentAge = Date.now() - new Date(segment.start_time || 0).getTime();
                    const isOldEnough = segmentAge > 5 * 60 * 1000; // 5 minutes
                    
                    // Check if filename contains temp extensions or file doesn't exist
                    if (segment.filename.includes('.temp.mp4') || 
                        segment.filename.includes('.remux.mp4') ||
                        (isOldEnough && !existsSync(segment.file_path))) {
                        
                        execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                        dbCleanedCount++;
                        console.log(`[Cleanup] Deleted DB entry: ${segment.filename} (age: ${Math.round(segmentAge/60000)}min)`);
                    }
                });
            });
            
            if (cleanedCount > 0 || dbCleanedCount > 0) {
                console.log(`[Cleanup] ✓ Cleaned up ${cleanedCount} temp files and ${dbCleanedCount} DB entries`);
            } else {
                console.log('[Cleanup] No temp files or orphaned DB entries found');
            }
        } catch (error) {
            console.error('[Cleanup] Error cleaning temp files:', error);
        }
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
     * Background cleanup for corrupt/unregistered files
     * Runs slowly (1 file per 10 seconds) to avoid CPU spike
     * This prevents accumulation of corrupt files that cause infinite loop
     */
    startBackgroundCleanup() {
        console.log('[Cleanup] Starting background cleanup service (1 file per 10s)');
        
        let cleanupQueue = [];
        let isProcessing = false;
        
        // Build cleanup queue every 5 minutes
        const buildQueue = () => {
            try {
                if (!existsSync(RECORDINGS_BASE_PATH)) return;
                
                const cameraDirs = readdirSync(RECORDINGS_BASE_PATH);
                const unregistered = [];
                
                cameraDirs.forEach(cameraDir => {
                    const fullPath = join(RECORDINGS_BASE_PATH, cameraDir);
                    if (!statSync(fullPath).isDirectory()) return;
                    
                    // Extract camera ID
                    const cameraIdMatch = cameraDir.match(/camera(\d+)/);
                    if (!cameraIdMatch) return;
                    const cameraId = parseInt(cameraIdMatch[1]);
                    
                    // Get all MP4 files
                    const files = readdirSync(fullPath)
                        .filter(f => /^\d{8}_\d{6}\.mp4$/.test(f));
                    
                    files.forEach(filename => {
                        // Check if in database
                        const existing = queryOne(
                            'SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?',
                            [cameraId, filename]
                        );
                        
                        if (!existing) {
                            unregistered.push({
                                cameraId,
                                filename,
                                path: join(fullPath, filename)
                            });
                        }
                    });
                });
                
                if (unregistered.length > 0) {
                    console.log(`[Cleanup] Found ${unregistered.length} unregistered files, adding to cleanup queue`);
                    cleanupQueue = unregistered;
                }
            } catch (error) {
                console.error('[Cleanup] Error building queue:', error);
            }
        };
        
        // Build initial queue after 30 seconds (let system stabilize first)
        setTimeout(buildQueue, 30000);
        
        // Rebuild queue every 5 minutes
        setInterval(buildQueue, 5 * 60 * 1000);
        
        // Process queue: 1 file per 10 seconds
        setInterval(async () => {
            if (isProcessing || cleanupQueue.length === 0) return;
            
            isProcessing = true;
            
            try {
                const file = cleanupQueue.shift();
                
                // Double-check file still exists
                if (!existsSync(file.path)) {
                    isProcessing = false;
                    return;
                }
                
                // Check if file is corrupt with ffprobe (3s timeout)
                const { execSync } = await import('child_process');
                try {
                    execSync(`ffprobe -v error "${file.path}"`, { 
                        timeout: 3000,
                        stdio: 'ignore' // Suppress output
                    });
                    
                    // File is valid but unregistered
                    // Don't delete - let segment scanner handle it
                    console.log(`[Cleanup] File valid but unregistered, skipping: ${file.filename}`);
                    
                } catch (error) {
                    // File is corrupt (ffprobe failed)
                    console.log(`[Cleanup] Deleting corrupt file: camera${file.cameraId}/${file.filename}`);
                    unlinkSync(file.path);
                    
                    // Remove from database tracking
                    removeFailedFile(file.cameraId, file.filename);
                }
                
            } catch (error) {
                console.error('[Cleanup] Error processing file:', error);
            } finally {
                isProcessing = false;
            }
        }, 10000); // Process 1 file every 10 seconds
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
