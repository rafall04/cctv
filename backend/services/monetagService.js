import { query, run } from '../database/database.js';

/**
 * Get Monetag settings
 */
export function getMonetagSettings() {
    try {
        const settings = query('SELECT * FROM monetag_settings WHERE id = 1');
        
        if (settings.length === 0) {
            // Return default settings if not found
            return {
                id: 1,
                popunder_enabled: 1,
                popunder_zone_id: 'YOUR_POPUNDER_ZONE_ID',
                native_banner_enabled: 1,
                native_banner_zone_id: 'YOUR_NATIVE_ZONE_ID',
                push_notifications_enabled: 0,
                push_notifications_zone_id: 'YOUR_PUSH_ZONE_ID',
                social_bar_enabled: 0,
                social_bar_zone_id: 'YOUR_SOCIAL_BAR_ZONE_ID',
                direct_link_enabled: 0,
                direct_link_zone_id: 'YOUR_DIRECT_LINK_ZONE_ID',
                updated_at: new Date().toISOString(),
                updated_by: null
            };
        }
        
        return settings[0];
    } catch (error) {
        console.error('Error getting Monetag settings:', error);
        throw error;
    }
}

/**
 * Update Monetag settings
 */
export function updateMonetagSettings(userId, settings) {
    try {
        const {
            popunder_enabled,
            popunder_zone_id,
            native_banner_enabled,
            native_banner_zone_id,
            push_notifications_enabled,
            push_notifications_zone_id,
            social_bar_enabled,
            social_bar_zone_id,
            direct_link_enabled,
            direct_link_zone_id
        } = settings;

        const result = run(`
            UPDATE monetag_settings 
            SET 
                popunder_enabled = ?,
                popunder_zone_id = ?,
                native_banner_enabled = ?,
                native_banner_zone_id = ?,
                push_notifications_enabled = ?,
                push_notifications_zone_id = ?,
                social_bar_enabled = ?,
                social_bar_zone_id = ?,
                direct_link_enabled = ?,
                direct_link_zone_id = ?,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = ?
            WHERE id = 1
        `, [
            popunder_enabled ? 1 : 0,
            popunder_zone_id || 'YOUR_POPUNDER_ZONE_ID',
            native_banner_enabled ? 1 : 0,
            native_banner_zone_id || 'YOUR_NATIVE_ZONE_ID',
            push_notifications_enabled ? 1 : 0,
            push_notifications_zone_id || 'YOUR_PUSH_ZONE_ID',
            social_bar_enabled ? 1 : 0,
            social_bar_zone_id || 'YOUR_SOCIAL_BAR_ZONE_ID',
            direct_link_enabled ? 1 : 0,
            direct_link_zone_id || 'YOUR_DIRECT_LINK_ZONE_ID',
            userId
        ]);

        return result.changes > 0;
    } catch (error) {
        console.error('Error updating Monetag settings:', error);
        throw error;
    }
}

/**
 * Get public Monetag config (for frontend)
 * Only returns enabled settings with valid zone IDs
 */
export function getPublicMonetagConfig() {
    try {
        const settings = getMonetagSettings();
        
        // Filter and format for public use
        const config = {
            popunder: {
                enabled: settings.popunder_enabled === 1 && 
                        settings.popunder_zone_id && 
                        settings.popunder_zone_id !== 'YOUR_POPUNDER_ZONE_ID',
                zoneId: settings.popunder_zone_id
            },
            nativeBanner: {
                enabled: settings.native_banner_enabled === 1 && 
                        settings.native_banner_zone_id && 
                        settings.native_banner_zone_id !== 'YOUR_NATIVE_ZONE_ID',
                zoneId: settings.native_banner_zone_id
            },
            pushNotifications: {
                enabled: settings.push_notifications_enabled === 1 && 
                        settings.push_notifications_zone_id && 
                        settings.push_notifications_zone_id !== 'YOUR_PUSH_ZONE_ID',
                zoneId: settings.push_notifications_zone_id,
                swPath: '/sw.js'
            },
            socialBar: {
                enabled: settings.social_bar_enabled === 1 && 
                        settings.social_bar_zone_id && 
                        settings.social_bar_zone_id !== 'YOUR_SOCIAL_BAR_ZONE_ID',
                zoneId: settings.social_bar_zone_id
            },
            directLink: {
                enabled: settings.direct_link_enabled === 1 && 
                        settings.direct_link_zone_id && 
                        settings.direct_link_zone_id !== 'YOUR_DIRECT_LINK_ZONE_ID',
                zoneId: settings.direct_link_zone_id
            }
        };
        
        return config;
    } catch (error) {
        console.error('Error getting public Monetag config:', error);
        // Return safe default config
        return {
            popunder: { enabled: false, zoneId: '' },
            nativeBanner: { enabled: false, zoneId: '' },
            pushNotifications: { enabled: false, zoneId: '', swPath: '/sw.js' },
            socialBar: { enabled: false, zoneId: '' },
            directLink: { enabled: false, zoneId: '' }
        };
    }
}
