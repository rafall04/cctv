import { query, queryOne, execute } from '../database/database.js';
import { v4 as uuidv4 } from 'uuid';
import mediaMtxService from '../services/mediaMtxService.js';
import { 
    logCameraCreated, 
    logCameraUpdated, 
    logCameraDeleted 
} from '../services/securityAuditLogger.js';
import cache, { CacheTTL, CacheNamespace, cacheKey } from '../services/cacheService.js';

// Cache keys
const CACHE_ALL_CAMERAS = cacheKey(CacheNamespace.CAMERAS, 'all');
const CACHE_ACTIVE_CAMERAS = cacheKey(CacheNamespace.CAMERAS, 'active');

/**
 * Invalidate all camera-related caches
 */
function invalidateCameraCache() {
    cache.invalidate(`${CacheNamespace.CAMERAS}:`);
    cache.invalidate(`${CacheNamespace.STREAMS}:`);
    console.log('[Cache] Camera cache invalidated');
}

// Get all cameras (admin only - includes disabled cameras)
export async function getAllCameras(request, reply) {
    try {
        // Try cache first
        const cached = cache.get(CACHE_ALL_CAMERAS);
        if (cached) {
            return reply.send({
                success: true,
                data: cached,
                cached: true
            });
        }

        const cameras = query(
            `SELECT c.*, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             ORDER BY c.id ASC`
        );

        // Cache for 30 seconds (admin data, shorter TTL)
        cache.set(CACHE_ALL_CAMERAS, cameras, CacheTTL.SHORT);

        return reply.send({
            success: true,
            data: cameras,
        });
    } catch (error) {
        console.error('Get all cameras error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Get active cameras (public - only enabled cameras, no RTSP URLs)
export async function getActiveCameras(request, reply) {
    try {
        // Try cache first (public endpoint, longer TTL)
        const cached = cache.get(CACHE_ACTIVE_CAMERAS);
        if (cached) {
            return reply.send({
                success: true,
                data: cached,
                cached: true
            });
        }

        const cameras = query(
            `SELECT c.id, c.name, c.description, c.location, c.group_name, c.area_id, c.is_tunnel, 
                    c.latitude, c.longitude, c.status, c.enable_recording, c.video_codec, c.stream_key, 
                    c.thumbnail_path, c.thumbnail_updated_at, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.enabled = 1 
             ORDER BY c.is_tunnel ASC, c.id ASC`
        );

        // Cache for 2 minutes (public data, can be longer)
        cache.set(CACHE_ACTIVE_CAMERAS, cameras, CacheTTL.MEDIUM);

        return reply.send({
            success: true,
            data: cameras,
        });
    } catch (error) {
        console.error('Get active cameras error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Get single camera by ID (admin only)
export async function getCameraById(request, reply) {
    try {
        const { id } = request.params;

        const camera = queryOne(
            `SELECT c.*, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.id = ?`,
            [id]
        );

        if (!camera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found',
            });
        }

        return reply.send({
            success: true,
            data: camera,
        });
    } catch (error) {
        console.error('Get camera by ID error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Create new camera (admin only)
export async function createCamera(request, reply) {
    try {
        const { name, private_rtsp_url, description, location, group_name, area_id, enabled, is_tunnel, latitude, longitude, status, enable_recording, recording_duration_hours, video_codec } = request.body;

        // Validate required fields
        if (!name || !private_rtsp_url) {
            return reply.code(400).send({
                success: false,
                message: 'Name and RTSP URL are required',
            });
        }

        // Validate video_codec enum
        const codecValue = video_codec || 'h264';
        if (!['h264', 'h265'].includes(codecValue)) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid video codec. Must be h264 or h265',
            });
        }

        // Generate unique stream key (UUID v4)
        const streamKey = uuidv4();

        // Convert empty string area_id to null
        const areaIdValue = area_id === '' || area_id === null || area_id === undefined 
            ? null 
            : parseInt(area_id, 10);
        const finalAreaId = Number.isNaN(areaIdValue) ? null : areaIdValue;

        // Convert boolean to integer for SQLite
        const isEnabled = enabled === true || enabled === 1 ? 1 : (enabled === false || enabled === 0 ? 0 : 1);
        const isTunnel = is_tunnel === true || is_tunnel === 1 ? 1 : 0;
        const isRecordingEnabled = enable_recording === true || enable_recording === 1 ? 1 : 0;
        
        // Parse coordinates
        const latValue = latitude !== undefined && latitude !== '' && latitude !== null ? parseFloat(latitude) : null;
        const lngValue = longitude !== undefined && longitude !== '' && longitude !== null ? parseFloat(longitude) : null;
        const lat = Number.isNaN(latValue) ? null : latValue;
        const lng = Number.isNaN(lngValue) ? null : lngValue;

        // Recording duration (default 5 hours)
        const durationValue = recording_duration_hours !== undefined && recording_duration_hours !== '' && recording_duration_hours !== null 
            ? parseInt(recording_duration_hours, 10) 
            : 5;
        const recordingDuration = Number.isNaN(durationValue) ? 5 : durationValue;

        // Status: active, maintenance, offline
        const cameraStatus = status || 'active';

        // Insert camera with stream_key, recording fields, and video_codec
        const result = execute(
            'INSERT INTO cameras (name, private_rtsp_url, description, location, group_name, area_id, enabled, is_tunnel, latitude, longitude, status, stream_key, enable_recording, recording_duration_hours, video_codec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, private_rtsp_url, description || null, location || null, group_name || null, finalAreaId, isEnabled, isTunnel, lat, lng, cameraStatus, streamKey, isRecordingEnabled, recordingDuration, codecValue]
        );

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CREATE_CAMERA', `Created camera: ${name}`, request.ip]
        );

        // Log to security audit
        logCameraCreated({
            cameraId: result.lastInsertRowid,
            cameraName: name,
            createdByUserId: request.user.id,
            createdByUsername: request.user.username
        }, request);

        // Invalidate camera cache
        invalidateCameraCache();

        // Add path to MediaMTX if camera is enabled (using stream_key as path)
        if (isEnabled) {
            try {
                const mtxResult = await mediaMtxService.updateCameraPath(streamKey, private_rtsp_url);
                if (!mtxResult.success) {
                    console.error(`[Camera] Failed to add MediaMTX path for camera ${result.lastInsertRowid}:`, mtxResult.error);
                }
            } catch (err) {
                console.error('MediaMTX add path error:', err.message);
            }
        }

        // Start recording if enabled
        if (isEnabled && isRecordingEnabled) {
            try {
                const { recordingService } = await import('../services/recordingService.js');
                console.log(`[Camera ${result.lastInsertRowid}] Auto-starting recording (camera created with recording enabled)`);
                await recordingService.startRecording(result.lastInsertRowid);
            } catch (err) {
                console.error(`[Camera ${result.lastInsertRowid}] Failed to start recording:`, err.message);
            }
        }

        return reply.code(201).send({
            success: true,
            message: 'Camera created successfully',
            data: {
                id: result.lastInsertRowid,
                name,
                stream_key: streamKey,
            },
        });
    } catch (error) {
        console.error('Create camera error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Update camera (admin only)
export async function updateCamera(request, reply) {
    try {
        const { id } = request.params;
        const { name, private_rtsp_url, description, location, group_name, area_id, enabled, is_tunnel, latitude, longitude, status, enable_recording, recording_duration_hours, video_codec } = request.body;

        // Check if camera exists (include stream_key and enable_recording)
        const existingCamera = queryOne('SELECT id, name, private_rtsp_url, enabled, stream_key, enable_recording FROM cameras WHERE id = ?', [id]);

        if (!existingCamera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found',
            });
        }

        // Generate stream_key if not exists (for legacy cameras)
        let streamKey = existingCamera.stream_key;
        if (!streamKey) {
            streamKey = uuidv4();
            execute('UPDATE cameras SET stream_key = ? WHERE id = ?', [streamKey, id]);
            console.log(`[Camera] Generated stream_key for legacy camera ${id}: ${streamKey}`);
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (private_rtsp_url !== undefined) {
            updates.push('private_rtsp_url = ?');
            values.push(private_rtsp_url);
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
            // Convert empty string to null for foreign key
            const areaIdValue = area_id === '' || area_id === null ? null : parseInt(area_id, 10);
            values.push(Number.isNaN(areaIdValue) ? null : areaIdValue);
        }
        if (enabled !== undefined) {
            updates.push('enabled = ?');
            // Convert boolean to integer for SQLite
            values.push(enabled === true || enabled === 1 ? 1 : 0);
        }
        if (is_tunnel !== undefined) {
            updates.push('is_tunnel = ?');
            // Convert boolean to integer for SQLite
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
            // Convert boolean to integer for SQLite
            values.push(enable_recording === true || enable_recording === 1 ? 1 : 0);
        }
        if (recording_duration_hours !== undefined) {
            updates.push('recording_duration_hours = ?');
            const durationValue = recording_duration_hours === '' || recording_duration_hours === null ? null : parseInt(recording_duration_hours, 10);
            values.push(Number.isNaN(durationValue) ? null : durationValue);
        }
        if (video_codec !== undefined) {
            // Validate enum
            if (!['h264', 'h265'].includes(video_codec)) {
                return reply.code(400).send({
                    success: false,
                    message: 'Invalid video codec. Must be h264 or h265',
                });
            }
            updates.push('video_codec = ?');
            values.push(video_codec);
        }

        if (updates.length === 0) {
            return reply.code(400).send({
                success: false,
                message: 'No fields to update',
            });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        execute(
            `UPDATE cameras SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'UPDATE_CAMERA', `Updated camera ID: ${id}`, request.ip]
        );

        // Log to security audit
        logCameraUpdated({
            cameraId: parseInt(id),
            cameraName: existingCamera.name,
            updatedByUserId: request.user.id,
            updatedByUsername: request.user.username,
            changes: { name, description, location, group_name, area_id, enabled }
        }, request);

        // Invalidate camera cache
        invalidateCameraCache();

        // Handle MediaMTX path updates (using stream_key as path)
        const newEnabled = enabled !== undefined ? enabled : existingCamera.enabled;
        const newRtspUrl = private_rtsp_url !== undefined ? private_rtsp_url : existingCamera.private_rtsp_url;
        const rtspChanged = private_rtsp_url !== undefined && private_rtsp_url !== existingCamera.private_rtsp_url;
        const enabledChanged = enabled !== undefined && enabled !== existingCamera.enabled;

        if (newEnabled === 0 || newEnabled === false) {
            // Camera disabled - remove path from MediaMTX
            try {
                await mediaMtxService.removeCameraPathByKey(streamKey);
            } catch (err) {
                console.error('MediaMTX remove path error:', err.message);
            }
        } else if (rtspChanged || (enabledChanged && newEnabled)) {
            // RTSP URL changed or camera re-enabled - update/add path
            try {
                const mtxResult = await mediaMtxService.updateCameraPath(streamKey, newRtspUrl);
                if (!mtxResult.success) {
                    console.error(`[Camera] Failed to update MediaMTX path for camera ${id}:`, mtxResult.error);
                }
            } catch (err) {
                console.error('MediaMTX update path error:', err.message);
            }
        }

        // Handle recording start/stop when enable_recording changes
        if (enable_recording !== undefined) {
            const { recordingService } = await import('../services/recordingService.js');
            const newRecordingEnabled = enable_recording === true || enable_recording === 1;
            const oldRecordingEnabled = existingCamera.enable_recording === 1;
            const cameraEnabled = (newEnabled === 1 || newEnabled === true);

            if (newRecordingEnabled !== oldRecordingEnabled) {
                if (newRecordingEnabled && cameraEnabled) {
                    // Start recording
                    console.log(`[Camera ${id}] Auto-starting recording (enable_recording changed to true)`);
                    try {
                        await recordingService.startRecording(parseInt(id));
                    } catch (err) {
                        console.error(`[Camera ${id}] Failed to start recording:`, err.message);
                    }
                } else if (!newRecordingEnabled) {
                    // Stop recording
                    console.log(`[Camera ${id}] Auto-stopping recording (enable_recording changed to false)`);
                    try {
                        await recordingService.stopRecording(parseInt(id));
                    } catch (err) {
                        console.error(`[Camera ${id}] Failed to stop recording:`, err.message);
                    }
                }
            }
        }

        return reply.send({
            success: true,
            message: 'Camera updated successfully',
        });
    } catch (error) {
        console.error('Update camera error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Delete camera (admin only)
export async function deleteCamera(request, reply) {
    try {
        const { id } = request.params;

        // Check if camera exists (include stream_key for cleanup)
        const camera = queryOne('SELECT id, name, stream_key FROM cameras WHERE id = ?', [id]);

        if (!camera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found',
            });
        }

        // Delete camera
        execute('DELETE FROM cameras WHERE id = ?', [id]);

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'DELETE_CAMERA', `Deleted camera: ${camera.name} (ID: ${id})`, request.ip]
        );

        // Log to security audit
        logCameraDeleted({
            cameraId: parseInt(id),
            cameraName: camera.name,
            deletedByUserId: request.user.id,
            deletedByUsername: request.user.username
        }, request);

        // Invalidate camera cache
        invalidateCameraCache();

        // Remove path from MediaMTX
        try {
            if (camera.stream_key) {
                await mediaMtxService.removeCameraPathByKey(camera.stream_key);
            }
        } catch (err) {
            console.error('MediaMTX remove path error:', err.message);
        }

        return reply.send({
            success: true,
            message: 'Camera deleted successfully',
        });
    } catch (error) {
        console.error('Delete camera error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
