import streamService from '../services/streamService.js';

export async function getStreamUrls(request, reply) {
    try {
        const { cameraId } = request.params;
        const data = streamService.getStreamUrls(cameraId, request.hostname);

        return reply.send({ success: true, data });
    } catch (error) {
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Get stream URLs error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function getAllActiveStreams(request, reply) {
    try {
        const data = streamService.getAllActiveStreams(request.hostname);
        return reply.send({ success: true, data });
    } catch (error) {
        console.error('Get all active streams error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function generateStreamToken(request, reply) {
    try {
        const { cameraId } = request.params;
        const data = streamService.generateStreamToken(cameraId, request.hostname);

        return reply.send({ success: true, data });
    } catch (error) {
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Generate stream token error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
