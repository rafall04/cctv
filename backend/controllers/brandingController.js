import { query, queryOne, execute } from '../database/database.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

/**
 * Get all branding settings (PUBLIC - no auth required)
 */
export async function getBrandingSettings(request, reply) {
    try {
        const settings = query('SELECT key, value FROM branding_settings ORDER BY key ASC');
        
        // Convert array to object for easier frontend consumption
        const brandingObject = settings.reduce((acc, setting) => {
            acc[setting.key] = setting.value;
            return acc;
        }, {});
        
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

/**
 * Get all branding settings with metadata (ADMIN only)
 */
export async function getBrandingSettingsAdmin(request, reply) {
    try {
        const settings = query(`
            SELECT 
                bs.id,
                bs.key,
                bs.value,
                bs.description,
                bs.updated_at,
                bs.updated_by,
                u.username as updated_by_username
            FROM branding_settings bs
            LEFT JOIN users u ON bs.updated_by = u.id
            ORDER BY bs.key ASC
        `);
        
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

/**
 * Update branding setting (ADMIN only)
 */
export async function updateBrandingSetting(request, reply) {
    try {
        const { key } = request.params;
        const { value } = request.body;
        
        // Validate input
        if (!key || value === undefined) {
            return reply.code(400).send({
                success: false,
                message: 'Key and value are required',
            });
        }
        
        // Check if setting exists
        const existing = queryOne('SELECT id, value FROM branding_settings WHERE key = ?', [key]);
        
        if (!existing) {
            return reply.code(404).send({
                success: false,
                message: 'Branding setting not found',
            });
        }
        
        // Update setting
        execute(
            `UPDATE branding_settings 
             SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? 
             WHERE key = ?`,
            [value, request.user.id, key]
        );
        
        // Log admin action
        logAdminAction({
            action: 'branding_updated',
            branding_key: key,
            old_value: existing.value,
            new_value: value,
            userId: request.user.id
        }, request);
        
        return reply.send({
            success: true,
            message: 'Branding setting updated successfully',
        });
    } catch (error) {
        console.error('Update branding setting error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to update branding setting',
        });
    }
}

/**
 * Bulk update branding settings (ADMIN only)
 */
export async function bulkUpdateBrandingSettings(request, reply) {
    try {
        const { settings } = request.body;
        
        if (!settings || typeof settings !== 'object') {
            return reply.code(400).send({
                success: false,
                message: 'Settings object is required',
            });
        }
        
        const changes = [];
        
        // Update each setting
        for (const [key, value] of Object.entries(settings)) {
            const existing = queryOne('SELECT id, value FROM branding_settings WHERE key = ?', [key]);
            
            if (existing && existing.value !== value) {
                execute(
                    `UPDATE branding_settings 
                     SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? 
                     WHERE key = ?`,
                    [value, request.user.id, key]
                );
                
                changes.push({
                    key,
                    old_value: existing.value,
                    new_value: value
                });
            }
        }
        
        // Log admin action
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

/**
 * Reset branding to defaults (ADMIN only)
 */
export async function resetBrandingSettings(request, reply) {
    try {
        const defaultBranding = {
            company_name: 'RAF NET',
            company_tagline: 'CCTV Bojonegoro Online',
            company_description: 'RAF NET melayani pemasangan WiFi dan CCTV di wilayah Bojonegoro. Pantau CCTV publik secara gratis melalui website ini.',
            city_name: 'Bojonegoro',
            province_name: 'Jawa Timur',
            hero_title: 'Pantau CCTV Bojonegoro Secara Real-Time',
            hero_subtitle: 'Pantau keamanan wilayah Bojonegoro secara real-time dengan sistem CCTV RAF NET. Akses gratis 24 jam untuk memantau berbagai lokasi di Bojonegoro, Jawa Timur.',
            footer_text: 'Layanan pemantauan CCTV publik oleh RAF NET untuk keamanan dan kenyamanan warga Bojonegoro',
            copyright_text: 'Penyedia Internet & CCTV Bojonegoro',
            meta_title: 'CCTV Bojonegoro Online - RAF NET | Pantau Keamanan Kota Bojonegoro Live',
            meta_description: 'Pantau CCTV Bojonegoro secara online dan live streaming 24 jam. RAF NET menyediakan akses publik untuk memantau keamanan kota Bojonegoro, Jawa Timur. Gratis tanpa login.',
            meta_keywords: 'cctv bojonegoro, cctv bojonegoro online, cctv raf net, pantau cctv bojonegoro, live streaming cctv bojonegoro, keamanan bojonegoro, cctv jawa timur, raf net bojonegoro, cctv kota bojonegoro, monitoring bojonegoro',
            logo_text: 'R',
            primary_color: '#0ea5e9',
            show_powered_by: 'true',
            whatsapp_number: '6289685645956',
        };
        
        // Update all settings to defaults
        for (const [key, value] of Object.entries(defaultBranding)) {
            execute(
                `UPDATE branding_settings 
                 SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? 
                 WHERE key = ?`,
                [value, request.user.id, key]
            );
        }
        
        // Log admin action
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
