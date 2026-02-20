import brandingService from '../services/brandingService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

export async function getBrandingSettings(request, reply) {
    try {
        const brandingObject = brandingService.getBrandingSettings();

        return reply.send({
            success: true,
            data: brandingObject,
        });
    } catch (error) {
        console.error('Get branding settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to fetch branding settings',
        });
    }
}

export async function getBrandingSettingsAdmin(request, reply) {
    try {
        const settings = brandingService.getBrandingSettingsAdmin();

        return reply.send({
            success: true,
            data: settings,
        });
    } catch (error) {
        console.error('Get branding settings admin error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to fetch branding settings',
        });
    }
}

export async function updateBrandingSetting(request, reply) {
    try {
        const { key } = request.params;
        const { value } = request.body;

        if (!key || value === undefined) {
            return reply.code(400).send({
                success: false,
                message: 'Key and value are required',
            });
        }

        const oldValue = brandingService.updateBrandingSetting(key, value, request.user.id);

        logAdminAction({
            action: 'branding_updated',
            branding_key: key,
            old_value: oldValue,
            new_value: value,
            userId: request.user.id
        }, request);

        return reply.send({
            success: true,
            message: 'Branding setting updated successfully',
        });
    } catch (error) {
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Update branding setting error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to update branding setting',
        });
    }
}

export async function bulkUpdateBrandingSettings(request, reply) {
    try {
        const { settings } = request.body;

        if (!settings || typeof settings !== 'object') {
            return reply.code(400).send({
                success: false,
                message: 'Settings object is required',
            });
        }

        const changes = brandingService.bulkUpdateBrandingSettings(settings, request.user.id);

        if (changes.length > 0) {
            logAdminAction({
                action: 'branding_bulk_updated',
                changes_count: changes.length,
                changes: JSON.stringify(changes),
                userId: request.user.id
            }, request);
        }

        return reply.send({
            success: true,
            message: `${changes.length} branding settings updated successfully`,
            data: { updated_count: changes.length },
        });
    } catch (error) {
        console.error('Bulk update branding settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to update branding settings',
        });
    }
}

export async function resetBrandingSettings(request, reply) {
    try {
        brandingService.resetBrandingSettings(request.user.id);

        logAdminAction({
            action: 'branding_reset',
            userId: request.user.id
        }, request);

        return reply.send({
            success: true,
            message: 'Branding settings reset to defaults',
        });
    } catch (error) {
        console.error('Reset branding settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to reset branding settings',
        });
    }
}
