import { query, queryOne, execute } from '../database/database.js';
import { recordingService } from '../services/recordingService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';
import { createReadStream, existsSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Start recording untuk camera
 */
export async function startRecording(request, reply) {
    try {
        const { cameraId } = request.params;
        const { duration_hours } = request.body;

        // Validate camera exists
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found'
            });
        }

        // Update recording settings if provided
        if (duration_hours) {
            execute(
                'UPDATE cameras SET recording_duration_hours = ? WHERE id = ?',
                [duration_hours, cameraId]
            );
        }

        // Start recording
        const result = await recordingService.startRecording(cameraId);

        if (result.success) {
            // Log admin action
            logAdminAction({
                action: 'recording_started',
                camera_id: cameraId,
                camera_name: camera.name,
                duration_hours: duration_hours || camera.recording_duration_hours,
                userId: request.user.id
            }, request);
        }

        return reply.send(result);

    } catch (error) {
        console.error('Start recording error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * Stop recording untuk camera
 */
export async function stopRecording(request, reply) {
    try {
        const { cameraId } = request.params;

        // Validate camera exists
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found'
            });
        }

        // Stop recording
        const result = await recordingService.stopRecording(cameraId);

        if (result.success) {
            // Log admin action
            logAdminAction({
                action: 'recording_stopped',
                camera_id: cameraId,
                camera_name: camera.name,
                userId: request.user.id
            }, request);
        }

        return reply.send(result);

    } catch (error) {
        console.error('Stop recording error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * Get recording status untuk camera
 */
export async function getRecordingStatus(request, reply) {
    try {
        const { cameraId } = request.params;

        // Get camera info
        const camera = queryOne(
            'SELECT id, name, enable_recording, recording_status, recording_duration_hours, last_recording_start FROM cameras WHERE id = ?',
            [cameraId]
        );

        if (!camera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found'
            });
        }

        // Get runtime status
        const runtimeStatus = recordingService.getRecordingStatus(cameraId);

        // Get storage usage
        const storage = recordingService.getStorageUsage(cameraId);

        return reply.send({
            success: true,
            data: {
                camera_id: camera.id,
                camera_name: camera.name,
                enable_recording: camera.enable_recording,
                recording_status: camera.recording_status,
                recording_duration_hours: camera.recording_duration_hours,
                last_recording_start: camera.last_recording_start,
                runtime_status: runtimeStatus,
                storage: storage
            }
        });

    } catch (error) {
        console.error('Get recording status error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * Get all recordings overview (dashboard)
 */
export async function getRecordingsOverview(request, reply) {
    try {
        // Get all cameras with recording info
        const cameras = query(`
            SELECT 
                id, 
                name, 
                enable_recording, 
                recording_status, 
                recording_duration_hours,
                last_recording_start
            FROM cameras 
            WHERE enabled = 1
            ORDER BY id ASC
        `);

        // Get runtime status and storage for each camera
        const camerasWithStatus = cameras.map(camera => {
            const runtimeStatus = recordingService.getRecordingStatus(camera.id);
            const storage = recordingService.getStorageUsage(camera.id);

            return {
                ...camera,
                runtime_status: runtimeStatus,
                storage: storage
            };
        });

        // Calculate totals
        const activeRecordings = camerasWithStatus.filter(c => c.runtime_status.isRecording).length;
        const totalStorage = camerasWithStatus.reduce((sum, c) => sum + c.storage.totalSize, 0);
        const totalStorageGB = (totalStorage / 1024 / 1024 / 1024).toFixed(2);

        // Get recent restarts (last 24 hours)
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const recentRestarts = query(
            'SELECT COUNT(*) as count FROM restart_logs WHERE restart_time > ?',
            [yesterday]
        );

        return reply.send({
            success: true,
            data: {
                overview: {
                    total_cameras: cameras.length,
                    active_recordings: activeRecordings,
                    total_storage_gb: totalStorageGB,
                    recent_restarts_24h: recentRestarts[0].count
                },
                cameras: camerasWithStatus
            }
        });

    } catch (error) {
        console.error('Get recordings overview error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * Get segments untuk camera (untuk playback)
 */
export async function getSegments(request, reply) {
    try {
        const { cameraId } = request.params;

        // Validate camera exists
        const camera = queryOne('SELECT id, name FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found'
            });
        }

        // Get segments from database
        const segments = query(
            `SELECT 
                id, 
                filename, 
                start_time, 
                end_time, 
                file_size, 
                duration,
                created_at
            FROM recording_segments 
            WHERE camera_id = ? 
            ORDER BY start_time DESC`,
            [cameraId]
        );

        return reply.send({
            success: true,
            data: {
                camera_id: camera.id,
                camera_name: camera.name,
                segments: segments,
                total_segments: segments.length
            }
        });

    } catch (error) {
        console.error('Get segments error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * Stream segment file (untuk playback)
 */
export async function streamSegment(request, reply) {
    try {
        const { cameraId, filename } = request.params;

        console.log(`[Stream Request] Camera: ${cameraId}, File: ${filename}`);

        // Validate segment exists in database
        const segment = queryOne(
            'SELECT * FROM recording_segments WHERE camera_id = ? AND filename = ?',
            [cameraId, filename]
        );

        if (!segment) {
            console.error(`[Stream Error] Segment not in database: ${filename}`);
            return reply.code(404).send({
                success: false,
                message: 'Segment not found in database'
            });
        }

        console.log(`[Stream Info] DB file_path: ${segment.file_path}, DB file_size: ${segment.file_size}`);

        // Check if file exists
        if (!existsSync(segment.file_path)) {
            console.error(`[Stream Error] File not found on disk: ${segment.file_path}`);
            return reply.code(404).send({
                success: false,
                message: 'Segment file not found on disk'
            });
        }

        // Get ACTUAL file stats from disk
        const stats = statSync(segment.file_path);
        console.log(`[Stream Info] Actual file size on disk: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        // Update database if file size mismatch (file masih growing saat entry dibuat)
        if (Math.abs(stats.size - segment.file_size) > 1024 * 1024) { // Difference > 1MB
            console.log(`[Stream Info] Updating file size in database: ${segment.file_size} -> ${stats.size}`);
            execute(
                'UPDATE recording_segments SET file_size = ? WHERE id = ?',
                [stats.size, segment.id]
            );
        }

        // Set CORS headers explicitly
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Range');
        reply.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

        // Set headers for video streaming
        reply.header('Content-Type', 'video/mp4');
        reply.header('Content-Length', stats.size);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Cache-Control', 'public, max-age=3600');

        // Handle range requests (for seeking)
        const range = request.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
            const chunksize = (end - start) + 1;

            console.log(`[Stream Info] Range request: ${start}-${end}/${stats.size}`);

            reply.code(206);
            reply.header('Content-Range', `bytes ${start}-${end}/${stats.size}`);
            reply.header('Content-Length', chunksize);

            const stream = createReadStream(segment.file_path, { start, end });
            return reply.send(stream);
        }

        // Stream entire file
        console.log(`[Stream Info] Streaming entire file: ${stats.size} bytes`);
        const stream = createReadStream(segment.file_path);
        return reply.send(stream);

    } catch (error) {
        console.error('[Stream Error] Exception:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
}

/**
 * Generate HLS playlist untuk seamless playback
 */
export async function generatePlaylist(request, reply) {
    try {
        const { cameraId } = request.params;

        // Get segments
        const segments = query(
            'SELECT filename, duration FROM recording_segments WHERE camera_id = ? ORDER BY start_time ASC',
            [cameraId]
        );

        if (segments.length === 0) {
            return reply.code(404).send({
                success: false,
                message: 'No segments found'
            });
        }

        // Generate m3u8 playlist
        let playlist = '#EXTM3U\n';
        playlist += '#EXT-X-VERSION:3\n';
        playlist += '#EXT-X-TARGETDURATION:600\n';
        playlist += '#EXT-X-MEDIA-SEQUENCE:0\n';

        segments.forEach(segment => {
            playlist += `#EXTINF:${segment.duration}.0,\n`;
            playlist += `/api/recordings/${cameraId}/stream/${segment.filename}\n`;
        });

        playlist += '#EXT-X-ENDLIST\n';

        reply.header('Content-Type', 'application/vnd.apple.mpegurl');
        return reply.send(playlist);

    } catch (error) {
        console.error('Generate playlist error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * Get restart logs untuk monitoring
 */
export async function getRestartLogs(request, reply) {
    try {
        const { cameraId } = request.params;
        const { limit = 50 } = request.query;

        let logs;
        if (cameraId) {
            // Get logs for specific camera
            logs = query(
                `SELECT * FROM restart_logs 
                WHERE camera_id = ? 
                ORDER BY restart_time DESC 
                LIMIT ?`,
                [cameraId, limit]
            );
        } else {
            // Get all logs
            logs = query(
                `SELECT rl.*, c.name as camera_name 
                FROM restart_logs rl
                LEFT JOIN cameras c ON rl.camera_id = c.id
                ORDER BY rl.restart_time DESC 
                LIMIT ?`,
                [limit]
            );
        }

        return reply.send({
            success: true,
            data: logs
        });

    } catch (error) {
        console.error('Get restart logs error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * Update recording settings untuk camera
 */
export async function updateRecordingSettings(request, reply) {
    try {
        const { cameraId } = request.params;
        const { enable_recording, recording_duration_hours } = request.body;

        // Validate camera exists
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found'
            });
        }

        // Build update query
        const updates = [];
        const values = [];

        if (enable_recording !== undefined) {
            updates.push('enable_recording = ?');
            values.push(enable_recording ? 1 : 0);
        }

        if (recording_duration_hours !== undefined) {
            updates.push('recording_duration_hours = ?');
            values.push(recording_duration_hours);
        }

        if (updates.length === 0) {
            return reply.code(400).send({
                success: false,
                message: 'No settings to update'
            });
        }

        values.push(cameraId);

        // Update database
        execute(
            `UPDATE cameras SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        // If enable_recording changed
        if (enable_recording !== undefined) {
            if (enable_recording && camera.enabled) {
                // Start recording
                await recordingService.startRecording(cameraId);
            } else {
                // Stop recording
                await recordingService.stopRecording(cameraId);
            }
        }

        // Log admin action
        logAdminAction({
            action: 'recording_settings_updated',
            camera_id: cameraId,
            camera_name: camera.name,
            changes: { enable_recording, recording_duration_hours },
            userId: request.user.id
        }, request);

        return reply.send({
            success: true,
            message: 'Recording settings updated'
        });

    } catch (error) {
        console.error('Update recording settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}
