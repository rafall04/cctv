import bcrypt from 'bcrypt';
import { queryOne, execute } from '../database/connectionPool.js';
import {
    checkLockout,
    trackFailedAttempt,
    trackSuccessfulLogin,
    checkAndTriggerLockout,
    getCurrentAttemptCount,
    applyProgressiveDelay
} from './bruteForceProtection.js';
import { logAuthAttempt, logSessionCreated, logSessionRefreshed, logFingerprintMismatch } from './securityAuditLogger.js';
import {
    generateFingerprint,
    createTokenPair,
    blacklistToken,
    getTokenBlacklistEntry,
    blacklistAllUserTokens,
    rotateTokens,
    validateFingerprint,
    isSessionExpired,
    isTokenInvalidatedByUser
} from './sessionManager.js';
import { checkPasswordExpiry, checkPasswordExpiryWarning } from './passwordExpiry.js';
import totpAuthService from './totpAuthService.js';

class AuthService {
    async login(username, password, clientIp, request, server) {
        const lockoutStatus = checkLockout(username, clientIp);
        if (lockoutStatus.locked) {
            logAuthAttempt(false, {
                username,
                ip_address: clientIp,
                reason: 'Account locked',
                lockType: lockoutStatus.lockType
            }, request);

            const err = new Error('Invalid credentials');
            err.statusCode = 401;
            throw err;
        }

        const attemptCount = getCurrentAttemptCount(username, clientIp);

        const user = queryOne(
            'SELECT id, username, password_hash, role, account_status, totp_enabled FROM users WHERE username = ?',
            [username]
        );

        if (!user) {
            trackFailedAttempt(username, clientIp);
            checkAndTriggerLockout(username, clientIp, request);

            logAuthAttempt(false, {
                username,
                ip_address: clientIp,
                reason: 'User not found'
            }, request);

            await applyProgressiveDelay(attemptCount + 1);

            const err = new Error('Invalid credentials');
            err.statusCode = 401;
            throw err;
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            trackFailedAttempt(username, clientIp);
            checkAndTriggerLockout(username, clientIp, request);

            logAuthAttempt(false, {
                username,
                ip_address: clientIp,
                reason: 'Invalid password'
            }, request);

            await applyProgressiveDelay(attemptCount + 1);

            const err = new Error('Invalid credentials');
            err.statusCode = 401;
            throw err;
        }

        // Approval gate (runs AFTER password verification so it never leaks which
        // accounts exist). Self-registered customers stay 'pending' until an admin
        // approves; 'rejected' ones are declined. Staff and approved customers pass.
        if (user.account_status === 'pending' || user.account_status === 'rejected') {
            // Password was correct — clear the failed-attempt counter, but issue no session.
            trackSuccessfulLogin(username, clientIp);
            logAuthAttempt(false, {
                username,
                ip_address: clientIp,
                user_id: user.id,
                reason: `account_${user.account_status}`,
            }, request);

            const err = new Error(
                user.account_status === 'pending'
                    ? 'Akun Anda menunggu persetujuan admin. Anda akan bisa login setelah disetujui.'
                    : 'Pendaftaran Anda ditolak. Silakan hubungi admin.'
            );
            err.statusCode = 403;
            err.reason = user.account_status === 'pending' ? 'pending_approval' : 'registration_rejected';
            throw err;
        }

        trackSuccessfulLogin(username, clientIp);

        const fingerprint = generateFingerprint(request);

        // Second factor: password verified but no session exists yet — hand back a
        // 5-minute pending token that only /api/auth/totp/verify can exchange.
        if (user.totp_enabled === 1) {
            const pendingToken = totpAuthService.createPendingToken(server, user, fingerprint);
            logAuthAttempt(false, {
                username,
                ip_address: clientIp,
                user_id: user.id,
                reason: 'totp_challenge_issued'
            }, request);
            return { requiresTwoFactor: true, pendingToken };
        }

        return this.#issueSession(user, fingerprint, request, server, clientIp);
    }

    /**
     * Second-factor exchange: pending token + TOTP/recovery code → the same session
     * tail as password-only login. Anything wrong throws 401 — callers never get a
     * partial session.
     */
    async completeTwoFactorLogin(server, pendingToken, code, request) {
        const { user } = totpAuthService.verifyChallenge(server, {
            pendingToken,
            code,
            fingerprint: generateFingerprint(request),
            request
        });
        const ip = request?.ip || request?.headers?.['x-forwarded-for'] || 'unknown';
        return this.#issueSession(user, generateFingerprint(request), request, server, ip);
    }

    #issueSession(user, fingerprint, request, server, clientIp) {
        const { accessToken, refreshToken, sessionCreatedAt } = createTokenPair(
            server,
            user,
            fingerprint
        );

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'LOGIN', 'User logged in successfully', request.ip]
        );

        logAuthAttempt(true, {
            username: user.username,
            ip_address: request.ip,
            user_id: user.id,
            fingerprint: fingerprint.substring(0, 16) + '...'
        }, request);

        logSessionCreated({
            userId: user.id,
            username: user.username,
            fingerprint: fingerprint
        }, request);

        execute(
            'UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?',
            [new Date().toISOString(), clientIp, user.id]
        );

        const passwordExpiryStatus = checkPasswordExpiry(user.id);
        const passwordExpiryWarning = checkPasswordExpiryWarning(user.id);

        return {
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
            },
            passwordExpiryStatus,
            passwordExpiryWarning
        };
    }

    async logout(userId, clientIp, accessToken, refreshToken) {
        if (accessToken) {
            blacklistToken(accessToken, userId, 'logout');
        }
        if (refreshToken) {
            blacklistToken(refreshToken, userId, 'logout');
        }

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'LOGOUT', 'User logged out', clientIp]
        );
    }

    async refreshTokens(refreshToken, server, request) {
        const blacklistEntry = getTokenBlacklistEntry(refreshToken);
        if (blacklistEntry) {
            // Reuse detection: a token blacklisted by rotation and replayed AFTER the grace
            // window means a second party holds the rotated-out credential — revoke the whole
            // session family (every session shares sessionCreatedAt < invalidated_at), not
            // just this token. Within the window it is a concurrent browser refresh racing
            // itself; rejecting quietly is enough. (Audit F2.2)
            if (blacklistEntry.reason === 'token_rotation' && !blacklistEntry.within_grace) {
                const victimId = blacklistEntry.user_id ?? this.#decodeUserId(server, refreshToken);
                if (victimId != null) {
                    blacklistAllUserTokens(victimId, 'refresh_token_reuse', request);
                }
            }
            const err = new Error('Refresh token has been invalidated');
            err.statusCode = 401;
            throw err;
        }

        let decoded;
        try {
            decoded = server.jwt.verify(refreshToken);
        } catch (jwtError) {
            const err = new Error('Invalid or expired refresh token');
            err.statusCode = 401;
            throw err;
        }

        if (decoded.type !== 'refresh') {
            const err = new Error('Invalid token type');
            err.statusCode = 401;
            throw err;
        }

        if (isTokenInvalidatedByUser(decoded, decoded.id)) {
            const err = new Error('Session invalidated - Please login again');
            err.statusCode = 401;
            throw err;
        }

        if (isSessionExpired(decoded)) {
            const err = new Error('Session expired - Please login again');
            err.statusCode = 401;
            throw err;
        }

        const currentFingerprint = generateFingerprint(request);
        if (!validateFingerprint(decoded, currentFingerprint)) {
            blacklistToken(refreshToken, decoded.id, 'fingerprint_mismatch');

            logFingerprintMismatch({
                userId: decoded.id,
                username: decoded.username,
                expectedFingerprint: decoded.fingerprint,
                actualFingerprint: currentFingerprint
            }, request);

            const err = new Error('Session invalid - Please login again');
            err.statusCode = 401;
            throw err;
        }

        const user = queryOne(
            'SELECT id, username, role FROM users WHERE id = ?',
            [decoded.id]
        );

        if (!user) {
            const err = new Error('User not found');
            err.statusCode = 401;
            throw err;
        }

        const oldAccessToken = request.cookies.token;

        const { accessToken: newAccessToken, refreshToken: newRefreshToken } = rotateTokens(
            server,
            oldAccessToken,
            refreshToken,
            user,
            currentFingerprint,
            // Preserve the ORIGINAL login instant so the absolute-session cap is not reset by refresh.
            decoded.sessionCreatedAt,
        );

        logSessionRefreshed({
            userId: user.id,
            username: user.username
        }, request);

        return { newAccessToken, newRefreshToken };
    }

    // Last-resort user lookup for reuse detection when the blacklist row lost its user_id
    // (FOREIGN KEY ... ON DELETE SET NULL) — a still-verifiable token still names its owner.
    #decodeUserId(server, token) {
        try {
            return server.jwt.verify(token)?.id ?? null;
        } catch {
            return null;
        }
    }
}

export default new AuthService();
