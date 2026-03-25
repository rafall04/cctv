import cameraService from '../services/cameraService.js';

// Get all cameras (admin only - includes disabled cameras)
export async function getAllCameras(request, reply) {
    try {
        const cameras = cameraService.getAllCameras();
        return reply.send({ success: true, data: cameras });
    } catch (error) {
        console.error('Get all cameras error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get active cameras (public - only enabled cameras, no RTSP URLs)
export async function getActiveCameras(request, reply) {
    try {
        const cameras = cameraService.getActiveCameras();
        return reply.send({ success: true, data: cameras });
    } catch (error) {
        console.error('Get active cameras error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get single camera by ID (admin only)
export async function getCameraById(request, reply) {
    try {
        const { id } = request.params;
        const camera = cameraService.getCameraById(id);
        return reply.send({ success: true, data: camera });
    } catch (error) {
        console.error('Get camera by ID error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Create new camera (admin only)
export async function createCamera(request, reply) {
    try {
        const result = await cameraService.createCamera(request.body, request);
        return reply.code(201).send({
            success: true,
            message: 'Camera created successfully',
            data: result,
        });
    } catch (error) {
        console.error('Create camera error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Update camera (admin only)
export async function updateCamera(request, reply) {
    try {
        const { id } = request.params;
        await cameraService.updateCamera(id, request.body, request);
        return reply.send({ success: true, message: 'Camera updated successfully' });
    } catch (error) {
        console.error('Update camera error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Delete camera (admin only)
export async function deleteCamera(request, reply) {
    try {
        const { id } = request.params;
        await cameraService.deleteCamera(id, request);
        return reply.send({ success: true, message: 'Camera deleted successfully' });
    } catch (error) {
        console.error('Delete camera error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Export cameras (admin only)
export async function exportCameras(request, reply) {
    try {
        const cameras = cameraService.getAllCameras();
        // Option to strip sensitive stuff like IDs, or keep them if needed, we'll keep them as is for now for full exports.
        return reply.send({ success: true, data: cameras });
    } catch (error) {
        console.error('Export cameras error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Bulk delete by Area (admin only)
export async function bulkDeleteByArea(request, reply) {
    try {
        const { areaId } = request.params;
        const result = await cameraService.bulkDeleteArea(areaId, request);
        return reply.send({ success: true, message: 'Bulk delete successful', data: result });
    } catch (error) {
        console.error('Bulk delete error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Bulk update by Area (admin only)
export async function bulkUpdateByArea(request, reply) {
    try {
        const { areaId, ...bulkRequest } = request.body;
        const result = await cameraService.bulkUpdateArea(areaId, bulkRequest, request);
        return reply.send({ success: true, message: 'Bulk update successful', data: result });
    } catch (error) {
        console.error('Bulk update error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Import cameras (admin only)
export async function importCameras(request, reply) {
    try {
        const { targetArea, cameras } = request.body;
        if (!Array.isArray(cameras) || cameras.length === 0) {
             return reply.code(400).send({ success: false, message: 'Cameras array is required and cannot be empty' });
        }
        if (!targetArea) {
             return reply.code(400).send({ success: false, message: 'Target area is required' });
        }

        const result = cameraService.importCamerasTransaction(cameras, targetArea, request);
        return reply.send({ success: true, message: 'Import successful', result });
    } catch (error) {
        console.error('Import cameras error:', error);
        return reply.code(500).send({ success: false, message: error.message || 'Internal server error' });
    }
}

export async function previewCameraRestore(request, reply) {
    try {
        const result = cameraService.previewCameraRestore(request.body || {});
        return reply.send({ success: true, data: result });
    } catch (error) {
        console.error('Preview camera restore error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function applyCameraRestore(request, reply) {
    try {
        const result = await cameraService.applyCameraRestore(request.body || {}, request);
        return reply.send({ success: true, message: 'Backup restore applied successfully', data: result });
    } catch (error) {
        console.error('Apply camera restore error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
