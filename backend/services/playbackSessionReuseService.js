/**
 * Purpose: Recognise a returning browser so a page refresh does not count as a new device.
 * Caller: controllers/playbackTokenController.js (activation).
 * Deps: database/connectionPool.
 * MainFuncs: findLiveSession.
 * SideEffects: Extends last_seen_at/expires_at on the matched session row.
 *
 * WHY THIS EXISTS
 * The share key now stays in the URL, so a link keeps working after its cookie is gone. The price is
 * that /activate is hit on every reload, and createPlaybackSession unconditionally INSERTs.
 *
 * WHY assertPlaybackSession WAS NOT ENOUGH
 * It answers a different question — "is this request allowed to continue?" — and deliberately
 * returns null for an UNLIMITED token, because such a token imposes no session requirement to
 * enforce. Reuse needs the factual question instead: "does a live session row already exist for this
 * cookie?" Production proved the gap: three reloads of one browser produced sessions 2 -> 3 -> 4, so
 * a single viewer showed up in the admin list as four devices.
 *
 * WHY A SEPARATE FILE
 * playbackTokenService.js is frozen by the size ratchet at 1334 lines and sits 1 line under it. The
 * rule is to extract rather than grow.
 */

import crypto from 'crypto';
import { execute, queryOne } from '../database/connectionPool.js';

export const PLAYBACK_TOKEN_SESSION_COOKIE = 'raf_playback_session';

/** Must match playbackTokenService.hashToken — sessions are stored hashed, never in the clear. */
function hashSessionId(sessionId) {
    return crypto.createHash('sha256').update(sessionId).digest('hex');
}

/**
 * The live session this request already holds for this token, or null.
 *
 * Scoped by token_id, so a cookie left over from a different token never grants reuse — that
 * request correctly falls through and mints its own session.
 */
export function findLiveSession({ request = {}, token } = {}) {
    const tokenId = Number.parseInt(token?.id, 10);
    const sessionId = request?.cookies?.[PLAYBACK_TOKEN_SESSION_COOKIE];
    if (!Number.isInteger(tokenId) || tokenId <= 0 || !sessionId) {
        return null;
    }

    const row = queryOne(
        `SELECT id, token_id
        FROM playback_token_sessions
        WHERE token_id = ?
          AND session_id_hash = ?
          AND ended_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP`,
        [tokenId, hashSessionId(sessionId)]
    );

    if (!row) {
        return null;
    }

    // A reload is proof of life, so push the expiry out; otherwise a viewer who only ever refreshes
    // would have the session lapse underneath them.
    const timeoutSeconds = Number.parseInt(token?.session_timeout_seconds, 10);
    if (Number.isInteger(timeoutSeconds) && timeoutSeconds > 0) {
        const expiresAt = new Date(Date.now() + timeoutSeconds * 1000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 19);
        execute(
            `UPDATE playback_token_sessions
            SET last_seen_at = CURRENT_TIMESTAMP, expires_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            [expiresAt, row.id]
        );
    }

    return { ...row, session_id: sessionId };
}

export default { findLiveSession, PLAYBACK_TOKEN_SESSION_COOKIE };
