/**
 * Purpose: Extend (perpanjang) an existing playback token's validity — the "renewal" half of the paid
 *          playback flow — and resolve a token from the buyer's access code. Kept OUT of the frozen
 *          playbackTokenService.js on purpose; it only reaches back for recordAudit().
 * Caller: playbackOrderService (renewal orders), playbackAccessController (lookup), admin renew.
 * Deps: connectionPool, playbackTokenService (audit only), crypto.
 * MainFuncs: findTokenByAccessCode, renewToken.
 * SideEffects: Writes playback_tokens.expires_at + a playback_token_renewals ledger row + an audit row.
 *
 * EXACTLY-ONCE — the whole reason this file is careful. One paid order must extend a token exactly
 * once, even under the same guarded-flip/crash-heal races playbackOrderService already survives, and
 * even across the two cluster workers. The idempotency key is playback_token_renewals.order_id UNIQUE:
 * the ledger INSERT and the expiry bump run in ONE transaction, so a second attempt's INSERT throws,
 * the transaction rolls back, and the expiry is NOT bumped twice. New expiry math is done in SQLite
 * (UTC) to match exactly how playbackTokenService stores expires_at — no JS date-format drift.
 */

import crypto from 'crypto';
import { queryOne, execute, transaction } from '../database/connectionPool.js';
import playbackTokenService from './playbackTokenService.js';

// Same hash playbackTokenService uses for share_key_hash (plain SHA-256 hex, no salt).
function hashToken(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

class PlaybackTokenRenewalService {
    /**
     * Resolve the token a buyer's access code (share key) points at, so a renewal order knows which
     * token to extend. Returns null when the code matches nothing. Never returns the token hash.
     */
    findTokenByAccessCode(code) {
        if (!code || typeof code !== 'string' || !code.trim()) return null;
        const row = queryOne(
            `SELECT id, label, scope_type, expires_at, revoked_at, playback_window_hours,
                    playback_from, playback_to, share_key_prefix
             FROM playback_tokens WHERE share_key_hash = ?`,
            [hashToken(code.trim())]
        );
        return row || null;
    }

    /**
     * Extend token `tokenId` by `days`. Exactly-once per `orderId` (see file header). New expiry =
     * later of (current expiry, now) + days. Returns { alreadyRenewed, previousExpiresAt, newExpiresAt,
     * daysAdded }. Throws 404 for a missing token, 400 for a revoked token or bad args.
     */
    renewToken(tokenId, days, { orderId = null, request = {} } = {}) {
        const id = Number(tokenId);
        const addDays = Number(days);
        if (!Number.isInteger(id) || id <= 0) throw badRequest('tokenId tidak valid');
        if (!Number.isInteger(addDays) || addDays <= 0) throw badRequest('Jumlah hari perpanjangan tidak valid');

        const token = queryOne('SELECT id, expires_at, revoked_at FROM playback_tokens WHERE id = ?', [id]);
        if (!token) {
            const err = new Error('Token tidak ditemukan');
            err.statusCode = 404;
            throw err;
        }
        if (token.revoked_at) throw badRequest('Token sudah dicabut, tidak bisa diperpanjang');

        const run = transaction(() => {
            // New expiry computed in SQLite (UTC), matching how expires_at is stored. COALESCE handles a
            // never-expiring token (base = now); MAX(..., now) means an already-expired token restarts
            // from now rather than stacking dead time.
            const computed = queryOne(
                `SELECT datetime(MAX(COALESCE(expires_at, datetime('now')), datetime('now')), '+' || ? || ' days') AS new_expiry
                 FROM playback_tokens WHERE id = ?`,
                [addDays, id]
            );
            const newExpiry = computed?.new_expiry;
            if (!newExpiry) throw new Error('Gagal menghitung masa berlaku baru');
            // Ledger INSERT FIRST: on a duplicate order_id it throws, aborting the transaction BEFORE the
            // expiry bump — so a replay never double-extends.
            execute(
                `INSERT INTO playback_token_renewals (order_id, token_id, days_added, previous_expires_at, new_expires_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [orderId, id, addDays, token.expires_at || null, newExpiry]
            );
            execute('UPDATE playback_tokens SET expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newExpiry, id]);
            return { alreadyRenewed: false, previousExpiresAt: token.expires_at || null, newExpiresAt: newExpiry, daysAdded: addDays };
        });

        let result;
        try {
            result = run();
        } catch (error) {
            if (orderId != null && /UNIQUE constraint failed: playback_token_renewals\.order_id/i.test(error?.message || '')) {
                const existing = queryOne(
                    'SELECT previous_expires_at, new_expires_at, days_added FROM playback_token_renewals WHERE order_id = ?',
                    [orderId]
                );
                return {
                    alreadyRenewed: true,
                    previousExpiresAt: existing?.previous_expires_at || null,
                    newExpiresAt: existing?.new_expires_at || null,
                    daysAdded: existing?.days_added || addDays,
                };
            }
            throw error;
        }

        // Audit outside the transaction: a missing audit table must never roll back a real renewal
        // (recordAudit already swallows a missing-schema error).
        playbackTokenService.recordAudit({
            tokenId: id,
            eventType: 'renewed',
            request,
            detail: {
                days: addDays,
                order_id: orderId,
                previous_expires_at: result.previousExpiresAt,
                new_expires_at: result.newExpiresAt,
            },
        });
        return result;
    }
}

export default new PlaybackTokenRenewalService();
