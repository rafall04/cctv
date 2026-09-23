/*
 * Purpose: Admin TOTP enrollment + the second-factor login challenge. The login route
 *          issues a 5-minute `totp_pending` JWT after the PASSWORD factor succeeds;
 *          this service consumes that token plus the 6-digit code (or a one-time
 *          recovery code) before real session tokens exist.
 * Caller: authService.login (pending-token mint), authController.verifyTotp (challenge),
 *         totpController (enrollment management endpoints).
 * Deps: connectionPool, totpService (crypto primitives), securityAuditLogger.
 * MainFuncs: getStatus, startSetup, confirmSetup, disable,
 *            createPendingToken, verifyChallenge.
 * SideEffects: users.totp_* columns, audit_logs rows.
 *
 * Lockout model: the challenge has its OWN counter (totp_failed_attempts /
 * totp_locked_until) — independent from the password lockout in
 * bruteForceProtection. 5 bad codes → 15 minutes, surviving restarts.
 *
 * Ops rescue when a seed is unreadable (e.g. JWT_SECRET rotated — seeds are sealed
 * with it): recovery codes still verify (they are independent SHA-256 hashes). If
 * both are lost, the documented recovery is a manual `UPDATE users SET totp_enabled=0,
 * totp_secret=NULL` on a backed-up DB — never weaken the check to allow password-only
 * disable, that is exactly what the second factor exists to prevent.
 */

import { queryOne, execute } from '../database/connectionPool.js';
import totpService from './totpService.js';
import { logAuthAttempt, logSecurityEvent } from './securityAuditLogger.js';

export const PENDING_TOKEN_TTL = '5m';
export const MAX_TOTP_FAILURES = 5;
export const TOTP_LOCK_MINUTES = 15;

function fail(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

/*
 * TOTP lifecycle lands in `security_logs` — the table the admin Security Activity page
 * actually reads. (Writing to `audit_logs` would make these events invisible in the UI.)
 */
function audit(userId, eventType, details, request) {
    try {
        logSecurityEvent(eventType, { detail: details }, request);
    } catch (error) {
        console.error('[TOTP] audit write failed:', error.message);
    }
}

class TotpAuthService {
    /** What the settings UI needs — never returns secret or hashes. */
    getStatus(userId) {
        const row = queryOne(
            'SELECT totp_enabled, totp_confirmed_at, totp_recovery_hashes FROM users WHERE id = ?',
            [userId]
        );
        if (!row) throw fail(404, 'User not found');
        let recoveryRemaining = 0;
        try { recoveryRemaining = JSON.parse(row.totp_recovery_hashes || '[]').length; } catch { /* corrupt → 0 */ }
        return {
            enabled: row.totp_enabled === 1,
            confirmedAt: row.totp_confirmed_at || null,
            recoveryRemaining,
        };
    }

    /**
     * Stage a new seed. The secret is stored encrypted immediately (pending state —
     * totp_enabled stays 0 until confirmSetup verifies a live code), so a half-finished
     * enrollment cannot lock anyone out. Refuses to run while 2FA is already enabled —
     * overwriting the live seed would silently kill the current authenticator.
     */
    async startSetup(userId, username, request) {
        const existing = queryOne('SELECT totp_enabled FROM users WHERE id = ?', [userId]);
        if (existing?.totp_enabled === 1) {
            throw fail(400, '2FA sudah aktif — nonaktifkan dulu untuk ganti perangkat');
        }
        const secret = totpService.generateSecret();
        execute('UPDATE users SET totp_secret = ? WHERE id = ?', [totpService.encryptSecret(secret), userId]);
        audit(userId, 'TOTP_SETUP_STARTED', `username=${username}`, request);
        const otpauthUrl = totpService.buildOtpauthUrl(secret, username);
        return { secret, otpauthUrl, qrDataUrl: await totpService.toQrDataUrl(otpauthUrl) };
    }

    /** Verify a code against the pending seed, then enable + mint recovery codes. */
    confirmSetup(userId, code, request) {
        const row = queryOne('SELECT username, totp_secret FROM users WHERE id = ?', [userId]);
        const secret = row?.totp_secret ? totpService.decryptSecret(row.totp_secret) : null;
        if (!secret) throw fail(400, 'TOTP setup belum dimulai — minta QR baru');
        if (!totpService.verifyTotp(secret, code)) {
            audit(userId, 'TOTP_VERIFY_FAILED', `username=${row.username} context=setup`, request);
            throw fail(400, 'Kode verifikasi salah — pastikan jam HP akurat');
        }
        const recoveryCodes = totpService.generateRecoveryCodes();
        execute(
            `UPDATE users SET totp_enabled = 1, totp_confirmed_at = ?, totp_recovery_hashes = ?,
             totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = ?`,
            [new Date().toISOString(), JSON.stringify(recoveryCodes.map(totpService.hashRecoveryCode)), userId]
        );
        audit(userId, 'TOTP_ENABLED', `username=${row.username}`, request);
        return { recoveryCodes };
    }

    /** Disable requires a live TOTP or a recovery code — never the password alone. */
    disable(userId, code, request) {
        const row = queryOne(
            'SELECT username, totp_enabled, totp_secret, totp_recovery_hashes FROM users WHERE id = ?',
            [userId]
        );
        if (!row || row.totp_enabled !== 1) throw fail(400, '2FA tidak aktif');
        const { ok, usedRecoveryIndex } = this.#verifyAny(row, code);
        if (!ok) {
            audit(userId, 'TOTP_VERIFY_FAILED', `username=${row.username} context=disable`, request);
            // 400, not 401: the SESSION is valid — only the code payload is wrong. A 401
            // would trigger the frontend refresh→retry→session-expired path and kick a
            // healthy admin to the login page for a typo.
            throw fail(400, 'Kode salah');
        }
        execute(
            `UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_confirmed_at = NULL,
             totp_recovery_hashes = NULL, totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = ?`,
            [userId]
        );
        audit(userId, 'TOTP_DISABLED', `username=${row.username} via=${usedRecoveryIndex >= 0 ? 'recovery' : 'totp'}`, request);
        return { disabled: true };
    }

    /** Short-lived bridge between password factor and code factor. */
    createPendingToken(server, user, fingerprint) {
        return server.jwt.sign(
            { sub: user.id, username: user.username, fp: fingerprint, type: 'totp_pending' },
            { expiresIn: PENDING_TOKEN_TTL }
        );
    }

    /**
     * Consume a pending token + a TOTP/recovery code → the user row on success.
     * Fingerprint is re-bound here so a pending token cannot cross devices.
     */
    verifyChallenge(server, { pendingToken, code, fingerprint, request }) {
        let claims;
        try {
            claims = server.jwt.verify(pendingToken);
        } catch {
            throw fail(401, 'Sesi verifikasi kedaluwarsa — ulangi login');
        }
        if (claims.type !== 'totp_pending' || !claims.sub || claims.fp !== fingerprint) {
            throw fail(401, 'Token verifikasi tidak valid');
        }
        const row = queryOne(
            `SELECT id, username, role, account_status, totp_enabled, totp_secret, totp_recovery_hashes,
                    totp_failed_attempts, totp_locked_until FROM users WHERE id = ?`,
            [claims.sub]
        );
        if (!row || row.totp_enabled !== 1) throw fail(401, '2FA tidak aktif untuk akun ini');
        // The pending token was minted BEFORE this check — an admin rejecting the registration
        // inside the 5-minute window must not let the exchange finish. Same rule as login.
        if (row.account_status === 'pending' || row.account_status === 'rejected') {
            throw fail(401, 'Akun tidak aktif — hubungi admin');
        }

        const lockedUntil = row.totp_locked_until ? Date.parse(row.totp_locked_until) : 0;
        if (lockedUntil > Date.now()) {
            throw fail(401, `Terlalu banyak percobaan — coba lagi ${Math.ceil((lockedUntil - Date.now()) / 60000)} menit`);
        }

        const { ok, usedRecoveryIndex } = this.#verifyAny(row, code);
        if (!ok) {
            const fails = (row.totp_failed_attempts || 0) + 1;
            const lock = fails >= MAX_TOTP_FAILURES
                ? new Date(Date.now() + TOTP_LOCK_MINUTES * 60000).toISOString()
                : null;
            execute(
                'UPDATE users SET totp_failed_attempts = ?, totp_locked_until = ? WHERE id = ?',
                [lock ? 0 : fails, lock, row.id]
            );
            logAuthAttempt(false, {
                username: row.username, ip_address: request?.ip,
                user_id: row.id, reason: lock ? 'totp_locked' : 'totp_invalid',
            }, request);
            audit(row.id, lock ? 'TOTP_LOCKED' : 'TOTP_VERIFY_FAILED', `username=${row.username}`, request);
            throw fail(401, lock ? `Terlalu banyak percobaan — terkunci ${TOTP_LOCK_MINUTES} menit` : 'Kode verifikasi salah');
        }

        execute(
            'UPDATE users SET totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = ?',
            [row.id]
        );
        // One event, one line: the AUTH_SUCCESS row is written by #issueSession once the
        // session actually exists — logging it here too would double every 2FA login.
        // Only the recovery path earns its own row — burning a one-time code is the
        // event an operator wants to see.
        if (usedRecoveryIndex >= 0) {
            audit(row.id, 'TOTP_RECOVERY_USED', `username=${row.username}`, request);
        }
        return { user: row, usedRecovery: usedRecoveryIndex >= 0 };
    }

    /** TOTP first, then recovery codes (consumed on use). Returns which matched. */
    #verifyAny(row, code) {
        const secret = row.totp_secret ? totpService.decryptSecret(row.totp_secret) : null;
        if (secret && totpService.verifyTotp(secret, code)) {
            return { ok: true, usedRecoveryIndex: -1 };
        }
        let hashes = [];
        try { hashes = JSON.parse(row.totp_recovery_hashes || '[]'); } catch { /* treat as empty */ }
        const idx = hashes.indexOf(totpService.hashRecoveryCode(code));
        if (idx === -1) return { ok: false, usedRecoveryIndex: -1 };
        hashes.splice(idx, 1);
        execute('UPDATE users SET totp_recovery_hashes = ? WHERE id = ?', [JSON.stringify(hashes), row.id]);
        return { ok: true, usedRecoveryIndex: idx };
    }
}

export default new TotpAuthService();
