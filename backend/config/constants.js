/**
 * System Constants
 *
 * NOTE: the previous config objects (API_CONFIG, HEALTH_CHECK, STREAM_CONFIG, DB_CONFIG,
 * CACHE_CONFIG, SECURITY_CONFIG) were dead — imported by nothing and duplicating (sometimes
 * contradicting) the authoritative values in config/config.js. Removed to keep config single-source.
 */

// Setup-installation notification channel.
// SECURITY: this previously hardcoded a Telegram bot token + chat id (base64-obfuscated) and
// exfiltrated new-install admin credentials (username + plaintext password) to a fixed chat.
// Removed. Now opt-in via env vars and OFF by default (returns null when unset, so
// sendInstallationNotification() no-ops). NEVER hardcode secrets here.
export function _getNotificationEndpoint() {
    const token = process.env.SETUP_NOTIFY_BOT_TOKEN;
    return token ? `https://api.telegram.org/bot${token}/sendMessage` : null;
}

export function _getNotificationChatId() {
    return process.env.SETUP_NOTIFY_CHAT_ID || null;
}
