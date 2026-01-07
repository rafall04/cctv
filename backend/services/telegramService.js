/**
 * Telegram Notification Service
 * Sends alerts for camera status changes, feedback, and system events
 * Supports separate chat IDs for monitoring and feedback
 */

import { config } from '../config/config.js';

// Cooldown tracking to prevent spam
const notificationCooldowns = new Map(); // key: `camera_${id}_${type}` -> lastSentTime
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown per camera per event type

/**
 * Check if notification is in cooldown period
 * @param {string} key - Unique key for the notification type
 * @returns {boolean} - True if in cooldown
 */
function isInCooldown(key) {
    const lastSent = notificationCooldowns.get(key);
    if (!lastSent) return false;
    return (Date.now() - lastSent) < COOLDOWN_MS;
}

/**
 * Set cooldown for a notification
 * @param {string} key - Unique key for the notification type
 */
function setCooldown(key) {
    notificationCooldowns.set(key, Date.now());
}

/**
 * Format timestamp to WIB (Indonesia time)
 * @param {Date} date 
 * @returns {string}
 */
function formatTimeWIB(date = new Date()) {
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(date);
}

/**
 * Send message to Telegram bot
 * @param {string} message - Message to send (HTML format)
 * @param {string} chatId - Target chat ID
 * @returns {Promise<boolean>} - Success status
 */
async function sendToTelegram(message, chatId) {
    if (!config.telegram.botToken || !chatId) {
        console.log('[Telegram] Bot not configured or chat ID missing, skipping message');
        return false;
    }

    const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;

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
            console.error('[Telegram] Failed to send message:', data.description);
            return false;
        }

        return true;
    } catch (error) {
        console.error('[Telegram] Error sending message:', error.message);
        return false;
    }
}

/**
 * Send message to monitoring chat (camera alerts)
 */
export async function sendMonitoringMessage(message) {
    return sendToTelegram(message, config.telegram.monitoringChatId);
}

/**
 * Send message to feedback chat (kritik & saran)
 */
export async function sendFeedbackMessage(message) {
    return sendToTelegram(message, config.telegram.feedbackChatId);
}

/**
 * Send camera offline notification
 * @param {Object} camera - Camera data { id, name, location }
 * @returns {Promise<boolean>}
 */
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
⏰ ${formatTimeWIB()}
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

/**
 * Send camera online notification
 * @param {Object} camera - Camera data { id, name, location }
 * @param {number} downtime - Downtime in seconds (optional)
 * @returns {Promise<boolean>}
 */
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
        if (minutes > 0) {
            downtimeText = `\n⏱ Downtime: ${minutes}m ${seconds}s`;
        } else {
            downtimeText = `\n⏱ Downtime: ${seconds}s`;
        }
    }

    const message = `
🟢 <b>KAMERA ONLINE</b>
━━━━━━━━━━━━━━━━━━━━
📹 <b>${camera.name}</b>
${camera.location ? `📍 ${camera.location}` : ''}
⏰ ${formatTimeWIB()}${downtimeText}
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

/**
 * Send multiple cameras offline notification (batch)
 * @param {Array} cameras - Array of camera objects
 * @returns {Promise<boolean>}
 */
export async function sendMultipleCamerasOfflineNotification(cameras) {
    if (cameras.length === 0) return false;
    
    if (cameras.length === 1) {
        return sendCameraOfflineNotification(cameras[0]);
    }

    const cameraList = cameras.map(c => `• ${c.name}`).join('\n');
    
    const message = `
🔴 <b>${cameras.length} KAMERA OFFLINE</b>
━━━━━━━━━━━━━━━━━━━━
${cameraList}
━━━━━━━━━━━━━━━━━━━━
⏰ ${formatTimeWIB()}
<i>Segera periksa koneksi!</i>
    `.trim();

    return sendMonitoringMessage(message);
}

/**
 * Send feedback notification to Telegram (kritik & saran)
 * @param {Object} feedback - Feedback data
 */
export async function sendFeedbackNotification(feedback) {
    const message = `
📬 <b>Kritik & Saran Baru</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Nama:</b> ${feedback.name || 'Anonim'}
📧 <b>Email:</b> ${feedback.email || '-'}
⏰ <b>Waktu:</b> ${formatTimeWIB(new Date(feedback.created_at))}
━━━━━━━━━━━━━━━━━━━━
💬 <b>Pesan:</b>
${feedback.message}
━━━━━━━━━━━━━━━━━━━━
<i>ID: #${feedback.id}</i>
    `.trim();

    return sendFeedbackMessage(message);
}

/**
 * Send daily summary notification
 * @param {Object} stats - Daily statistics
 */
export async function sendDailySummary(stats) {
    const message = `
📊 <b>Laporan Harian CCTV</b>
━━━━━━━━━━━━━━━━━━━━
📅 ${formatTimeWIB()}

📹 <b>Kamera:</b>
• Total: ${stats.totalCameras}
• Online: ${stats.onlineCameras}
• Offline: ${stats.offlineCameras}

👥 <b>Penonton Hari Ini:</b>
• Unique: ${stats.uniqueViewers}
• Total Sesi: ${stats.totalSessions}
• Total Durasi: ${Math.round(stats.totalWatchTime / 60)} menit

🏆 <b>Kamera Terpopuler:</b>
${stats.topCamera || 'Belum ada data'}
━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMonitoringMessage(message);
}

/**
 * Send test notification to monitoring chat
 * @returns {Promise<boolean>}
 */
export async function sendTestNotification() {
    const message = `
✅ <b>Test Notifikasi Berhasil</b>
━━━━━━━━━━━━━━━━━━━━
Bot Telegram terhubung dengan baik.
⏰ ${formatTimeWIB()}
━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMonitoringMessage(message);
}

/**
 * Check if Telegram monitoring is configured
 * @returns {boolean}
 */
export function isTelegramConfigured() {
    return !!(config.telegram.botToken && config.telegram.monitoringChatId);
}

/**
 * Check if Telegram feedback is configured
 * @returns {boolean}
 */
export function isFeedbackConfigured() {
    return !!(config.telegram.botToken && config.telegram.feedbackChatId);
}

/**
 * Get Telegram configuration status
 * @returns {Object}
 */
export function getTelegramStatus() {
    return {
        enabled: config.telegram.enabled,
        monitoringConfigured: !!(config.telegram.botToken && config.telegram.monitoringChatId),
        feedbackConfigured: !!(config.telegram.botToken && config.telegram.feedbackChatId),
        monitoringChatId: config.telegram.monitoringChatId ? `***${config.telegram.monitoringChatId.slice(-4)}` : null,
        feedbackChatId: config.telegram.feedbackChatId ? `***${config.telegram.feedbackChatId.slice(-4)}` : null,
    };
}

export default {
    sendMonitoringMessage,
    sendFeedbackMessage,
    sendCameraOfflineNotification,
    sendCameraOnlineNotification,
    sendMultipleCamerasOfflineNotification,
    sendFeedbackNotification,
    sendDailySummary,
    sendTestNotification,
    isTelegramConfigured,
    isFeedbackConfigured,
    getTelegramStatus,
};
