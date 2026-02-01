import bcrypt from 'bcrypt';
import { queryOne, execute } from '../database/database.js';
import { config } from '../config/config.js';
import {
    checkLockout,
    trackFailedAttempt,
    trackSuccessfulLogin,
    checkAndTriggerLockout,
    getCurrentAttemptCount,
    applyProgressiveDelay
} from '../services/bruteForceProtection.js';
import { logAuthAttempt, logSessionCreated, logSessionRefreshed, logFingerprintMismatch } from '../services/securityAuditLogger.js';
import {
    generateFingerprint,
    createTokenPair,
    blacklistToken,
    isTokenBlacklisted,
    rotateTokens,
    validateFingerprint,
    isSessionExpired,
    isTokenInvalidatedByUser
} from '../services/sessionManager.js';
import { checkPasswordExpiry, checkPasswordExpiryWarning } from '../services/passwordExpiry.js';

export async function login(request, reply) {
    try {
        const { username, password } = request.body;
        const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';

        // Validate input
        if (!username || !password) {
            return reply.code(400).send({
                success: false,
                message: 'Username and password are required',
            });
        }

        // Check lockout status BEFORE password verification
        const lockoutStatus = checkLockout(username, clientIp);
        if (lockoutStatus.locked) {
            // Log the blocked attempt
            logAuthAttempt(false, {
                username,
                ip_address: clientIp,
                reason: 'Account locked',
                lockType: lockoutStatus.lockType
            }, request);
            
            // Return generic message (don't reveal lockout status per Requirement 3.5)
            return reply.code(401).send({
                success: false,
                message: 'Invalid credentials',
            });
        }

        // Get current attempt count for progressive delay
        const attemptCount = getCurrentAttemptCount(username, clientIp);

        // Find user
        const user = queryOne(
            'SELECT id, username, password_hash, role FROM users WHERE username = ?',
            [username]
        );

        if (!user) {
            // Track failed attempt
            trackFailedAttempt(username, clientIp);
            checkAndTriggerLockout(username, clientIp, request);
            
            // Log failed attempt
            logAuthAttempt(false, {
                username,
                ip_address: clientIp,
                reason: 'User not found'
            }, request);
            
            // Apply progressive delay before responding
            await applyProgressiveDelay(attemptCount + 1);
            
            return reply.code(401).send({
                success: false,
                message: 'Invalid credentials',
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            // Track failed attempt
            trackFailedAttempt(username, clientIp);
            checkAndTriggerLockout(username, clientIp, request);
            
            // Log failed attempt
            logAuthAttempt(false, {
                username,
                ip_address: clientIp,
                reason: 'Invalid password'
            }, request);
            
            // Apply progressive delay before responding
            await applyProgressiveDelay(attemptCount + 1);
            
            return reply.code(401).send({
                success: false,
                message: 'Invalid credentials',
            });
        }

        // Successful login - reset counters
        trackSuccessfulLogin(username, clientIp);

        // Generate fingerprint for token binding
        const fingerprint = generateFingerprint(request);

        // Generate token pair with fingerprint binding
        const { accessToken, refreshToken, sessionCreatedAt } = createTokenPair(
            request.server,
            user,
            fingerprint
        );

        // Log successful login
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'LOGIN', 'User logged in successfully', request.ip]
        );
        
        // Log to security audit
        logAuthAttempt(true, {
            username,
            ip_address: clientIp,
            user_id: user.id,
            fingerprint: fingerprint.substring(0, 16) + '...'
        }, request);

        // Log session creation
        logSessionCreated({
            userId: user.id,
            username: username,
            fingerprint: fingerprint
        }, request);

        // Update user's last login info
        execute(
            'UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?',
            [new Date().toISOString(), clientIp, user.id]
        );

        // Set access token cookie
        // Detect if request is from HTTPS (domain) or HTTP (IP)
        const isHttps = request.headers['x-forwarded-proto'] === 'https' || 
                        request.protocol === 'https' ||
                        request.headers.host?.includes(config.security.backendDomain);
        
        // For HTTPS (domain): use secure + sameSite=none for cross-domain
        // For HTTP (IP): use non-secure + sameSite=lax
        reply.setCookie('token', accessToken, {
            path: '/',
            httpOnly: true,
            secure: isHttps,
            sameSite: isHttps ? 'none' : 'lax',
            maxAge: 60 * 60, // 1 hour (matches access token expiry)
        });

        // Set refresh token cookie
        reply.setCookie('refreshToken', refreshToken, {
            path: '/api/auth/refresh',
            httpOnly: true,
            secure: isHttps,
            sameSite: isHttps ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        // Check password expiry status (Requirement 6.6)
        const passwordExpiryStatus = checkPasswordExpiry(user.id);
        const passwordExpiryWarning = checkPasswordExpiryWarning(user.id);

        // Build response
        const responseData = {
            token: accessToken,
            refreshToken: refreshToken,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
            },
        };

        // Add password expiry warning if applicable
        if (passwordExpiryStatus.expired) {
            responseData.passwordExpired = true;
            responseData.passwordExpiryMessage = 'Your password has expired. Please change it immediately.';
        } else if (passwordExpiryWarning.shouldWarn) {
            responseData.passwordExpiryWarning = passwordExpiryWarning;
        }

        return reply.send({
            success: true,
            message: 'Login successful',
            data: responseData,
        });
    } catch (error) {
        console.error('Login error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}


export async function logout(request, reply) {
    try {
        // Get tokens to blacklist
        const accessToken = request.token || request.cookies.token;
        const refreshToken = request.cookies.refreshToken;

        // Blacklist access token
        if (accessToken) {
            blacklistToken(accessToken, request.user.id, 'logout');
        }

        // Blacklist refresh token
        if (refreshToken) {
            blacklistToken(refreshToken, request.user.id, 'logout');
        }

        // Log logout action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'LOGOUT', 'User logged out', request.ip]
        );

        // Clear cookies
        reply.clearCookie('token', { path: '/' });
        reply.clearCookie('refreshToken', { path: '/api/auth/refresh' });

        return reply.send({
            success: true,
            message: 'Logout successful',
        });
    } catch (error) {
        console.error('Logout error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function refreshTokens(request, reply) {
    try {
        // Get refresh token from cookie or body
        const refreshToken = request.cookies.refreshToken || request.body?.refreshToken;

        if (!refreshToken) {
            return reply.code(401).send({
                success: false,
                message: 'Refresh token required',
            });
        }

        // Check if refresh token is blacklisted
        if (isTokenBlacklisted(refreshToken)) {
            return reply.code(401).send({
                success: false,
                message: 'Refresh token has been invalidated',
            });
        }

        // Verify refresh token
        let decoded;
        try {
            decoded = request.server.jwt.verify(refreshToken);
        } catch (jwtError) {
            return reply.code(401).send({
                success: false,
                message: 'Invalid or expired refresh token',
            });
        }

        // Check token type
        if (decoded.type !== 'refresh') {
            return reply.code(401).send({
                success: false,
                message: 'Invalid token type',
            });
        }

        // Check if token was invalidated by user (e.g., password change)
        if (isTokenInvalidatedByUser(decoded, decoded.id)) {
            return reply.code(401).send({
                success: false,
                message: 'Session invalidated - Please login again',
            });
        }

        // Check absolute session timeout
        if (isSessionExpired(decoded)) {
            return reply.code(401).send({
                success: false,
                message: 'Session expired - Please login again',
            });
        }

        // Validate fingerprint
        const currentFingerprint = generateFingerprint(request);
        if (!validateFingerprint(decoded, currentFingerprint)) {
            // Blacklist the refresh token on fingerprint mismatch
            blacklistToken(refreshToken, decoded.id, 'fingerprint_mismatch');
            
            // Log fingerprint mismatch
            logFingerprintMismatch({
                userId: decoded.id,
                username: decoded.username,
                expectedFingerprint: decoded.fingerprint,
                actualFingerprint: currentFingerprint
            }, request);
            
            return reply.code(401).send({
                success: false,
                message: 'Session invalid - Please login again',
            });
        }

        // Get user data
        const user = queryOne(
            'SELECT id, username, role FROM users WHERE id = ?',
            [decoded.id]
        );

        if (!user) {
            return reply.code(401).send({
                success: false,
                message: 'User not found',
            });
        }

        // Get old access token if available
        const oldAccessToken = request.cookies.token;

        // Rotate tokens - blacklist old ones and create new pair
        const { accessToken: newAccessToken, refreshToken: newRefreshToken } = rotateTokens(
            request.server,
            oldAccessToken,
            refreshToken,
            user,
            currentFingerprint
        );

        // Log session refresh
        logSessionRefreshed({
            userId: user.id,
            username: user.username
        }, request);

        // Set new access token cookie
        // Detect if request is from IP (HTTP) or domain (HTTPS)
        const isHttps = request.headers['x-forwarded-proto'] === 'https' || 
                        request.protocol === 'https' ||
                        request.headers.host?.includes(config.security.backendDomain);
        
        reply.setCookie('token', newAccessToken, {
            path: '/',
            httpOnly: true,
            secure: isHttps,
            sameSite: isHttps ? 'none' : 'lax',
            maxAge: 60 * 60, // 1 hour
        });

        // Set new refresh token cookie
        reply.setCookie('refreshToken', newRefreshToken, {
            path: '/api/auth/refresh',
            httpOnly: true,
            secure: isHttps,
            sameSite: isHttps ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        return reply.send({
            success: true,
            message: 'Tokens refreshed successfully',
            data: {
                token: newAccessToken,
                refreshToken: newRefreshToken,
            },
        });
    } catch (error) {
        console.error('Refresh token error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function verifyToken(request, reply) {
    try {
        // Token already verified by middleware
        return reply.send({
            success: true,
            data: {
                user: {
                    id: request.user.id,
                    username: request.user.username,
                    role: request.user.role,
                },
            },
        });
    } catch (error) {
        console.error('Verify token error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
