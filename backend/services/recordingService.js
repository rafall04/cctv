import os from 'os';

import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, statSync, renameSync, readdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, queryOne, execute } from '../database/connectionPool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base path untuk recordings
const RECORDINGS_BASE_PATH = join(__dirname, '..', '..', 'recordings');

// Active recording processes
const activeRecordings = new Map();

// Stream health monitoring
const streamHealthMap = new Map();

// CRITICAL: Track files being processed (prevent deletion during remux)
const filesBeingProcessed = new Set();

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

        // CRITICAL: Start scheduled cleanup (every 30 minutes)
        // This replaces per-segment cleanup to prevent aggressive deletion
        this.startScheduledCleanup();
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
                // MEMORY SAFETY: Cap ffmpegOutput to prevent unbounded memory growth
                // FFmpeg can run for days; without this, the string grows indefinitely
                if (ffmpegOutput.length > 5000) {
                    ffmpegOutput = ffmpegOutput.slice(-5000);
                }

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
                    console.error(`Last FFmpeg output:
${ffmpegOutput.slice(-1000)}`); // Last 1000 chars
                    this.logRestart(cameraId, 'process_crashed', false);
                } else {
                    console.log(`FFmpeg process for camera ${cameraId} stopped normally`);
                }
                // AUTHORITATIVE REMOVAL: Only remove from activeRecordings when process is truly dead
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

            const process = recording.process;
            console.log(`Stopping recording for camera ${cameraId} (PID: ${process.pid})`);

            // Kill ffmpeg process with SIGTERM first, then SIGKILL if it hangs
            process.kill('SIGTERM');

            // Fallback to SIGKILL after 5 seconds if still running
            const killTimeout = setTimeout(() => {
                try {
                    if (process && !process.killed) {
                        console.warn(`FFmpeg process ${process.pid} for camera ${cameraId} hung, sending SIGKILL...`);
                        process.kill('SIGKILL');
                    }
                } catch (e) {
                    // Process might be gone already
                }
            }, 5000);

            // Ensure camera ID is removed ONLY after the process fully exits
            // We use a promise to wait for closure if needed, or rely on the 'close' listener already in startRecording
            // However, stopRecording should be authoritative.
            // Let's modify the close listener in startRecording to be the source of truth for activeRecordings.delete

            streamHealthMap.delete(cameraId);

            // Update camera status immediately to UI
            execute(
                'UPDATE cameras SET recording_status = ? WHERE id = ?',
                ['stopped', cameraId]
            );

            console.log(`✓ Requested stop for camera ${cameraId}`);
            return { success: true, message: 'Stop request sent' };

        } catch (error) {
            console.error(`Error stopping recording for camera ${cameraId}:`, error);
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
     * 
     * ROBUST APPROACH:
     * 1. Try re-mux MAX 2 times
     * 2. If re-mux fails → still register to DB (user can still try to play)
     * 3. Cleanup based on filename timestamp (not database)
     * 
     * This ensures:
     * - No segment is lost due to connection errors
     * - User can still see all segments in playback
     * - Storage is managed by cleanup based on filename timestamp
     */
    onSegmentCreated(cameraId, filename) {
        const cameraDir = join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
        const filePath = join(cameraDir, filename);

        // CRITICAL: Mark file as being processed (prevent deletion + duplicate processing)
        const fileKey = `${cameraId}:${filename}`;

        // BUG FIX #2: Prevent duplicate processing
        if (filesBeingProcessed.has(fileKey)) {
            console.log(`[Segment] Already processing: ${filename}, skipping duplicate`);
            return;
        }

        filesBeingProcessed.add(fileKey);

        console.log(`[Segment] Detected new segment: camera${cameraId}/${filename}`);

        // Wait for file stability (not just heuristic setTimeout)
        // Check for file existence + size stability + file being closed by ffmpeg (if possible)
        const checkStability = async () => {
            const maxRetries = 10;
            const retryInterval = 1000;
            let lastSize = -1;
            let stableCount = 0;

            for (let i = 0; i < maxRetries; i++) {
                if (!existsSync(filePath)) {
                    return false;
                }

                const stats = statSync(filePath);
                const currentSize = stats.size;

                if (currentSize > 0 && currentSize === lastSize) {
                    stableCount++;
                } else {
                    stableCount = 0;
                }

                lastSize = currentSize;

                // If size is stable for 3 checks (3 seconds), it's probably done
                if (stableCount >= 3) {
                    return true;
                }

                await new Promise(resolve => setTimeout(resolve, retryInterval));
            }
            return false;
        };
        setTimeout(async () => {
            try {
                // BUG FIX #1: Ensure cleanup in ALL exit paths
                const cleanup = () => {
                    filesBeingProcessed.delete(fileKey);
                };

                if (!existsSync(filePath)) {
                    console.warn(`[Segment] File not found: ${filePath}`);
                    cleanup();
                    return;
                }

                // Quick file size check - 2 times with 2s gaps (reduced from 3x3s)
                console.log(`[Segment] Checking file stability: ${filename}`);

                let fileSize1 = statSync(filePath).size;
                await new Promise(resolve => setTimeout(resolve, 2000));

                if (!existsSync(filePath)) {
                    console.warn(`[Segment] File disappeared during check: ${filePath}`);
                    cleanup();
                    return;
                }

                let fileSize2 = statSync(filePath).size;

                // If still growing, wait 3s more (reduced from 5s)
                if (fileSize2 > fileSize1) {
                    console.log(`[Segment] File still growing, waiting... (${fileSize1} -> ${fileSize2})`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    if (!existsSync(filePath)) {
                        cleanup();
                        return;
                    }
                    fileSize2 = statSync(filePath).size;
                }

                const fileSize = fileSize2;

                console.log(`[Segment] Final file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
                // CRITICAL FIX: Lower threshold to 500KB (from 5MB) to handle tunnel reconnect
                // This allows files as short as 30 seconds to be saved and playable
                // Reasoning: 1.5Mbps bitrate × 30s = ~5.6MB, but with compression ~500KB minimum
                if (fileSize < 500 * 1024) {
                    console.warn(`[Segment] File too small (< 500KB), likely corrupt or empty: ${filename} (${(fileSize / 1024).toFixed(2)} KB)`);
                    // BUG FIX: Delete the corrupt/empty file from disk instead of just skipping
                    // Previously this file was left on disk forever since it's not in DB
                    try {
                        await fsPromises.unlink(filePath);
                        console.log(`[Segment] ✓ Deleted corrupt/empty file: ${filename}`);
                    } catch (delErr) {
                        console.error(`[Segment] Failed to delete corrupt file ${filename}:`, delErr.message);
                    }
                    cleanup();
                    return;
                }

                // Log if file is smaller than expected (< 5MB for 10min segment)
                if (fileSize < 5 * 1024 * 1024) {
                    console.log(`[Segment] ⚠️ File smaller than expected (likely from reconnect): ${filename} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
                }

                // CRITICAL FIX: Re-mux file to create proper MP4 index for seeking
                // Skip ffprobe check - go straight to re-mux (robust approach)
                console.log(`[Segment] Re-muxing file to fix MP4 index: ${filename}`);
                const tempPath = filePath + '.remux.mp4';

                // Clean up any existing temp files first
                if (existsSync(tempPath)) {
                    console.log(`[Segment] Cleaning up existing temp file: ${tempPath}`);
                    unlinkSync(tempPath);
                }

                // Default duration from filename (10 minutes = 600 seconds)
                // Will be updated if re-mux succeeds
                let actualDuration = 600;
                let reMuxSuccess = false;

                // Try re-mux MAX 2 times
                const MAX_RETRY = 2;
                for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
                    try {
                        console.log(`[Segment] Re-mux attempt ${attempt}/${MAX_RETRY}: ${filename}`);
                        
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
                                    console.log(`[Segment] Re-mux successful (attempt ${attempt}): ${filename}`);
                                    resolve();
                                } else {
                                    console.error(`[Segment] Re-mux failed (attempt ${attempt}, code ${code}):`, ffmpegError.slice(-500));
                                    if (existsSync(tempPath)) {
                                        unlinkSync(tempPath);
                                    }
                                    reject(new Error(`FFmpeg re-mux failed with code ${code}`));
                                }
                            });

                            ffmpeg.on('error', (error) => {
                                console.error(`[Segment] Re-mux spawn error (attempt ${attempt}):`, error);
                                if (existsSync(tempPath)) {
                                    unlinkSync(tempPath);
                                }
                                reject(error);
                            });
                        });

                        // Re-mux succeeded!
                        reMuxSuccess = true;
                        break;
                        
                    } catch (remuxError) {
                        console.warn(`[Segment] Re-mux attempt ${attempt} failed:`, remuxError.message);
                        if (attempt === MAX_RETRY) {
                            console.error(`[Segment] All ${MAX_RETRY} re-mux attempts failed for: ${filename}`);
                        }
                    }
                }

                // 🛡️ ATOMIC DATA SAFETY - Replace original with re-muxed file (only if re-mux succeeded)
                if (reMuxSuccess && existsSync(tempPath)) {
                    const tempStats = statSync(tempPath);
                    console.log(`[Segment] Re-muxed file size: ${(tempStats.size / 1024 / 1024).toFixed(2)} MB`);

                    try {
                        // Atomic rename: overwrites filePath in single operation (no gap)
                        // If crash occurs during rename, either old or new file exists (never both missing)
                        await fsPromises.rename(tempPath, filePath);
                        console.log(`[Segment] ✓ File replaced with re-muxed version (atomic operation)`);
                    } catch (error) {
                        // Handle EXDEV error (cross-device rename not supported)
                        if (error.code === 'EXDEV') {
                            console.log(`[Segment] Cross-device detected, using copy+delete fallback`);
                            await fsPromises.copyFile(tempPath, filePath);
                            await fsPromises.unlink(tempPath);
                            console.log(`[Segment] ✓ File replaced using copy+delete fallback`);
                        } else {
                            throw error;
                        }
                    }
                } else if (!reMuxSuccess) {
                    // Re-mux failed after MAX_RETRY - still register to DB with original file
                    console.log(`[Segment] Registering to DB without re-mux: ${filename}`);
                }

                // Parse filename untuk get timestamp (source of truth)
                const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
                if (!match) {
                    console.warn(`[Segment] Invalid filename format: ${filename}`);
                    cleanup();
                    return;
                }

                const [, year, month, day, hour, minute, second] = match;
                const startTime = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);

                // Get actual duration using ffprobe AFTER re-mux (more accurate)
                // This is critical for proper playback timeline
                try {
                    const { execFileSync } = await import('child_process');
                    const ffprobeOutput = execFileSync(
                        'ffprobe',
                        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
                        { encoding: 'utf8', timeout: 5000 }
                    ).trim();
                    
                    if (ffprobeOutput && parseFloat(ffprobeOutput) > 0) {
                        actualDuration = Math.round(parseFloat(ffprobeOutput));
                        console.log(`[Segment] Actual duration from ffprobe: ${actualDuration}s`);
                    } else {
                        console.warn(`[Segment] ffprobe returned invalid duration, using default 600s`);
                    }
                } catch (ffprobeError) {
                    console.warn(`[Segment] ffprobe failed, using default duration:`, ffprobeError.message);
                }

                const endTime = new Date(startTime.getTime() + actualDuration * 1000);

                // Get final file size
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
                    cleanup();
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
                        actualDuration, // Use actual duration from ffprobe
                        filePath
                    ]
                );

                console.log(`✓ Segment saved: camera${cameraId}/${filename} (${(finalSize / 1024 / 1024).toFixed(2)} MB)`);

                // CRITICAL: Remove from processing set (allow cleanup)
                cleanup();

                // NOTE: Cleanup is now handled by scheduled cleanup (every 30 minutes)
                // No per-segment cleanup to prevent aggressive deletion

            } catch (error) {
                console.error(`[Segment] Error handling segment creation:`, error);

                // CRITICAL: Remove from processing set on error
                filesBeingProcessed.delete(fileKey);
            }
        }, 3000); // Wait 3 seconds initial delay (optimized from 15s)
    }

    /**
     * Cleanup old segments - AGE-BASED (ROBUST)
     * CRITICAL: Delete based on FILENAME TIMESTAMP, not database
     * This is the most robust approach - filename timestamp is the source of truth
     * 
     * Flow:
     * 1. Parse timestamp from filename (YYYYMMDD_HHMMSS)
     * 2. Calculate file age based on filename timestamp
     * 3. Delete if age > retention period
     * 
     * This handles ALL cases:
     * - Normal segments (10 min)
     * - Short segments (1-2 min, connection error)
     * - Orphan files (not registered in DB)
     * - Files that failed re-mux
     */
    async cleanupOldSegments(cameraId) {
        try {
            // SAFETY #1: Don't cleanup if called too frequently (prevent race condition)
            const now = Date.now();
            if (!this.lastCleanupTime) this.lastCleanupTime = {};

            const lastCleanup = this.lastCleanupTime[cameraId] || 0;
            const timeSinceLastCleanup = now - lastCleanup;

            // Only cleanup once per 60 seconds (prevent race condition with new segments)
            if (timeSinceLastCleanup < 60000) {
                console.log(`[Cleanup] Skipping cleanup for camera ${cameraId} (last cleanup ${Math.round(timeSinceLastCleanup / 1000)}s ago)`);
                return;
            }

            this.lastCleanupTime[cameraId] = now;

            // Get camera recording duration (retention period)
            const camera = queryOne('SELECT recording_duration_hours, name FROM cameras WHERE id = ?', [cameraId]);
            if (!camera) {
                console.log(`[Cleanup] Camera ${cameraId} not found, skipping cleanup`);
                return;
            }

            // Calculate retention period in milliseconds
            // Add 10% buffer to retention period for safety
            // SAFETY: Default to 5 hours if recording_duration_hours is NULL/undefined/0
            const retentionHours = camera.recording_duration_hours || 5;
            const retentionMs = retentionHours * 60 * 60 * 1000;
            const retentionWithBuffer = retentionMs * 1.1; // +10% safety buffer

            console.log(`[Cleanup] Camera ${cameraId} (${camera.name}): retention ${retentionHours}h (${Math.round(retentionWithBuffer / 3600000)}h with buffer)`);

            // First, cleanup database entries for files that don't exist
            const allSegments = query(
                'SELECT * FROM recording_segments WHERE camera_id = ?',
                [cameraId]
            );

            let orphanedCount = 0;
            allSegments.forEach(segment => {
                // Only cleanup orphaned entries older than 30 minutes
                const segmentAge = Date.now() - new Date(segment.start_time).getTime();
                const isOldEnough = segmentAge > 30 * 60 * 1000; // 30 minutes

                if (isOldEnough && !existsSync(segment.file_path)) {
                    console.log(`[Cleanup] ⚠️ Orphaned DB entry (age: ${Math.round(segmentAge / 60000)}min): ${segment.filename}`);
                    execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                    orphanedCount++;
                }
            });

            if (orphanedCount > 0) {
                console.log(`[Cleanup] ✓ Cleaned ${orphanedCount} orphaned database entries`);
            }

            // Get all segments ordered by age (oldest first)
            const segments = query(
                'SELECT * FROM recording_segments WHERE camera_id = ? ORDER BY start_time ASC',
                [cameraId]
            );

            // ⚡ FIX 2: NON-BLOCKING CLEANUP
            // Collect files to delete (filter first, delete in parallel)
            const filesToDelete = [];
            let skippedCount = 0;

            segments.forEach(segment => {
                const segmentAge = Date.now() - new Date(segment.start_time).getTime();

                // CRITICAL: Only delete if OLDER than retention period (with buffer)
                if (segmentAge <= retentionWithBuffer) {
                    // Segment is still within retention period - KEEP IT
                    return;
                }

                // Segment is older than retention period - candidate for deletion
                console.log(`[Cleanup] Segment ${segment.filename}: age ${Math.round(segmentAge / 3600000)}h (retention: ${Math.round(retentionWithBuffer / 3600000)}h)`);

                // SAFETY #2: Check if file is being processed (remux in progress)
                const fileKey = `${cameraId}:${segment.filename}`;
                if (filesBeingProcessed.has(fileKey)) {
                    console.log(`[Cleanup] ⚠️ Skipping file being processed: ${segment.filename}`);
                    skippedCount++;
                    return;
                }

                // SAFETY #3: Verify file actually exists before deleting
                if (!existsSync(segment.file_path)) {
                    console.log(`[Cleanup] ⚠️ File already gone, just removing DB entry: ${segment.filename}`);
                    execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                    return;
                }

                // Add to deletion queue
                filesToDelete.push({
                    segment,
                    segmentAge
                });
            });

            // ⚡ FIX 2: Delete files in parallel using Promise.allSettled
            // allSettled ensures one failure doesn't stop others
            let dbDeletedCount = 0;
            let dbDeletedSize = 0;

            if (filesToDelete.length > 0) {
                console.log(`[Cleanup] Deleting ${filesToDelete.length} old DB-tracked segments in parallel...`);

                const deletePromises = filesToDelete.map(async ({ segment, segmentAge }) => {
                    try {
                        const stats = statSync(segment.file_path);
                        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

                        // Non-blocking async delete
                        await fsPromises.unlink(segment.file_path);

                        console.log(`[Cleanup] ✓ Deleted: ${segment.filename} (age: ${Math.round(segmentAge / 3600000)}h, size: ${fileSizeMB}MB)`);

                        // Delete from database
                        execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);

                        return { success: true, size: stats.size };
                    } catch (error) {
                        console.error(`[Cleanup] ✗ Error deleting ${segment.filename}:`, error.message);
                        // If file doesn't exist anymore, still clean DB
                        if (error.code === 'ENOENT') {
                            execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                        }
                        return { success: false, error: error.message };
                    }
                });

                // Wait for all deletions to complete (or fail)
                const results = await Promise.allSettled(deletePromises);

                // Calculate statistics
                let failedCount = 0;

                results.forEach((result) => {
                    if (result.status === 'fulfilled' && result.value.success) {
                        dbDeletedCount++;
                        dbDeletedSize += result.value.size;
                    } else {
                        failedCount++;
                    }
                });

                const totalSizeMB = (dbDeletedSize / (1024 * 1024)).toFixed(2);
                const remainingSegments = segments.length - dbDeletedCount - skippedCount - failedCount;

                console.log(`[Cleanup] Camera ${cameraId} DB segments summary:`);
                console.log(`  ✓ Deleted: ${dbDeletedCount} segments (${totalSizeMB}MB freed)`);
                if (failedCount > 0) {
                    console.log(`  ✗ Failed: ${failedCount} segments`);
                }
                if (skippedCount > 0) {
                    console.log(`  ⚠️ Skipped: ${skippedCount} segments`);
                }
                console.log(`  ✓ Remaining: ${remainingSegments} segments`);
            } else {
                console.log(`[Cleanup] Camera ${cameraId}: No DB segments older than ${Math.round(retentionWithBuffer / 3600000)}h, ${segments.length} segments kept`);
            }

            // ⚡ FIX 6: FILESYSTEM ORPHAN CLEANUP
            // Scan actual directory for .mp4 files that are NOT in the database
            // These are files that were never registered (remux failed, process crashed, etc.)
            const cameraDir = join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
            if (existsSync(cameraDir)) {
                let fsOrphanDeletedCount = 0;
                let fsOrphanDeletedSize = 0;

                try {
                    const allFiles = readdirSync(cameraDir);
                    const mp4Files = allFiles.filter(f => /^\d{8}_\d{6}\.mp4$/.test(f));

                    // Build a Set of DB-tracked filenames for fast lookup
                    const dbFilenames = new Set(
                        query('SELECT filename FROM recording_segments WHERE camera_id = ?', [cameraId])
                            .map(s => s.filename)
                    );

                    for (const filename of mp4Files) {
                        // Skip if tracked in DB (already handled above)
                        if (dbFilenames.has(filename)) continue;

                        // Skip if being processed
                        const fileKey = `${cameraId}:${filename}`;
                        if (filesBeingProcessed.has(fileKey)) continue;

                        const filePath = join(cameraDir, filename);

                        try {
                            const stats = statSync(filePath);
                            const fileAge = now - stats.mtimeMs;

                            // Parse filename to get timestamp-based age (more reliable than mtime)
                            const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
                            let ageToUse = fileAge;
                            if (match) {
                                const [, year, month, day, hour, minute, second] = match;
                                const fileTimestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).getTime();
                                ageToUse = Math.max(fileAge, now - fileTimestamp);
                            }

                            // Only delete if older than retention period
                            if (ageToUse > retentionWithBuffer) {
                                const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                                await fsPromises.unlink(filePath);
                                fsOrphanDeletedCount++;
                                fsOrphanDeletedSize += stats.size;
                                console.log(`[Cleanup] ✓ Deleted filesystem orphan: ${filename} (age: ${Math.round(ageToUse / 3600000)}h, size: ${fileSizeMB}MB)`);

                                // Also clean up any failed_remux_files entry
                                removeFailedFile(cameraId, filename);
                            }
                        } catch (err) {
                            console.error(`[Cleanup] Error checking orphan file ${filename}:`, err.message);
                        }
                    }

                    // Also clean up any stale temp files (.remux.mp4, .temp.mp4)
                    const tempFiles = allFiles.filter(f => f.includes('.remux.mp4') || f.includes('.temp.mp4'));
                    for (const tempFile of tempFiles) {
                        const tempPath = join(cameraDir, tempFile);
                        try {
                            const stats = statSync(tempPath);
                            const tempAge = now - stats.mtimeMs;
                            // Delete temp files older than 10 minutes
                            if (tempAge > 10 * 60 * 1000) {
                                await fsPromises.unlink(tempPath);
                                fsOrphanDeletedCount++;
                                fsOrphanDeletedSize += stats.size;
                                console.log(`[Cleanup] ✓ Deleted stale temp file: ${tempFile} (age: ${Math.round(tempAge / 60000)}min)`);
                            }
                        } catch (err) {
                            // File may have been deleted by another process
                        }
                    }

                    if (fsOrphanDeletedCount > 0) {
                        console.log(`[Cleanup] Camera ${cameraId} filesystem orphans: deleted ${fsOrphanDeletedCount} files (${(fsOrphanDeletedSize / 1024 / 1024).toFixed(2)}MB freed)`);
                    }
                } catch (err) {
                    console.error(`[Cleanup] Error scanning camera dir for orphans:`, err.message);
                }
            }

        } catch (error) {
            console.error(`[Cleanup] Error cleaning up camera ${cameraId}:`, error);
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
     * FIX: Now scans ALL camera directories, not just active recordings
     */
    startSegmentScanner() {
        // Initial cleanup of temp files
        this.cleanupTempFiles();

        setInterval(() => {
            try {
                // FIX: Scan ALL camera directories on disk, not just active recordings
                // This ensures stopped cameras with orphaned files are also processed
                if (!existsSync(RECORDINGS_BASE_PATH)) return;

                const cameraDirs = readdirSync(RECORDINGS_BASE_PATH);

                cameraDirs.forEach(dirName => {
                    const cameraDir = join(RECORDINGS_BASE_PATH, dirName);

                    // Skip non-directories
                    try {
                        if (!statSync(cameraDir).isDirectory()) return;
                    } catch { return; }

                    // Extract camera ID
                    const cameraIdMatch = dirName.match(/camera(\d+)/);
                    if (!cameraIdMatch) return;
                    const cameraId = parseInt(cameraIdMatch[1]);

                    // Verify camera exists and has recording enabled
                    const camera = queryOne('SELECT id, enable_recording FROM cameras WHERE id = ?', [cameraId]);
                    if (!camera || !camera.enable_recording) return;

                    try {
                        // Get all MP4 files in directory (exclude temp files)
                        const files = readdirSync(cameraDir)
                            .filter(f => {
                                // Only match: YYYYMMDD_HHMMSS.mp4 (exactly)
                                return /^\d{8}_\d{6}\.mp4$/.test(f);
                            });

                        // Check each file
                        files.forEach(filename => {
                            // ROBUST APPROACH: No more "failed file" tracking
                            // All files will be handled by cleanup based on filename timestamp
                            // This includes files that failed re-mux - they stay until retention

                            // Check if already in database
                            const existing = queryOne(
                                'SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?',
                                [cameraId, filename]
                            );

                            if (!existing) {
                                const filePath = join(cameraDir, filename);
                                try {
                                    const stats = statSync(filePath);

                                    // BUG FIX #4: Check if file is being processed (prevent duplicate)
                                    const fileKey = `${cameraId}:${filename}`;
                                    if (filesBeingProcessed.has(fileKey)) {
                                        return; // Skip, already being processed
                                    }

                                    // Only process files that are at least 30 seconds old (likely complete)
                                    const fileAge = Date.now() - stats.mtimeMs;
                                    if (fileAge > 30000) {
                                        console.log(`[Scanner] Found unregistered segment: ${filename} (age: ${Math.round(fileAge / 1000)}s)`);
                                        // Trigger segment processing
                                        this.onSegmentCreated(cameraId, filename);
                                    }
                                } catch (statErr) {
                                    // File may have been deleted
                                }
                            }
                        });
                    } catch (error) {
                        console.error(`[Scanner] Error scanning camera ${cameraId}:`, error);
                    }
                });
            } catch (error) {
                console.error(`[Scanner] Error in segment scanner:`, error);
            }
        }, 60000); // Scan every 60 seconds
    }

    /**
     * Cleanup temp files from failed re-mux attempts
     * CRITICAL FIX: Only delete .temp.mp4 and .remux.mp4 files
     * NEVER delete actual recording files (.mp4) - let segment scanner handle registration
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
                try {
                    if (!statSync(fullPath).isDirectory()) return;
                } catch { return; }

                // Extract camera ID from directory name (e.g., "camera1" -> 1)
                const cameraIdMatch = cameraDir.match(/camera(\d+)/);
                if (!cameraIdMatch) return;
                const cameraId = parseInt(cameraIdMatch[1]);

                const files = readdirSync(fullPath);
                files.forEach(file => {
                    // CRITICAL FIX: ONLY delete .temp.mp4 or .remux.mp4 files
                    // NEVER delete actual recording files (YYYYMMDD_HHMMSS.mp4)
                    if (file.includes('.temp.mp4') || file.includes('.remux.mp4')) {
                        const filePath = join(fullPath, file);

                        try {
                            // Additional safety: check file age (at least 5 minutes old)
                            const stats = statSync(filePath);
                            const fileAge = Date.now() - stats.mtimeMs;

                            if (fileAge > 5 * 60 * 1000) {
                                unlinkSync(filePath);
                                cleanedCount++;
                                console.log(`[Cleanup] Deleted temp file: ${cameraDir}/${file} (age: ${Math.round(fileAge / 60000)}min)`);
                            }
                        } catch (statErr) {
                            // File may have been deleted by another process
                        }
                    }
                });

                // CRITICAL FIX: Only cleanup database entries for TEMP files or very old missing files
                const dbSegments = query(
                    'SELECT * FROM recording_segments WHERE camera_id = ?',
                    [cameraId]
                );

                dbSegments.forEach(segment => {
                    // SAFETY: Only cleanup entries older than 30 minutes (was 5 minutes)
                    const segmentAge = Date.now() - new Date(segment.start_time || 0).getTime();
                    const isVeryOld = segmentAge > 30 * 60 * 1000; // 30 minutes

                    // Only delete DB entries for:
                    // 1. Temp files (.temp.mp4 or .remux.mp4 in filename)
                    // 2. Very old entries (30+ minutes) where file doesn't exist
                    if (segment.filename.includes('.temp.mp4') ||
                        segment.filename.includes('.remux.mp4') ||
                        (isVeryOld && !existsSync(segment.file_path))) {

                        execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                        dbCleanedCount++;
                        console.log(`[Cleanup] Deleted DB entry: ${segment.filename} (age: ${Math.round(segmentAge / 60000)}min, file exists: ${existsSync(segment.file_path)})`);
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
     * FIX: Now respects retention period - deletes old files instead of re-registering
     * Only attempts registration for files within retention period
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
                    try {
                        if (!statSync(fullPath).isDirectory()) return;
                    } catch { return; }

                    // Extract camera ID
                    const cameraIdMatch = cameraDir.match(/camera(\d+)/);
                    if (!cameraIdMatch) return;
                    const cameraId = parseInt(cameraIdMatch[1]);

                    // Get camera retention period
                    const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
                    // SAFETY: Default to 5 hours if camera not found OR recording_duration_hours is NULL/0
                    const retentionMs = ((camera && camera.recording_duration_hours) ? camera.recording_duration_hours : 5) * 60 * 60 * 1000;

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
                            const filePath = join(fullPath, filename);
                            try {
                                const stats = statSync(filePath);
                                const fileAge = Date.now() - stats.mtimeMs;

                                // Also check filename-based age (more reliable)
                                const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
                                let ageToUse = fileAge;
                                if (match) {
                                    const [, year, month, day, hour, minute, second] = match;
                                    const fileTimestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).getTime();
                                    ageToUse = Math.max(fileAge, Date.now() - fileTimestamp);
                                }

                                // Only queue files older than 30 minutes
                                if (ageToUse > 30 * 60 * 1000) {
                                    unregistered.push({
                                        cameraId,
                                        filename,
                                        path: filePath,
                                        age: ageToUse,
                                        fileSize: stats.size,
                                        retentionMs,
                                        beyondRetention: ageToUse > retentionMs * 1.1
                                    });
                                }
                            } catch {
                                // File may have been deleted
                            }
                        }
                    });
                });

                if (unregistered.length > 0) {
                    console.log(`[BGCleanup] Found ${unregistered.length} old unregistered files (30+ min), adding to cleanup queue`);
                    // Prioritize: files beyond retention first (delete), then newer ones (register)
                    cleanupQueue = unregistered.sort((a, b) => {
                        if (a.beyondRetention && !b.beyondRetention) return -1;
                        if (!a.beyondRetention && b.beyondRetention) return 1;
                        return b.age - a.age; // Oldest first
                    });
                }
            } catch (error) {
                console.error('[BGCleanup] Error building queue:', error);
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

                // CRITICAL FIX: Check if file is being processed (prevent deletion during remux)
                const fileKey = `${file.cameraId}:${file.filename}`;
                if (filesBeingProcessed.has(fileKey)) {
                    console.log(`[BGCleanup] File being processed, skipping: ${file.filename}`);
                    isProcessing = false;
                    return;
                }

                // FIX: If file is BEYOND retention, delete immediately regardless of validity
                // Previously this would try to re-register valid old files in an infinite loop
                if (file.beyondRetention) {
                    try {
                        const fileSizeMB = (file.fileSize / (1024 * 1024)).toFixed(2);
                        await fsPromises.unlink(file.path);
                        console.log(`[BGCleanup] ✓ Deleted old unregistered file beyond retention: camera${file.cameraId}/${file.filename} (age: ${Math.round(file.age / 3600000)}h, size: ${fileSizeMB}MB)`);
                        removeFailedFile(file.cameraId, file.filename);
                    } catch (err) {
                        console.error(`[BGCleanup] Error deleting old file ${file.filename}:`, err.message);
                    }
                    isProcessing = false;
                    return;
                }

                // File is within retention period - check if corrupt or valid
                const { execSync } = await import('child_process');
                try {
                    execSync(`ffprobe -v error "${file.path}"`, {
                        timeout: 3000,
                        stdio: 'ignore'
                    });

                    // File is valid but unregistered and within retention
                    // Trigger segment scanner to register it
                    console.log(`[BGCleanup] File valid but unregistered (age: ${Math.round(file.age / 60000)}min), triggering registration: ${file.filename}`);
                    this.onSegmentCreated(file.cameraId, file.filename);

                } catch (error) {
                    // File is corrupt (ffprobe failed)
                    console.log(`[BGCleanup] Deleting corrupt file (age: ${Math.round(file.age / 60000)}min): camera${file.cameraId}/${file.filename}`);
                    try {
                        await fsPromises.unlink(file.path);
                    } catch (unlinkErr) {
                        // Ignore - file may already be deleted
                    }
                    removeFailedFile(file.cameraId, file.filename);
                }

            } catch (error) {
                console.error('[BGCleanup] Error processing file:', error);
            } finally {
                isProcessing = false;
            }
        }, 10000); // Process 1 file every 10 seconds
    }

    /**
     * Scheduled cleanup - runs every 30 minutes
     * This is the PRIMARY cleanup mechanism (not per-segment cleanup)
     * FIX: Also includes emergency disk space check
     */
    startScheduledCleanup() {
        console.log('[Cleanup] Starting scheduled cleanup service (every 30 minutes)');

        // Run cleanup for all recording cameras every 30 minutes
        setInterval(async () => {
            try {
                // FIX: Clean ALL camera directories, not just enabled ones
                // This catches orphans from cameras that were disabled after recording
                const enabledCameras = query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');
                const allCameraIds = new Set(enabledCameras.map(c => c.id));

                // Also find camera dirs on disk that might have orphaned files
                if (existsSync(RECORDINGS_BASE_PATH)) {
                    try {
                        const dirs = readdirSync(RECORDINGS_BASE_PATH);
                        dirs.forEach(d => {
                            const match = d.match(/camera(\d+)/);
                            if (match) allCameraIds.add(parseInt(match[1]));
                        });
                    } catch { }
                }

                console.log(`[Cleanup] Running scheduled cleanup for ${allCameraIds.size} cameras (${enabledCameras.length} enabled + orphaned dirs)...`);

                // Run cleanups sequentially to avoid overwhelming the system
                for (const cameraId of allCameraIds) {
                    await this.cleanupOldSegments(cameraId);
                }

                // Emergency disk space check
                await this.emergencyDiskSpaceCheck();

                console.log('[Cleanup] Scheduled cleanup complete');
            } catch (error) {
                console.error('[Cleanup] Scheduled cleanup error:', error);
            }
        }, 30 * 60 * 1000); // Every 30 minutes

        // Run initial cleanup after 2 minutes (reduced from 5 min for faster orphan removal)
        setTimeout(async () => {
            console.log('[Cleanup] Running initial cleanup...');
            try {
                const allCameraIds = new Set();

                const cameras = query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');
                cameras.forEach(c => allCameraIds.add(c.id));

                // Also find camera dirs on disk
                if (existsSync(RECORDINGS_BASE_PATH)) {
                    try {
                        const dirs = readdirSync(RECORDINGS_BASE_PATH);
                        dirs.forEach(d => {
                            const match = d.match(/camera(\d+)/);
                            if (match) allCameraIds.add(parseInt(match[1]));
                        });
                    } catch { }
                }

                for (const cameraId of allCameraIds) {
                    await this.cleanupOldSegments(cameraId);
                }

                await this.emergencyDiskSpaceCheck();
            } catch (error) {
                console.error('[Cleanup] Initial cleanup error:', error);
            }
        }, 2 * 60 * 1000);
    }

    /**
     * Emergency disk space check
     * If available space is below 1GB, aggressively delete oldest files
     */
    async emergencyDiskSpaceCheck() {
        try {
            const { execSync } = await import('child_process');
            let freeBytes = 0;

            if (os.platform() === 'win32') {
                try {
                    // Windows: use PowerShell
                    const drive = RECORDINGS_BASE_PATH.charAt(0);
                    const output = execSync(
                        `powershell -Command "(Get-PSDrive ${drive}).Free"`,
                        { encoding: 'utf8', timeout: 5000 }
                    ).trim();
                    freeBytes = parseInt(output) || 0;
                } catch (err) {
                    console.error('[DiskCheck] PowerShell disk check failed:', err.message);
                }
            } else {
                try {
                    // Linux/Mac fallback: use df
                    const output = execSync(
                        `df -B1 "${RECORDINGS_BASE_PATH}" | tail -1 | awk '{print $4}'`,
                        { encoding: 'utf8', timeout: 5000 }
                    ).trim();
                    freeBytes = parseInt(output) || 0;
                } catch (err) {
                    console.error('[DiskCheck] df disk check failed:', err.message);
                }
            }

            const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(2);
            console.log(`[DiskCheck] Free disk space: ${freeGB}GB`);

            // Emergency threshold: 1GB
            const EMERGENCY_THRESHOLD = 1 * 1024 * 1024 * 1024; // 1GB

            if (freeBytes > EMERGENCY_THRESHOLD) {
                return; // Enough space
            }

            console.warn(`[DiskCheck] ⚠️ LOW DISK SPACE: ${freeGB}GB free. Starting emergency cleanup...`);

            // Get ALL recording files across all cameras, sorted by age (oldest first)
            const allSegments = query(
                'SELECT rs.*, c.recording_duration_hours FROM recording_segments rs LEFT JOIN cameras c ON rs.camera_id = c.id ORDER BY rs.start_time ASC'
            );

            let freedBytes = 0;
            let deletedCount = 0;

            for (const segment of allSegments) {
                // Stop if we've freed enough space (target: 2GB free)
                if (freeBytes + freedBytes > 2 * 1024 * 1024 * 1024) {
                    break;
                }

                // Skip files being processed
                const fileKey = `${segment.camera_id}:${segment.filename}`;
                if (filesBeingProcessed.has(fileKey)) continue;

                if (existsSync(segment.file_path)) {
                    try {
                        const stats = statSync(segment.file_path);
                        await fsPromises.unlink(segment.file_path);
                        freedBytes += stats.size;
                        deletedCount++;
                        // Only delete DB entry if file was successfully deleted
                        execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                    } catch (err) {
                        // File locked or permission error - DON'T delete DB entry
                        // so it can be retried next cycle
                    }
                } else {
                    // File doesn't exist on disk - clean up orphaned DB entry
                    execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                }
            }

            // Also scan for filesystem orphans
            if (existsSync(RECORDINGS_BASE_PATH) && (freeBytes + freedBytes) < 2 * 1024 * 1024 * 1024) {
                const cameraDirs = readdirSync(RECORDINGS_BASE_PATH);
                for (const dir of cameraDirs) {
                    const fullDirPath = join(RECORDINGS_BASE_PATH, dir);
                    try {
                        if (!statSync(fullDirPath).isDirectory()) continue;
                    } catch { continue; }

                    const files = readdirSync(fullDirPath)
                        .filter(f => /^\d{8}_\d{6}\.mp4$/.test(f) || f.includes('.remux.mp4') || f.includes('.temp.mp4'))
                        .map(f => {
                            const fp = join(fullDirPath, f);
                            try {
                                const st = statSync(fp);
                                return { name: f, path: fp, mtime: st.mtimeMs, size: st.size };
                            } catch { return null; }
                        })
                        .filter(f => f !== null)
                        .sort((a, b) => a.mtime - b.mtime); // Oldest first

                    for (const file of files) {
                        if ((freeBytes + freedBytes) > 2 * 1024 * 1024 * 1024) break;

                        try {
                            await fsPromises.unlink(file.path);
                            freedBytes += file.size;
                            deletedCount++;
                        } catch { }
                    }
                }
            }

            if (deletedCount > 0) {
                console.warn(`[DiskCheck] 🚨 Emergency cleanup: deleted ${deletedCount} files, freed ${(freedBytes / 1024 / 1024).toFixed(2)}MB`);
            }

        } catch (error) {
            console.error('[DiskCheck] Error checking disk space:', error.message);
        }
    }

    /**
     * Auto-start recordings on service init with retry logic
     */
    async autoStartRecordings() {
        try {
            const cameras = query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');

            console.log(`[Recording] Found ${cameras.length} cameras with recording enabled`);

            if (cameras.length === 0) {
                console.log('[Recording] No cameras configured for recording');
                return;
            }

            let successCount = 0;
            let failCount = 0;

            for (const camera of cameras) {
                let retries = 3;
                let success = false;

                while (retries > 0 && !success) {
                    const attemptNum = 4 - retries;
                    console.log(`[Recording] Starting camera ${camera.id} (attempt ${attemptNum}/3)...`);

                    const result = await this.startRecording(camera.id);

                    if (result.success) {
                        console.log(`[Recording] ✓ Camera ${camera.id} recording started successfully`);
                        successCount++;
                        success = true;
                    } else {
                        console.error(`[Recording] ✗ Camera ${camera.id} failed: ${result.message}`);
                        retries--;

                        if (retries > 0) {
                            console.log(`[Recording] Retrying camera ${camera.id} in 2 seconds...`);
                            await new Promise(resolve => setTimeout(resolve, 2000)); // Reduced from 5s to 2s
                        }
                    }
                }

                if (!success) {
                    console.error(`[Recording] ✗ Camera ${camera.id} failed after 3 attempts - skipping`);
                    failCount++;
                }

                // Stagger starts between cameras (reduced from 2s to 500ms)
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log(`[Recording] Auto-start complete: ${successCount} succeeded, ${failCount} failed`);

        } catch (error) {
            console.error('[Recording] Error in auto-starting recordings:', error);
        }
    }
}

// Export singleton instance
export const recordingService = new RecordingService();
