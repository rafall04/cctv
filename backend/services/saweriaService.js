import { query, queryOne, execute } from '../database/database.js';

/**
 * Get Saweria settings
 */
export function getSaweriaSettings() {
    try {
        const settings = queryOne('SELECT * FROM saweria_settings WHERE id = 1');
        
        if (!settings) {
            // Return default if not found
            return {
                id: 1,
                saweria_link: 'https://saweria.co/raflialdi',
                leaderboard_link: 'https://saweria.co/overlays/leaderboard/raflialdi',
                enabled: 1,
                updated_at: new Date().toISOString()
            };
        }
        
        return settings;
    } catch (error) {
        console.error('Error getting Saweria settings:', error);
        throw error;
    }
}

/**
 * Update Saweria settings
 */
export function updateSaweriaSettings(userId, settings) {
    try {
        const { saweria_link, leaderboard_link, enabled } = settings;

        const result = execute(`
            UPDATE saweria_settings 
            SET 
                saweria_link = ?,
                leaderboard_link = ?,
                enabled = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `, [saweria_link, leaderboard_link || null, enabled ? 1 : 0]);

        return result.changes > 0;
    } catch (error) {
        console.error('Error updating Saweria settings:', error);
        throw error;
    }
}

/**
 * Get public Saweria config (for frontend)
 * Only returns if enabled
 */
export function getPublicSaweriaConfig() {
    try {
        const settings = getSaweriaSettings();
        
        if (!settings.enabled) {
            return {
                enabled: false,
                saweria_link: null,
                leaderboard_link: null
            };
        }
        
        return {
            enabled: true,
            saweria_link: settings.saweria_link,
            leaderboard_link: settings.leaderboard_link
        };
    } catch (error) {
        console.error('Error getting public Saweria config:', error);
        // Return safe default
        return {
            enabled: true,
            saweria_link: 'https://saweria.co/raflialdi',
            leaderboard_link: 'https://saweria.co/overlays/leaderboard/raflialdi'
        };
    }
}
