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
    isTokenBlacklisted,
    rotateTokens,
    validateFingerprint,
    isSessionExpired,
    isTokenInvalidatedByUser
} from './sessionManager.js';
import { checkPasswordExpiry, checkPasswordExpiryWarning } from './passwordExpiry.js';

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
            'SELECT id, username, password_hash, role FROM users WHERE username = ?',
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

        trackSuccessfulLogin(username, clientIp);

        const fingerprint = generateFingerprint(request);

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
            username,
            ip_address: clientIp,
            user_id: user.id,
            fingerprint: fingerprint.substring(0, 16) + '...'
        }, request);

        logSessionCreated({
            userId: user.id,
            username: username,
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
        if (isTokenBlacklisted(refreshToken)) {
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
            currentFingerprint
        );

        logSessionRefreshed({
            userId: user.id,
            username: user.username
        }, request);

        return { newAccessToken, newRefreshToken };
    }
}

export default new AuthService();
