import { query, queryOne, execute } from '../database/connectionPool.js';
import { v4 as uuidv4 } from 'uuid';
import mediaMtxService from './mediaMtxService.js';
import {
    logCameraCreated,
    logCameraUpdated,
    logCameraDeleted
} from './securityAuditLogger.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';

class CameraService {
    invalidateCameraCache() {
        invalidateCache('/api/cameras');
        invalidateCache('/api/stream');
        console.log('[Cache] Camera cache invalidated');
    }

    getAllCameras() {
        return query(
            `SELECT c.*, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             ORDER BY c.id ASC`
        );
    }

    getActiveCameras() {
        return query(
            `SELECT c.id, c.name, c.description, c.location, c.group_name, c.area_id, c.is_tunnel, 
                    c.latitude, c.longitude, c.status, c.enable_recording, c.video_codec, c.stream_key, 
                    c.thumbnail_path, c.thumbnail_updated_at, c.stream_source, c.external_hls_url,
                    a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.enabled = 1 
             ORDER BY c.is_tunnel ASC, c.id ASC`
        );
    }

    getCameraById(id) {
        const camera = queryOne(
            `SELECT c.*, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.id = ?`,
            [id]
        );
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }
        return camera;
    }

    async createCamera(data, request) {
        const { name, private_rtsp_url, description, location, group_name, area_id, enabled, is_tunnel, latitude, longitude, status, enable_recording, recording_duration_hours, video_codec, stream_source, external_hls_url } = data;

        const sourceType = stream_source === 'external' ? 'external' : 'internal';

        if (!name) {
            const err = new Error('Camera name is required');
            err.statusCode = 400;
            throw err;
        }

        // Conditional validation based on stream source
        if (sourceType === 'internal' && !private_rtsp_url) {
            const err = new Error('RTSP URL is required for internal cameras');
            err.statusCode = 400;
            throw err;
        }
        if (sourceType === 'external' && !external_hls_url) {
            const err = new Error('External HLS URL is required for external cameras');
            err.statusCode = 400;
            throw err;
        }
        if (sourceType === 'external' && external_hls_url && !external_hls_url.startsWith('http')) {
            const err = new Error('External HLS URL must start with http:// or https://');
            err.statusCode = 400;
            throw err;
        }

        const codecValue = video_codec || 'h264';
        if (sourceType === 'internal' && !['h264', 'h265'].includes(codecValue)) {
            const err = new Error('Invalid video codec. Must be h264 or h265');
            err.statusCode = 400;
            throw err;
        }

        const streamKey = uuidv4();

        const areaIdValue = area_id === '' || area_id === null || area_id === undefined
            ? null
            : parseInt(area_id, 10);
        const finalAreaId = Number.isNaN(areaIdValue) ? null : areaIdValue;

        const isEnabled = enabled === true || enabled === 1 ? 1 : (enabled === false || enabled === 0 ? 0 : 1);
        const isTunnel = is_tunnel === true || is_tunnel === 1 ? 1 : 0;
        const isRecordingEnabled = enable_recording === true || enable_recording === 1 ? 1 : 0;

        const latValue = latitude !== undefined && latitude !== '' && latitude !== null ? parseFloat(latitude) : null;
        const lngValue = longitude !== undefined && longitude !== '' && longitude !== null ? parseFloat(longitude) : null;
        const lat = Number.isNaN(latValue) ? null : latValue;
        const lng = Number.isNaN(lngValue) ? null : lngValue;

        const durationValue = recording_duration_hours !== undefined && recording_duration_hours !== '' && recording_duration_hours !== null
            ? parseInt(recording_duration_hours, 10)
            : 5;
        const recordingDuration = Number.isNaN(durationValue) ? 5 : durationValue;

        const cameraStatus = status || 'active';

        const result = execute(
            'INSERT INTO cameras (name, private_rtsp_url, description, location, group_name, area_id, enabled, is_tunnel, latitude, longitude, status, stream_key, enable_recording, recording_duration_hours, video_codec, stream_source, external_hls_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, sourceType === 'internal' ? private_rtsp_url : '', description || null, location || null, group_name || null, finalAreaId, isEnabled, isTunnel, lat, lng, cameraStatus, streamKey, isRecordingEnabled, recordingDuration, codecValue, sourceType, sourceType === 'external' ? external_hls_url : null]
        );

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CREATE_CAMERA', `Created camera: ${name}`, request.ip]
        );

        logCameraCreated({
            cameraId: result.lastInsertRowid,
            cameraName: name,
            createdByUserId: request.user.id,
            createdByUsername: request.user.username
        }, request);

        this.invalidateCameraCache();

        if (isEnabled && sourceType === 'internal') {
            try {
                const mtxResult = await mediaMtxService.updateCameraPath(streamKey, private_rtsp_url);
                if (!mtxResult.success) {
                    console.error(`[Camera] Failed to add MediaMTX path for camera ${result.lastInsertRowid}:`, mtxResult.error);
                }
            } catch (err) {
                console.error('MediaMTX add path error:', err.message);
            }
        }

        if (isEnabled && isRecordingEnabled) {
            try {
                const { recordingService } = await import('./recordingService.js');
                console.log(`[Camera ${result.lastInsertRowid}] Auto-starting recording (camera created with recording enabled)`);
                await recordingService.startRecording(result.lastInsertRowid);
            } catch (err) {
                console.error(`[Camera ${result.lastInsertRowid}] Failed to start recording:`, err.message);
            }
        }

        return {
            id: result.lastInsertRowid,
            name,
            stream_key: streamKey,
        };
    }

    async updateCamera(id, data, request) {
        const { name, private_rtsp_url, description, location, group_name, area_id, enabled, is_tunnel, latitude, longitude, status, enable_recording, recording_duration_hours, video_codec, stream_source, external_hls_url } = data;

        const existingCamera = queryOne('SELECT id, name, private_rtsp_url, enabled, stream_key, enable_recording, stream_source, external_hls_url FROM cameras WHERE id = ?', [id]);

        if (!existingCamera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        let streamKey = existingCamera.stream_key;
        if (!streamKey) {
            streamKey = uuidv4();
            execute('UPDATE cameras SET stream_key = ? WHERE id = ?', [streamKey, id]);
            console.log(`[Camera] Generated stream_key for legacy camera ${id}: ${streamKey}`);
        }

        const updates = [];
        const values = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (private_rtsp_url !== undefined) {
            updates.push('private_rtsp_url = ?');
            values.push(private_rtsp_url || '');
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description || null);
        }
        if (location !== undefined) {
            updates.push('location = ?');
            values.push(location || null);
        }
        if (group_name !== undefined) {
            updates.push('group_name = ?');
            values.push(group_name || null);
        }
        if (area_id !== undefined) {
            updates.push('area_id = ?');
            const areaIdValue = area_id === '' || area_id === null ? null : parseInt(area_id, 10);
            values.push(Number.isNaN(areaIdValue) ? null : areaIdValue);
        }
        if (enabled !== undefined) {
            updates.push('enabled = ?');
            values.push(enabled === true || enabled === 1 ? 1 : 0);
        }
        if (is_tunnel !== undefined) {
            updates.push('is_tunnel = ?');
            values.push(is_tunnel === true || is_tunnel === 1 ? 1 : 0);
        }
        if (latitude !== undefined) {
            updates.push('latitude = ?');
            const latValue = latitude === '' || latitude === null ? null : parseFloat(latitude);
            values.push(Number.isNaN(latValue) ? null : latValue);
        }
        if (longitude !== undefined) {
            updates.push('longitude = ?');
            const lngValue = longitude === '' || longitude === null ? null : parseFloat(longitude);
            values.push(Number.isNaN(lngValue) ? null : lngValue);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status || 'active');
        }
        if (enable_recording !== undefined) {
            updates.push('enable_recording = ?');
            values.push(enable_recording === true || enable_recording === 1 ? 1 : 0);
        }
        if (recording_duration_hours !== undefined) {
            updates.push('recording_duration_hours = ?');
            const durationValue = recording_duration_hours === '' || recording_duration_hours === null ? null : parseInt(recording_duration_hours, 10);
            values.push(Number.isNaN(durationValue) ? null : durationValue);
        }
        if (video_codec !== undefined) {
            if (!['h264', 'h265'].includes(video_codec)) {
                const err = new Error('Invalid video codec. Must be h264 or h265');
                err.statusCode = 400;
                throw err;
            }
            updates.push('video_codec = ?');
            values.push(video_codec);
        }
        const effectiveStreamSource = stream_source !== undefined
            ? stream_source
            : (existingCamera.stream_source || 'internal');
        const effectiveExternalHlsUrl = external_hls_url !== undefined
            ? (external_hls_url || null)
            : (existingCamera.external_hls_url || null);

        if (effectiveStreamSource === 'external') {
            if (!effectiveExternalHlsUrl) {
                const err = new Error('External HLS URL is required for external cameras');
                err.statusCode = 400;
                throw err;
            }
            if (!effectiveExternalHlsUrl.startsWith('http://') && !effectiveExternalHlsUrl.startsWith('https://')) {
                const err = new Error('External HLS URL must start with http:// or https://');
                err.statusCode = 400;
                throw err;
            }
        }
        if (stream_source !== undefined) {
            if (!['internal', 'external'].includes(stream_source)) {
                const err = new Error('Invalid stream source. Must be internal or external');
                err.statusCode = 400;
                throw err;
            }
            updates.push('stream_source = ?');
            values.push(stream_source);
        }
        if (external_hls_url !== undefined) {
            updates.push('external_hls_url = ?');
            values.push(external_hls_url || null);
        }

        if (updates.length === 0) {
            const err = new Error('No fields to update');
            err.statusCode = 400;
            throw err;
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        execute(
            `UPDATE cameras SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'UPDATE_CAMERA', `Updated camera ID: ${id}`, request.ip]
        );

        logCameraUpdated({
            cameraId: parseInt(id),
            cameraName: existingCamera.name,
            updatedByUserId: request.user.id,
            updatedByUsername: request.user.username,
            changes: { name, description, location, group_name, area_id, enabled }
        }, request);

        this.invalidateCameraCache();

        const currentStreamSource = stream_source !== undefined ? stream_source : (existingCamera.stream_source || 'internal');
        const newEnabled = enabled !== undefined ? enabled : existingCamera.enabled;
        const newRtspUrl = private_rtsp_url !== undefined ? private_rtsp_url : existingCamera.private_rtsp_url;
        const rtspChanged = private_rtsp_url !== undefined && private_rtsp_url !== existingCamera.private_rtsp_url;
        const enabledChanged = enabled !== undefined && enabled !== existingCamera.enabled;

        // If stream source changed to external, remove MediaMTX path
        if (currentStreamSource === 'external') {
            try {
                await mediaMtxService.removeCameraPathByKey(streamKey);
            } catch (err) {
                console.error('MediaMTX remove path error (switched to external):', err.message);
            }
        } else if (newEnabled === 0 || newEnabled === false) {
            try {
                await mediaMtxService.removeCameraPathByKey(streamKey);
            } catch (err) {
                console.error('MediaMTX remove path error:', err.message);
            }
        } else if (rtspChanged || (enabledChanged && newEnabled)) {
            try {
                const mtxResult = await mediaMtxService.updateCameraPath(streamKey, newRtspUrl);
                if (!mtxResult.success) {
                    console.error(`[Camera] Failed to update MediaMTX path for camera ${id}:`, mtxResult.error);
                }
            } catch (err) {
                console.error('MediaMTX update path error:', err.message);
            }
        }

        if (enable_recording !== undefined) {
            const { recordingService } = await import('./recordingService.js');
            const newRecordingEnabled = enable_recording === true || enable_recording === 1;
            const oldRecordingEnabled = existingCamera.enable_recording === 1;
            const cameraEnabled = (newEnabled === 1 || newEnabled === true);

            if (newRecordingEnabled !== oldRecordingEnabled) {
                if (newRecordingEnabled && cameraEnabled) {
                    console.log(`[Camera ${id}] Auto-starting recording (enable_recording changed to true)`);
                    try {
                        await recordingService.startRecording(parseInt(id));
                    } catch (err) {
                        console.error(`[Camera ${id}] Failed to start recording:`, err.message);
                    }
                } else if (!newRecordingEnabled) {
                    console.log(`[Camera ${id}] Auto-stopping recording (enable_recording changed to false)`);
                    try {
                        await recordingService.stopRecording(parseInt(id));
                    } catch (err) {
                        console.error(`[Camera ${id}] Failed to stop recording:`, err.message);
                    }
                }
            }
        }
    }

    async deleteCamera(id, request) {
        const camera = queryOne('SELECT id, name, stream_key FROM cameras WHERE id = ?', [id]);

        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        execute('DELETE FROM cameras WHERE id = ?', [id]);

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'DELETE_CAMERA', `Deleted camera: ${camera.name} (ID: ${id})`, request.ip]
        );

        logCameraDeleted({
            cameraId: parseInt(id),
            cameraName: camera.name,
            deletedByUserId: request.user.id,
            deletedByUsername: request.user.username
        }, request);

        this.invalidateCameraCache();

        try {
            if (camera.stream_key) {
                await mediaMtxService.removeCameraPathByKey(camera.stream_key);
            }
        } catch (err) {
            console.error('MediaMTX remove path error:', err.message);
        }
    }
}

export default new CameraService();

