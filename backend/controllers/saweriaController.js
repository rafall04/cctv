import { getSaweriaSettings, updateSaweriaSettings, getPublicSaweriaConfig } from '../services/saweriaService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

/**
 * Get Saweria settings (Admin only)
 */
export async function getSaweriaSettingsHandler(request, reply) {
    try {
        const settings = getSaweriaSettings();
        
        return reply.send({
            success: true,
            data: settings
        });
    } catch (error) {
        console.error('Get Saweria settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to get Saweria settings'
        });
    }
}

/**
 * Update Saweria settings (Admin only)
 */
export async function updateSaweriaSettingsHandler(request, reply) {
    try {
        const userId = request.user.id;
        const settings = request.body;

        const success = updateSaweriaSettings(userId, settings);

        if (success) {
            // Log admin action
            logAdminAction({
                action: 'saweria_settings_updated',
                saweria_link: settings.saweria_link,
                leaderboard_link: settings.leaderboard_link,
                enabled: settings.enabled,
                userId
            }, request);

            return reply.send({
                success: true,
                message: 'Saweria settings updated successfully'
            });
        } else {
            return reply.code(400).send({
                success: false,
                message: 'Failed to update Saweria settings'
            });
        }
    } catch (error) {
        console.error('Update Saweria settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to update Saweria settings'
        });
    }
}

/**
 * Get public Saweria config (Public endpoint)
 * Returns only if enabled
 */
export async function getPublicSaweriaConfigHandler(request, reply) {
    try {
        const config = getPublicSaweriaConfig();
        
        return reply.send({
            success: true,
            data: config
        });
    } catch (error) {
        console.error('Get public Saweria config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to get Saweria configuration'
        });
    }
}
