/*
 * Purpose: Upload a file to a Telegram chat as a document (multipart), for backups and exports.
 * Caller: backupTelegramService.
 * Deps: database settings (`telegram_config`), global fetch/FormData.
 * MainFuncs: sendTelegramDocument, isTelegramTokenConfigured.
 * SideEffects: One outbound multipart HTTPS request to api.telegram.org.
 *
 * Separate from telegramService on purpose, twice over:
 *  - telegramService.callTelegramApi posts JSON; sendDocument needs multipart/form-data, so there
 *    is nothing to reuse beyond the token lookup.
 *  - telegramService.js is frozen at its size ceiling by the guardrail, and the rule is to shrink
 *    the change rather than raise the baseline. Uploading a file is also a genuinely different
 *    concern from routing status notifications.
 *
 * The token is read from the same settings row telegramService uses, and never leaves this module.
 */

import { queryOne } from '../database/connectionPool.js';
import { config } from '../config/config.js';

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** Bot token from the same source telegramService reads, falling back to env like it does. */
function readBotToken() {
    try {
        const row = queryOne('SELECT value FROM settings WHERE key = ?', ['telegram_config']);
        const fromDb = row ? String(JSON.parse(row.value)?.botToken || '').trim() : '';
        if (fromDb) return fromDb;
    } catch {
        // Unreadable/!JSON settings must not crash a backup â€” fall through to env.
    }
    return String(config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

export function isTelegramTokenConfigured() {
    return Boolean(readBotToken());
}

/**
 * @param {string|number} chatId
 * @param {{ buffer: Buffer, filename: string, caption?: string, timeoutMs?: number }} file
 * @returns {Promise<object>} Telegram's `result` object
 */
export async function sendTelegramDocument(chatId, { buffer, filename, caption = '', timeoutMs = UPLOAD_TIMEOUT_MS }) {
    const botToken = readBotToken();
    if (!botToken) {
        const err = new Error('Bot token Telegram belum diatur.');
        err.statusCode = 400;
        throw err;
    }

    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) {
        form.append('caption', caption);
        form.append('parse_mode', 'HTML');
    }
    form.append('document', new Blob([buffer]), filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
            method: 'POST',
            body: form,
            signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!data?.ok) {
            // Surface Telegram's own words: "chat not found" and "bot is not a member" are the two
            // an operator can actually act on, and both are indistinguishable from a generic failure.
            throw new Error(`Telegram menolak berkas: ${data?.description || `HTTP ${response.status}`}`);
        }
        return data.result;
    } finally {
        clearTimeout(timeout);
    }
}

export default { sendTelegramDocument, isTelegramTokenConfigured };
