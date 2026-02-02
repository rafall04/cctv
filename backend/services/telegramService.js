/**
 * Telegram Notification Service
 * Sends alerts for camera status changes, feedback, and system events
 * Configuration stored in database (settings table)
 */

import { queryOne, execute } from '../database/database.js';
import { formatDateTime } from './timezoneService.js';

// Cooldown tracking to prevent spam
const notificationCooldowns = new Map();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Cache for settings (refresh every 60 seconds)
let settingsCache = null;
let settingsCacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds

/**
 * Get Telegram settings from database with caching
 */
function getTelegramSettings() {
    const now = Date.now();
    if (settingsCache && (now - settingsCacheTime) < CACHE_TTL) {
        return settingsCache;
    }

    try {
        const setting = queryOne('SELECT value FROM settings WHERE key = ?', ['telegram_config']);
        if (setting) {
            settingsCache = JSON.parse(setting.value);
        } else {
            settingsCache = {
                botToken: '',
                monitoringChatId: '',
                feedbackChatId: '',
                enabled: false
            };
        }
        settingsCacheTime = now;
        return settingsCache;
    } catch (error) {
        console.error('[Telegram] Error reading settings:', error);
        return {
            botToken: '',
            monitoringChatId: '',
            feedbackChatId: '',
            enabled: false
        };
    }
}

/**
 * Clear settings cache (call after update)
 */
export function clearSettingsCache() {
    settingsCache = null;
    settingsCacheTime = 0;
}

/**
 * Save Telegram settings to database
 */
export function saveTelegramSettings(settings) {
    try {
        const valueStr = JSON.stringify(settings);
        const existing = queryOne('SELECT * FROM settings WHERE key = ?', ['telegram_config']);
        
        if (existing) {
            execute(
                'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
                [valueStr, 'telegram_config']
            );
        } else {
            execute(
                'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)',
                ['telegram_config', valueStr, 'Telegram Bot Configuration']
            );
        }
        
        clearSettingsCache();
        return true;
    } catch (error) {
        console.error('[Telegram] Error saving settings:', error);
        return false;
    }
}

function isInCooldown(key) {
    const lastSent = notificationCooldowns.get(key);
    if (!lastSent) return false;
    return (Date.now() - lastSent) < COOLDOWN_MS;
}

function setCooldown(key) {
    notificationCooldowns.set(key, Date.now());
}

/**
 * Send message to Telegram bot
 */
async function sendToTelegram(message, chatId) {
    const settings = getTelegramSettings();
    
    if (!settings.botToken || !chatId) {
        console.log('[Telegram] Bot not configured or chat ID missing');
        return false;
    }

    const url = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            }),
        });

        const data = await response.json();
        
        if (!data.ok) {
            console.error('[Telegram] Failed:', data.description);
            return false;
        }

        return true;
    } catch (error) {
        console.error('[Telegram] Error:', error.message);
        return false;
    }
}

export async function sendMonitoringMessage(message) {
    const settings = getTelegramSettings();
    return sendToTelegram(message, settings.monitoringChatId);
}

export async function sendFeedbackMessage(message) {
    const settings = getTelegramSettings();
    return sendToTelegram(message, settings.feedbackChatId);
}

export async function sendCameraOfflineNotification(camera) {
    const cooldownKey = `camera_${camera.id}_offline`;
    
    if (isInCooldown(cooldownKey)) {
        console.log(`[Telegram] Skipping offline notification for ${camera.name} (cooldown)`);
        return false;
    }

    const message = `
🔴 <b>KAMERA OFFLINE</b>
━━━━━━━━━━━━━━━━━━━━
📹 <b>${camera.name}</b>
${camera.location ? `📍 ${camera.location}` : ''}
⏰ ${formatDateTime(new Date())}
━━━━━━━━━━━━━━━━━━━━
<i>Segera periksa koneksi kamera!</i>
    `.trim();

    const sent = await sendMonitoringMessage(message);
    if (sent) {
        setCooldown(cooldownKey);
        console.log(`[Telegram] Sent offline notification for ${camera.name}`);
    }
    return sent;
}

export async function sendCameraOnlineNotification(camera, downtime = null) {
    const cooldownKey = `camera_${camera.id}_online`;
    
    if (isInCooldown(cooldownKey)) {
        console.log(`[Telegram] Skipping online notification for ${camera.name} (cooldown)`);
        return false;
    }

    let downtimeText = '';
    if (downtime && downtime > 0) {
        const minutes = Math.floor(downtime / 60);
        const seconds = downtime % 60;
        downtimeText = minutes > 0 ? `\n⏱ Downtime: ${minutes}m ${seconds}s` : `\n⏱ Downtime: ${seconds}s`;
    }

    const message = `
🟢 <b>KAMERA ONLINE</b>
━━━━━━━━━━━━━━━━━━━━
📹 <b>${camera.name}</b>
${camera.location ? `📍 ${camera.location}` : ''}
⏰ ${formatDateTime(new Date())}${downtimeText}
━━━━━━━━━━━━━━━━━━━━
<i>Kamera kembali normal.</i>
    `.trim();

    const sent = await sendMonitoringMessage(message);
    if (sent) {
        setCooldown(cooldownKey);
        console.log(`[Telegram] Sent online notification for ${camera.name}`);
    }
    return sent;
}

export async function sendMultipleCamerasOfflineNotification(cameras) {
    if (cameras.length === 0) return false;
    if (cameras.length === 1) return sendCameraOfflineNotification(cameras[0]);

    const cameraList = cameras.map(c => `• ${c.name}`).join('\n');
    
    const message = `
🔴 <b>${cameras.length} KAMERA OFFLINE</b>
━━━━━━━━━━━━━━━━━━━━
${cameraList}
━━━━━━━━━━━━━━━━━━━━
⏰ ${formatDateTime(new Date())}
<i>Segera periksa koneksi!</i>
    `.trim();

    return sendMonitoringMessage(message);
}

export async function sendFeedbackNotification(feedback) {
    const message = `
📬 <b>Kritik & Saran Baru</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Nama:</b> ${feedback.name || 'Anonim'}
📧 <b>Email:</b> ${feedback.email || '-'}
⏰ <b>Waktu:</b> ${formatDateTime(new Date(feedback.created_at))}
━━━━━━━━━━━━━━━━━━━━
💬 <b>Pesan:</b>
${feedback.message}
━━━━━━━━━━━━━━━━━━━━
<i>ID: #${feedback.id}</i>
    `.trim();

    return sendFeedbackMessage(message);
}

export async function sendTestNotification(type = 'monitoring') {
    const message = `
✅ <b>Test Notifikasi Berhasil</b>
━━━━━━━━━━━━━━━━━━━━
Bot Telegram terhubung dengan baik.
Tipe: ${type === 'monitoring' ? 'Monitoring Kamera' : 'Kritik & Saran'}
⏰ ${formatDateTime(new Date())}
━━━━━━━━━━━━━━━━━━━━
    `.trim();

    if (type === 'feedback') {
        return sendFeedbackMessage(message);
    }
    return sendMonitoringMessage(message);
}

export function isTelegramConfigured() {
    const settings = getTelegramSettings();
    return !!(settings.botToken && settings.monitoringChatId);
}

export function isFeedbackConfigured() {
    const settings = getTelegramSettings();
    return !!(settings.botToken && settings.feedbackChatId);
}

export function getTelegramStatus() {
    const settings = getTelegramSettings();
    return {
        enabled: !!(settings.botToken && (settings.monitoringChatId || settings.feedbackChatId)),
        monitoringConfigured: !!(settings.botToken && settings.monitoringChatId),
        feedbackConfigured: !!(settings.botToken && settings.feedbackChatId),
        botToken: settings.botToken ? `${settings.botToken.substring(0, 10)}...` : '',
        monitoringChatId: settings.monitoringChatId || '',
        feedbackChatId: settings.feedbackChatId || '',
    };
}

export default {
    sendMonitoringMessage,
    sendFeedbackMessage,
    sendCameraOfflineNotification,
    sendCameraOnlineNotification,
    sendMultipleCamerasOfflineNotification,
    sendFeedbackNotification,
    sendTestNotification,
    isTelegramConfigured,
    isFeedbackConfigured,
    getTelegramStatus,
    saveTelegramSettings,
    clearSettingsCache,
};
