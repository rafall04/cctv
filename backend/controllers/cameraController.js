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
