/**
 * Purpose: Permanently delete a playback token — the step revoking never took.
 * Caller: controllers/playbackTokenController.js (admin-only route).
 * Deps: database/connectionPool, services/securityAuditLogger.
 * MainFuncs: deletePlaybackToken.
 * SideEffects: Removes one playback_tokens row; sessions and camera rules cascade away with it.
 *
 * WHY A SEPARATE FILE
 * playbackTokenService.js is frozen by the size ratchet at 1334 lines and sits 3 lines under it.
 * The rule is to extract rather than grow, and "destroy this token for good" is a distinct,
 * safety-sensitive operation that earns its own module.
 *
 * WHY REVOKING WAS NOT ENOUGH
 * revokeToken only stamps revoked_at, so a trial token stays in the list forever as another
 * "Nonaktif" row. After a handful of experiments the table is mostly debris, and picking the right
 * row to revoke becomes guesswork — which matters when the wrong click cuts off a paying viewer.
 *
 * WHAT THE DELETE TAKES WITH IT
 * The schema already decided this, and it decided well:
 *   - playback_token_sessions  ON DELETE CASCADE   -> live sessions die with the token (correct:
 *                                                     they are worthless without it)
 *   - playback_token_camera_rules ON DELETE CASCADE -> scope rules are meaningless alone
 *   - playback_token_audit_logs ON DELETE SET NULL  -> the HISTORY SURVIVES. Who accessed what and
 *                                                     when is a record, not a possession of the
 *                                                     token, so it must outlive it.
 * Those actions only fire because connectionPool sets `foreign_keys = ON` on the write connection
 * (connectionPool.js:131). Without that pragma SQLite ignores them and silently orphans rows.
 */

import { execute, queryOne } from '../database/connectionPool.js';
import { logSecurityEvent } from './securityAuditLogger.js';

/**
 * Delete a playback token for good.
 *
 * Deliberately allows deleting an ACTIVE token. Forcing a revoke first would be two steps for the
 * common case (clearing away an experiment) and the caller already has to confirm; the reply
 * reports whether the token was live so the UI can say what actually happened.
 *
 * @param {number|string} id
 * @param {object} [request] fastify request, for the security audit trail
 * @returns {{ id: number, label: string, wasActive: boolean }}
 */
export function deletePlaybackToken(id, request = {}) {
    const tokenId = Number.parseInt(id, 10);
    if (!Number.isInteger(tokenId) || tokenId <= 0) {
        const err = new Error('Invalid token id');
        err.statusCode = 400;
        throw err;
    }

    // Read BEFORE deleting: afterwards there is nothing left to describe in the audit entry or to
    // tell the operator which token just went.
    const token = queryOne(
        'SELECT id, label, revoked_at, expires_at FROM playback_tokens WHERE id = ?',
        [tokenId],
    );
    if (!token) {
        const err = new Error('Token tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }

    const wasActive = !token.revoked_at
        && (!token.expires_at || new Date(`${token.expires_at}Z`).getTime() > Date.now());

    const result = execute('DELETE FROM playback_tokens WHERE id = ?', [tokenId]);
    if (result.changes === 0) {
        // Lost a race with another admin deleting the same row. Not an error worth a 500.
        const err = new Error('Token tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }

    // Deleting access is exactly the kind of act that must leave a trace, and this one cannot be
    // reconstructed from playback_token_audit_logs — those rows keep their history but lose the
    // token_id that pointed here.
    logSecurityEvent(
        'PLAYBACK_TOKEN_DELETED',
        { username: request.user?.username || null, tokenId, label: token.label, wasActive },
        request,
    );

    return { id: tokenId, label: token.label, wasActive };
}

export default { deletePlaybackToken };
