/**
 * Purpose: Seal/reveal playback share keys at rest so a DB dump cannot mint share links.
 * Caller: playbackTokenService (create/reuse), playbackOrderService + customerController (authorized reveal).
 * Deps: totpService AES-256-GCM envelope (keyed off JWT_SECRET), sessionManager sha256.
 * MainFuncs: isSealedShareKey, revealShareKey, sealShareKey, resolveReusableShareKey.
 * SideEffects: None (pure crypto; no DB, no logging beyond a seal-failure warning).
 */

import { encryptSecret, decryptSecret } from './totpService.js';
import { hashToken } from './sessionManager.js';

// share_key_prefix historically held the FULL share key in plaintext — anyone reading a DB
// dump could mint share links for every token. New rows store an AES-256-GCM blob (same
// envelope as TOTP secrets, keyed off JWT_SECRET); legacy plaintext still resolves until the
// zz_*_encrypt_share_key_prefix migration seals it. Blob shape: <b64>.<b64>.<b64>.
const SECRET_BLOB_RE = /^[A-Za-z0-9+/]{8,}={0,2}\.[A-Za-z0-9+/]{8,}={0,2}\.[A-Za-z0-9+/]+=*$/;

export function isSealedShareKey(value) {
    return SECRET_BLOB_RE.test(String(value || '').trim());
}

/** Full share key for display/use, or null when a sealed blob can't be opened (wrong key). */
export function revealShareKey(stored) {
    const raw = String(stored || '').trim();
    if (!raw) return null;
    return isSealedShareKey(raw) ? decryptSecret(raw) : raw;
}

export function sealShareKey(shareKey) {
    try {
        return encryptSecret(shareKey);
    } catch (error) {
        // No JWT secret → encryption unavailable; store plaintext rather than lose the key.
        console.warn('[PlaybackToken] share-key seal unavailable:', error.message);
        return shareKey;
    }
}

export function resolveReusableShareKey(row = {}) {
    const shareKey = revealShareKey(row.share_key_prefix);
    if (!shareKey || !row.share_key_hash) {
        return null;
    }

    return hashToken(shareKey) === row.share_key_hash ? shareKey : null;
}
