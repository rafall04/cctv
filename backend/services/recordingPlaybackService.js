import { query, queryOne, execute } from '../database/database.js';
import { recordingService } from './recordingService.js';
import { logAdminAction } from './securityAuditLogger.js';
import { existsSync, statSync } from 'fs';

class RecordingPlaybackService {
    async startRecording(cameraId, duration_hours, request) {
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        if (duration_hours) {
            execute(
                'UPDATE cameras SET recording_duration_hours = ? WHERE id = ?',
                [duration_hours, cameraId]
            );
        }

        const result = await recordingService.startRecording(cameraId);

        if (result.success) {
            logAdminAction({
                action: 'recording_started',
                camera_id: cameraId,
                camera_name: camera.name,
                duration_hours: duration_hours || camera.recording_duration_hours,
                userId: request.user.id
            }, request);
        }

        return result;
    }

    async stopRecording(cameraId, request) {
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        const result = await recordingService.stopRecording(cameraId);

        if (result.success) {
            logAdminAction({
                action: 'recording_stopped',
                camera_id: cameraId,
                camera_name: camera.name,
                userId: request.user.id
            }, request);
        }

        return result;
    }

    getRecordingStatus(cameraId) {
        const camera = queryOne(
            'SELECT id, name, enable_recording, recording_status, recording_duration_hours, last_recording_start FROM cameras WHERE id = ?',
            [cameraId]
        );

        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        const runtimeStatus = recordingService.getRecordingStatus(cameraId);
        const storage = recordingService.getStorageUsage(cameraId);

        return {
            camera_id: camera.id,
            camera_name: camera.name,
            enable_recording: camera.enable_recording,
            recording_status: camera.recording_status,
            recording_duration_hours: camera.recording_duration_hours,
            last_recording_start: camera.last_recording_start,
            runtime_status: runtimeStatus,
            storage: storage
        };
    }

    getRecordingsOverview() {
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

        const camerasWithStatus = cameras.map(camera => {
            const runtimeStatus = recordingService.getRecordingStatus(camera.id);
            const storage = recordingService.getStorageUsage(camera.id);

            return {
                ...camera,
                runtime_status: runtimeStatus,
                storage: storage
            };
        });

        const activeRecordings = camerasWithStatus.filter(c => c.runtime_status.isRecording).length;
        const totalStorage = camerasWithStatus.reduce((sum, c) => sum + c.storage.totalSize, 0);
        const totalStorageGB = (totalStorage / 1024 / 1024 / 1024).toFixed(2);

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const recentRestarts = query(
            'SELECT COUNT(*) as count FROM restart_logs WHERE restart_time > ?',
            [yesterday]
        );

        return {
            overview: {
                total_cameras: cameras.length,
                active_recordings: activeRecordings,
                total_storage_gb: totalStorageGB,
                recent_restarts_24h: recentRestarts[0].count
            },
            cameras: camerasWithStatus
        };
    }

    getSegments(cameraId, dateStr) {
        const camera = queryOne('SELECT id, name FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        let sql = `
            SELECT 
                id, 
                filename, 
                start_time, 
                end_time, 
                file_size, 
                duration,
                created_at
            FROM recording_segments 
            WHERE camera_id = ?`;
        let params = [cameraId];

        if (dateStr) {
            sql += ` AND date(start_time, 'localtime') = ?`;
            params.push(dateStr);
        }

        sql += ` ORDER BY start_time DESC`;

        const segments = query(sql, params);

        return {
            camera_id: camera.id,
            camera_name: camera.name,
            segments: segments,
            total_segments: segments.length
        };
    }

    getStreamSegment(cameraId, filename) {
        const segment = queryOne(
            'SELECT * FROM recording_segments WHERE camera_id = ? AND filename = ?',
            [cameraId, filename]
        );

        if (!segment) {
            const err = new Error('Segment not found in database');
            err.statusCode = 404;
            throw err;
        }

        if (!existsSync(segment.file_path)) {
            const err = new Error('Segment file not found on disk');
            err.statusCode = 404;
            throw err;
        }

        const stats = statSync(segment.file_path);

        if (Math.abs(stats.size - segment.file_size) > 1024 * 1024) {
            execute(
                'UPDATE recording_segments SET file_size = ? WHERE id = ?',
                [stats.size, segment.id]
            );
        }

        return {
            segment,
            stats
        };
    }

    generatePlaylist(cameraId) {
        const segments = query(
            'SELECT filename, duration FROM recording_segments WHERE camera_id = ? ORDER BY start_time ASC',
            [cameraId]
        );

        if (segments.length === 0) {
            const err = new Error('No segments found');
            err.statusCode = 404;
            throw err;
        }

        let playlist = '#EXTM3U\n';
        playlist += '#EXT-X-VERSION:3\n';
        playlist += '#EXT-X-TARGETDURATION:600\n';
        playlist += '#EXT-X-MEDIA-SEQUENCE:0\n';

        segments.forEach(segment => {
            playlist += `#EXTINF:${segment.duration}.0,\n`;
            playlist += `/api/recordings/${cameraId}/stream/${segment.filename}\n`;
        });

        playlist += '#EXT-X-ENDLIST\n';

        return playlist;
    }

    getRestartLogs(cameraId, limit = 50) {
        let logs;
        if (cameraId) {
            logs = query(
                `SELECT * FROM restart_logs 
                WHERE camera_id = ? 
                ORDER BY restart_time DESC 
                LIMIT ?`,
                [cameraId, limit]
            );
        } else {
            logs = query(
                `SELECT rl.*, c.name as camera_name 
                FROM restart_logs rl
                LEFT JOIN cameras c ON rl.camera_id = c.id
                ORDER BY rl.restart_time DESC 
                LIMIT ?`,
                [limit]
            );
        }
        return logs;
    }

    async updateRecordingSettings(cameraId, data, request) {
        const { enable_recording, recording_duration_hours } = data;

        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

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
            const err = new Error('No settings to update');
            err.statusCode = 400;
            throw err;
        }

        values.push(cameraId);

        execute(
            `UPDATE cameras SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        if (enable_recording !== undefined) {
            if (enable_recording && camera.enabled) {
                await recordingService.startRecording(cameraId);
            } else {
                await recordingService.stopRecording(cameraId);
            }
        }

        logAdminAction({
            action: 'recording_settings_updated',
            camera_id: cameraId,
            camera_name: camera.name,
            changes: { enable_recording, recording_duration_hours },
            userId: request.user.id
        }, request);
    }
}

export default new RecordingPlaybackService();
