/*
 * Purpose: "Token Saya" — remember a buyer's playback access tokens in this browser (localStorage) so
 *          they see and reuse them without any account, WhatsApp, or Telegram. This is the primary
 *          token storage for the anonymous flow; the phone+code recovery page covers a new device.
 * Caller: components/playback/PlaybackAccessPanel, MyPlaybackTokens, PlaybackTokenAccess.
 * Deps: none (pure browser storage, defensive).
 * MainFuncs: saveToken, listTokens, removeToken, isExpired.
 * SideEffects: reads/writes one localStorage key; every access is try/catch-guarded (private windows,
 *              disabled storage, quota) and degrades to "no saved tokens" rather than throwing.
 */

const KEY = 'raf_playback_saved_tokens_v1';
const MAX = 20; // keep the list bounded; a buyer never needs more, and this caps quota use.

function readAll() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.shareKey === 'string') : [];
    } catch {
        return [];
    }
}

function writeAll(list) {
    try {
        localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
        return true;
    } catch {
        return false;
    }
}

/** Parse a UTC SQL / ISO timestamp; null when absent or unparseable. */
function toDate(value) {
    if (!value) return null;
    const iso = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function isExpired(token, now = Date.now()) {
    const d = toDate(token?.expiresAt);
    return d ? d.getTime() <= now : false; // no expiry = never expired (treated as long-lived)
}

/**
 * Upsert a token by its shareKey. Keeps the newest recoveryCode/expiry, moves it to the front, and
 * preserves any fields (phone, label) the caller does not re-send. Returns the saved list.
 */
export function saveToken(token) {
    if (!token || typeof token.shareKey !== 'string' || !token.shareKey.trim()) return listTokens();
    const key = token.shareKey.trim();
    const list = readAll();
    const existing = list.find((t) => t.shareKey === key) || {};
    const merged = {
        ...existing,
        shareKey: key,
        label: token.label ?? existing.label ?? 'Paket Playback',
        expiresAt: token.expiresAt ?? existing.expiresAt ?? null,
        recoveryCode: token.recoveryCode ?? existing.recoveryCode ?? null,
        phone: token.phone ?? existing.phone ?? null,
        windowHours: token.windowHours ?? existing.windowHours ?? null,
        savedAt: existing.savedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    const next = [merged, ...list.filter((t) => t.shareKey !== key)];
    writeAll(next);
    return next;
}

/** All saved tokens, newest first. */
export function listTokens() {
    return readAll().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function removeToken(shareKey) {
    const next = readAll().filter((t) => t.shareKey !== shareKey);
    writeAll(next);
    return next;
}

export default { saveToken, listTokens, removeToken, isExpired };
