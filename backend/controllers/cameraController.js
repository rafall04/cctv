import { query, queryOne, execute } from '../database/database.js';
import mediaMtxService from '../services/mediaMtxService.js';

// Get all cameras (admin only - includes disabled cameras)
export async function getAllCameras(request, reply) {
    try {
        const cameras = query(
            `SELECT c.*, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             ORDER BY c.id ASC`
        );

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
        const cameras = query(
            `SELECT c.id, c.name, c.description, c.location, c.group_name, c.area_id, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.enabled = 1 
             ORDER BY c.id ASC`
        );

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
        const { name, private_rtsp_url, description, location, group_name, area_id, enabled } = request.body;

        // Validate required fields
        if (!name || !private_rtsp_url) {
            return reply.code(400).send({
                success: false,
                message: 'Name and RTSP URL are required',
            });
        }

        // Convert empty string area_id to null
        const areaIdValue = area_id === '' || area_id === null || area_id === undefined 
            ? null 
            : parseInt(area_id, 10);

        const isEnabled = enabled !== undefined ? enabled : 1;

        // Insert camera
        const result = execute(
            'INSERT INTO cameras (name, private_rtsp_url, description, location, group_name, area_id, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, private_rtsp_url, description || null, location || null, group_name || null, areaIdValue, isEnabled]
        );

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CREATE_CAMERA', `Created camera: ${name}`, request.ip]
        );

        // Add path to MediaMTX if camera is enabled
        if (isEnabled) {
            mediaMtxService.updateCameraPath(result.lastInsertRowid, private_rtsp_url).catch(err => {
                console.error('MediaMTX add path error:', err.message);
            });
        }

        return reply.code(201).send({
            success: true,
            message: 'Camera created successfully',
            data: {
                id: result.lastInsertRowid,
                name,
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
        const { name, private_rtsp_url, description, location, group_name, area_id, enabled } = request.body;

        // Check if camera exists
        const existingCamera = queryOne('SELECT id, name, private_rtsp_url, enabled FROM cameras WHERE id = ?', [id]);

        if (!existingCamera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found',
            });
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
            values.push(area_id === '' || area_id === null ? null : parseInt(area_id, 10));
        }
        if (enabled !== undefined) {
            updates.push('enabled = ?');
            values.push(enabled);
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

        // Handle MediaMTX path updates
        const newEnabled = enabled !== undefined ? enabled : existingCamera.enabled;
        const newRtspUrl = private_rtsp_url !== undefined ? private_rtsp_url : existingCamera.private_rtsp_url;
        const rtspChanged = private_rtsp_url !== undefined && private_rtsp_url !== existingCamera.private_rtsp_url;
        const enabledChanged = enabled !== undefined && enabled !== existingCamera.enabled;

        if (newEnabled === 0 || newEnabled === false) {
            // Camera disabled - remove path
            mediaMtxService.removeCameraPath(id).catch(err => {
                console.error('MediaMTX remove path error:', err.message);
            });
        } else if (rtspChanged || (enabledChanged && newEnabled)) {
            // RTSP URL changed or camera re-enabled - update/add path
            mediaMtxService.updateCameraPath(id, newRtspUrl).catch(err => {
                console.error('MediaMTX update path error:', err.message);
            });
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

        // Check if camera exists
        const camera = queryOne('SELECT id, name FROM cameras WHERE id = ?', [id]);

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

        // Remove specific path from MediaMTX (don't await, run in background)
        mediaMtxService.removeCameraPath(id).catch(err => {
            console.error('MediaMTX remove path error:', err.message);
        });

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
