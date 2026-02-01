import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, statSync, renameSync, readdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
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

        // CRITICAL: Mark file as being processed (prevent deletion + duplicate processing)
        const fileKey = `${cameraId}:${filename}`;

        // BUG FIX #2: Prevent duplicate processing
        if (filesBeingProcessed.has(fileKey)) {
            console.log(`[Segment] Already processing: ${filename}, skipping duplicate`);
            return;
        }

        filesBeingProcessed.add(fileKey);

        console.log(`[Segment] Detected new segment: camera${cameraId}/${filename}`);

        // Optimized wait: 3 seconds (reduced from 15s)
        // FFmpeg should have closed file by now with proper segment settings
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
                    cleanup();
                    return;
                }

                // Log if file is smaller than expected (< 5MB for 10min segment)
                if (fileSize < 5 * 1024 * 1024) {
                    console.log(`[Segment] ⚠️ File smaller than expected (likely from reconnect): ${filename} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
                }

                // Reduced wait: 3 seconds (optimized from 5s)
                console.log(`[Segment] Final wait to ensure file is complete: ${filename}`);
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Quick final check
                if (!existsSync(filePath)) {
                    console.warn(`[Segment] File disappeared: ${filePath}`);
                    cleanup();
                    return;
                }

                const finalCheck = statSync(filePath).size;
                if (Math.abs(finalCheck - fileSize) > 1024 * 100) { // Allow 100KB difference
                    console.log(`[Segment] File still changing (${fileSize} -> ${finalCheck}), will retry later: ${filename}`);
                    cleanup();
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
                // CRITICAL: Store actual duration for accurate database entry
                let actualDuration = 600; // Default 10 minutes, will be updated by ffprobe

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

                        cleanup();
                        return;
                    }

                    // Store actual duration from ffprobe
                    actualDuration = Math.round(parseFloat(ffprobeOutput));
                    console.log(`[Segment] File is complete, duration: ${actualDuration}s`);
                } catch (error) {
                    console.log(`[Segment] ffprobe check failed, file not ready: ${filename}`);

                    // Track failed attempt in database
                    incrementFailCount(cameraId, filename);

                    cleanup();
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

                // 🛡️ FIX 1: ATOMIC DATA SAFETY - Replace original with re-muxed file
                // CRITICAL: Use atomic rename instead of delete+rename to prevent data loss
                // On Linux/Unix, fs.promises.rename() overwrites target atomically (crash-safe)
                if (existsSync(tempPath)) {
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
                } else {
                    console.error(`[Segment] Re-muxed file not found: ${tempPath}`);
                    cleanup();
                    return;
                }

                // Parse filename untuk get timestamp
                const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
                if (!match) {
                    console.warn(`[Segment] Invalid filename format: ${filename}`);
                    cleanup();
                    return;
                }

                const [, year, month, day, hour, minute, second] = match;
                const startTime = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
                // Use actual duration from ffprobe (not hardcoded 10 minutes)
                const endTime = new Date(startTime.getTime() + actualDuration * 1000);

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
     * Cleanup old segments - AGE-BASED (FINAL FIX)
     * CRITICAL: Delete based on FILE AGE, not segment count
     * This prevents premature deletion of recent files
     * 
     * ⚡ FIX 2: NON-BLOCKING CLEANUP - Uses async operations to prevent Event Loop freeze
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
            const retentionHours = camera.recording_duration_hours;
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

            if (segments.length === 0) {
                console.log(`[Cleanup] Camera ${cameraId}: No segments to cleanup`);
                return;
            }

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
            if (filesToDelete.length > 0) {
                console.log(`[Cleanup] Deleting ${filesToDelete.length} old segments in parallel...`);

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
                        return { success: false, error: error.message };
                    }
                });

                // Wait for all deletions to complete (or fail)
                const results = await Promise.allSettled(deletePromises);

                // Calculate statistics
                let deletedCount = 0;
                let totalSize = 0;
                let failedCount = 0;

                results.forEach((result) => {
                    if (result.status === 'fulfilled' && result.value.success) {
                        deletedCount++;
                        totalSize += result.value.size;
                    } else {
                        failedCount++;
                    }
                });

                const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
                const remainingSegments = segments.length - deletedCount - skippedCount - failedCount;

                console.log(`[Cleanup] Camera ${cameraId} summary:`);
                console.log(`  ✓ Deleted: ${deletedCount} segments (${totalSizeMB}MB freed)`);
                if (failedCount > 0) {
                    console.log(`  ✗ Failed: ${failedCount} segments`);
                }
                if (skippedCount > 0) {
                    console.log(`  ⚠️ Skipped: ${skippedCount} segments`);
                }
                console.log(`  ✓ Remaining: ${remainingSegments} segments`);
            } else {
                console.log(`[Cleanup] Camera ${cameraId}: No segments older than ${Math.round(retentionWithBuffer / 3600000)}h, ${segments.length} segments kept`);
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
                if (!statSync(fullPath).isDirectory()) return;

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

                        // Additional safety: check file age (at least 5 minutes old)
                        const stats = statSync(filePath);
                        const fileAge = Date.now() - stats.mtimeMs;

                        if (fileAge > 5 * 60 * 1000) {
                            unlinkSync(filePath);
                            cleanedCount++;
                            console.log(`[Cleanup] Deleted temp file: ${cameraDir}/${file} (age: ${Math.round(fileAge / 60000)}min)`);
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
     * CRITICAL FIX: Don't delete unregistered files - let segment scanner register them
     * Only delete files that are PROVEN corrupt (ffprobe fails)
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

                        // CRITICAL FIX: Only add to queue if file is OLD (30+ minutes)
                        // Recent files are likely being processed by segment scanner
                        if (!existing) {
                            const filePath = join(fullPath, filename);
                            const stats = statSync(filePath);
                            const fileAge = Date.now() - stats.mtimeMs;

                            // Only queue files older than 30 minutes (was immediate)
                            if (fileAge > 30 * 60 * 1000) {
                                unregistered.push({
                                    cameraId,
                                    filename,
                                    path: filePath,
                                    age: fileAge
                                });
                            }
                        }
                    });
                });

                if (unregistered.length > 0) {
                    console.log(`[Cleanup] Found ${unregistered.length} old unregistered files (30+ min), adding to cleanup queue`);
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

                // CRITICAL FIX: Check if file is being processed (prevent deletion during remux)
                const fileKey = `${file.cameraId}:${file.filename}`;
                if (filesBeingProcessed.has(fileKey)) {
                    console.log(`[Cleanup] File being processed, skipping: ${file.filename}`);
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

                    // CRITICAL FIX: File is valid but unregistered
                    // DON'T DELETE - trigger segment scanner to register it
                    console.log(`[Cleanup] File valid but unregistered (age: ${Math.round(file.age / 60000)}min), triggering registration: ${file.filename}`);

                    // Trigger segment processing to register this file
                    this.onSegmentCreated(file.cameraId, file.filename);

                } catch (error) {
                    // File is corrupt (ffprobe failed)
                    console.log(`[Cleanup] Deleting corrupt file (age: ${Math.round(file.age / 60000)}min): camera${file.cameraId}/${file.filename}`);
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
     * Scheduled cleanup - runs every 30 minutes
     * This is the PRIMARY cleanup mechanism (not per-segment cleanup)
     */
    startScheduledCleanup() {
        console.log('[Cleanup] Starting scheduled cleanup service (every 30 minutes)');

        // Run cleanup for all recording cameras every 30 minutes
        setInterval(async () => {
            try {
                const cameras = query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');

                console.log(`[Cleanup] Running scheduled cleanup for ${cameras.length} cameras...`);

                // Run cleanups sequentially to avoid overwhelming the system
                for (const camera of cameras) {
                    await this.cleanupOldSegments(camera.id);
                }

                console.log('[Cleanup] Scheduled cleanup complete');
            } catch (error) {
                console.error('[Cleanup] Scheduled cleanup error:', error);
            }
        }, 30 * 60 * 1000); // Every 30 minutes

        // Run initial cleanup after 5 minutes (let system stabilize first)
        setTimeout(async () => {
            console.log('[Cleanup] Running initial cleanup...');
            try {
                const cameras = query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');
                for (const camera of cameras) {
                    await this.cleanupOldSegments(camera.id);
                }
            } catch (error) {
                console.error('[Cleanup] Initial cleanup error:', error);
            }
        }, 5 * 60 * 1000);
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
