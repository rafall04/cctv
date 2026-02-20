import settingsService from '../services/settingsService.js';

export async function getAllSettings(request, reply) {
    try {
        const settingsObj = settingsService.getAllSettings();

        return reply.send({
            success: true,
            data: settingsObj,
        });
    } catch (error) {
        console.error('Get settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getSetting(request, reply) {
    try {
        const { key } = request.params;
        const data = settingsService.getSetting(key);

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Get setting error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function updateSetting(request, reply) {
    try {
        const { key } = request.params;
        const { value, description } = request.body;

        const data = settingsService.updateSetting(key, value, description);

        return reply.send({
            success: true,
            message: 'Setting updated successfully',
            data,
        });
    } catch (error) {
        console.error('Update setting error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getMapDefaultCenter(request, reply) {
    try {
        const data = settingsService.getMapDefaultCenter();

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        console.error('Get map center error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getLandingPageSettings(request, reply) {
    try {
        const data = settingsService.getLandingPageSettings();

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        console.error('Get landing page settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
