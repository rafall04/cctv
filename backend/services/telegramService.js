/**
 * Telegram Notification Service
 * Sends alerts for camera status changes, feedback, and system events
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
    notificationCooldowns.set(key);
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
 * @returns {Promise<boolean>} - Success status
 */
export async function sendTelegramMessage(message) {
    if (!config.telegram.enabled) {
        console.log('[Telegram] Bot not configured, skipping message');
        return false;
    }

    const { botToken, chatId } = config.telegram;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

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

    const sent = await sendTelegramMessage(message);
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

    const sent = await sendTelegramMessage(message);
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

    return sendTelegramMessage(message);
}

/**
 * Send feedback notification to Telegram
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

    return sendTelegramMessage(message);
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

    return sendTelegramMessage(message);
}

/**
 * Send test notification
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

    return sendTelegramMessage(message);
}

/**
 * Check if Telegram is configured
 * @returns {boolean}
 */
export function isTelegramConfigured() {
    return config.telegram.enabled;
}

/**
 * Get Telegram configuration status
 * @returns {Object}
 */
export function getTelegramStatus() {
    return {
        enabled: config.telegram.enabled,
        configured: !!(config.telegram.botToken && config.telegram.chatId),
        chatId: config.telegram.chatId ? `***${config.telegram.chatId.slice(-4)}` : null,
    };
}

export default {
    sendTelegramMessage,
    sendCameraOfflineNotification,
    sendCameraOnlineNotification,
    sendMultipleCamerasOfflineNotification,
    sendFeedbackNotification,
    sendDailySummary,
    sendTestNotification,
    isTelegramConfigured,
    getTelegramStatus,
};
