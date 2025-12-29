import { config } from '../config/config.js';

/**
 * Send message to Telegram bot
 * @param {string} message - Message to send
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
            }),
        });

        const data = await response.json();
        
        if (!data.ok) {
            console.error('[Telegram] Failed to send message:', data.description);
            return false;
        }

        console.log('[Telegram] Message sent successfully');
        return true;
    } catch (error) {
        console.error('[Telegram] Error sending message:', error.message);
        return false;
    }
}

/**
 * Send feedback notification to Telegram
 * @param {Object} feedback - Feedback data
 */
export async function sendFeedbackNotification(feedback) {
    const message = `
<b>📬 Kritik & Saran Baru</b>

<b>Nama:</b> ${feedback.name || 'Anonim'}
<b>Email:</b> ${feedback.email || '-'}
<b>Waktu:</b> ${new Date(feedback.created_at).toLocaleString('id-ID')}

<b>Pesan:</b>
${feedback.message}

<i>ID: #${feedback.id}</i>
    `.trim();

    return sendTelegramMessage(message);
}

export default {
    sendTelegramMessage,
    sendFeedbackNotification,
};
