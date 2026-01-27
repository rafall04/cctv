import { getMonetagSettings, updateMonetagSettings, getPublicMonetagConfig } from '../services/monetagService.js';

/**
 * Get Monetag settings (Admin only)
 */
export async function getMonetagSettingsHandler(request, reply) {
    try {
        const settings = getMonetagSettings();
        
        return reply.send({
            success: true,
            data: settings
        });
    } catch (error) {
        console.error('Get Monetag settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to get Monetag settings'
        });
    }
}

/**
 * Update Monetag settings (Admin only)
 */
export async function updateMonetagSettingsHandler(request, reply) {
    try {
        const userId = request.user.id;
        const settings = request.body;

        const success = updateMonetagSettings(userId, settings);

        if (success) {
            // Log audit
            const { logAudit } = await import('../services/securityAuditLogger.js');
            logAudit({
                userId,
                action: 'update_monetag_settings',
                resource: 'monetag_settings',
                resourceId: 1,
                details: 'Updated Monetag configuration',
                ipAddress: request.ip,
                userAgent: request.headers['user-agent']
            });

            return reply.send({
                success: true,
                message: 'Monetag settings updated successfully'
            });
        } else {
            return reply.code(400).send({
                success: false,
                message: 'Failed to update Monetag settings'
            });
        }
    } catch (error) {
        console.error('Update Monetag settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to update Monetag settings'
        });
    }
}

/**
 * Get public Monetag config (Public endpoint)
 * Returns only enabled settings with valid zone IDs
 */
export async function getPublicMonetagConfigHandler(request, reply) {
    try {
        const config = getPublicMonetagConfig();
        
        return reply.send({
            success: true,
            data: config
        });
    } catch (error) {
        console.error('Get public Monetag config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to get Monetag configuration'
        });
    }
}
