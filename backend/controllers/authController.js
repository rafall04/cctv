/*
 * Purpose: Handle admin authentication, logout, refresh, and token verification responses.
 * Caller: authRoutes.js for /api/auth endpoints.
 * Deps: authService domain logic and authCookieOptions cookie policy helper.
 * MainFuncs: login, logout, refreshTokens, verifyToken.
 * SideEffects: Sets/clears HttpOnly auth cookies and writes auth/audit side effects through services.
 */

import authService from '../services/authService.js';
import totpAuthService from '../services/totpAuthService.js';
import billingPlanService from '../services/billingPlanService.js';
import telegramBotService from '../services/telegramBotService.js';
import { generateFingerprint } from '../services/sessionManager.js';
import { getAuthCookieOptions } from '../utils/authCookieOptions.js';

export async function login(request, reply) {
    try {
        const { username, password } = request.body;
        const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';

        if (!username || !password) {
            return reply.code(400).send({
                success: false,
                message: 'Username and password are required',
            });
        }

        const data = await authService.login(username, password, clientIp, request, request.server);

        // 2FA challenge — NO cookies/tokens are issued here; the client must exchange
        // pendingToken + code at /api/auth/totp/verify to get a real session.
        if (data.requiresTwoFactor) {
            return reply.send({
                success: true,
                data: { requiresTwoFactor: true, pendingToken: data.pendingToken },
            });
        }

        // Mandatory admin enrollment: no session, no cookies — the enroll token is the
        // only credential the setup/confirm endpoints accept.
        if (data.requiresTotpEnrollment) {
            return reply.send({
                success: true,
                data: { requiresTotpEnrollment: true, enrollToken: data.enrollToken },
            });
        }

        const cookieOptions = getAuthCookieOptions(request);
        reply.setCookie('token', data.accessToken, cookieOptions.access);
        reply.setCookie('refreshToken', data.refreshToken, cookieOptions.refresh);

        const responseData = {
            token: data.accessToken,
            refreshToken: data.refreshToken,
            user: data.user,
        };

        if (data.passwordExpiryStatus?.expired) {
            responseData.passwordExpired = true;
            responseData.passwordExpiryMessage = 'Your password has expired. Please change it immediately.';
        } else if (data.passwordExpiryWarning?.shouldWarn) {
            responseData.passwordExpiryWarning = data.passwordExpiryWarning;
        }

        return reply.send({
            success: true,
            message: 'Login successful',
            data: responseData,
        });
    } catch (error) {
        if (error.statusCode === 401) {
            return reply.code(401).send({ success: false, message: error.message });
        }
        // Approval gate (pending/rejected): surface the reason so the frontend can
        // show the real message instead of the generic CSRF/security 403 copy.
        if (error.statusCode === 403 && error.reason) {
            return reply.code(403).send({ success: false, message: error.message, reason: error.reason });
        }
        console.error('Login error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Second-factor exchange: { pendingToken, code } → session cookies + user, identical
 * shape to a successful password-only login so the frontend shares one code path.
 */
export async function verifyTotp(request, reply) {
    try {
        const { pendingToken, code } = request.body || {};
        if (!pendingToken || !code) {
            return reply.code(400).send({ success: false, message: 'pendingToken dan code wajib diisi' });
        }
        const data = await authService.completeTwoFactorLogin(request.server, pendingToken, code, request);
        const cookieOptions = getAuthCookieOptions(request);
        reply.setCookie('token', data.accessToken, cookieOptions.access);
        reply.setCookie('refreshToken', data.refreshToken, cookieOptions.refresh);
        // Mirror the password-only login tail — the 2FA path must surface the same
        // password-expiry signals or 2FA users would never see the warning.
        const responseData = { token: data.accessToken, refreshToken: data.refreshToken, user: data.user };
        if (data.passwordExpiryStatus?.expired) {
            responseData.passwordExpired = true;
            responseData.passwordExpiryMessage = 'Your password has expired. Please change it immediately.';
        } else if (data.passwordExpiryWarning?.shouldWarn) {
            responseData.passwordExpiryWarning = data.passwordExpiryWarning;
        }
        return reply.send({
            success: true,
            message: 'Login successful',
            data: responseData,
        });
    } catch (error) {
        const status = error.statusCode || 500;
        if (status < 500) {
            return reply.code(status).send({ success: false, message: error.message });
        }
        console.error('TOTP verify error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

/**
 * Required-admin enrollment: stage a TOTP seed behind the enroll-only token minted by
 * login. The token carries sub+fp — no session exists yet and none may exist until
 * enrollment completes.
 */
export async function enrollTotpSetup(request, reply) {
    try {
        const { enrollToken } = request.body || {};
        if (!enrollToken) {
            return reply.code(400).send({ success: false, message: 'enrollToken wajib diisi' });
        }
        const { user } = totpAuthService.verifyEnrollToken(request.server, {
            enrollToken,
            fingerprint: generateFingerprint(request),
        });
        const setup = await totpAuthService.startSetup(user.id, user.username, request);
        return reply.send({ success: true, data: setup });
    } catch (error) {
        const status = error.statusCode || 500;
        if (status < 500) {
            return reply.code(status).send({ success: false, message: error.message });
        }
        console.error('TOTP enroll setup error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

/**
 * Confirm the staged seed → enable 2FA → issue the real session in the same response.
 * Recovery codes ride along — this is the ONLY response that ever shows them.
 */
export async function enrollTotpConfirm(request, reply) {
    try {
        const { enrollToken, code } = request.body || {};
        if (!enrollToken || !code) {
            return reply.code(400).send({ success: false, message: 'enrollToken dan code wajib diisi' });
        }
        const data = await authService.completeTotpEnrollment(request.server, enrollToken, code, request);
        const cookieOptions = getAuthCookieOptions(request);
        reply.setCookie('token', data.accessToken, cookieOptions.access);
        reply.setCookie('refreshToken', data.refreshToken, cookieOptions.refresh);
        return reply.send({
            success: true,
            message: '2FA aktif — login berhasil',
            data: {
                token: data.accessToken,
                refreshToken: data.refreshToken,
                user: data.user,
                recoveryCodes: data.recoveryCodes,
            },
        });
    } catch (error) {
        const status = error.statusCode || 500;
        if (status < 500) {
            return reply.code(status).send({ success: false, message: error.message });
        }
        console.error('TOTP enroll confirm error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

/**
 * Public self-registration for the rental product (role customer only). The
 * frontend logs in afterwards via the normal /login flow, so lockout,
 * fingerprinting, and cookie policy stay in one code path.
 */
export async function register(request, reply) {
    try {
        const { username, password, phone, email } = request.body || {};
        const user = await billingPlanService.registerCustomer(
            { username, password, phone, email },
            request
        );
        // Fire-and-forget: push an approve/reject card to the admin Telegram chat(s)
        // so a new signup can be acted on from a phone. Never block (or fail) the
        // registration response on a Telegram round-trip.
        telegramBotService.notifyNewRegistration(user.id).catch(() => {});
        return reply.send({
            success: true,
            message: 'Pendaftaran berhasil — silakan login',
            data: { user },
        });
    } catch (error) {
        if (error.statusCode && error.statusCode < 500) {
            return reply.code(error.statusCode).send({
                success: false,
                message: error.message,
                errors: error.errors,
                requirements: error.requirements,
            });
        }
        console.error('Register error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

/** Public: tells the register page whether self-registration is open and what the default plan looks like. */
export async function registerInfo(request, reply) {
    try {
        const settings = billingPlanService.getRegistrationSettings();
        const plan = settings.default_plan;
        return reply.send({
            success: true,
            data: {
                enabled: settings.enabled,
                requires_approval: true,
                default_plan: plan ? {
                    key: plan.key,
                    name: plan.name,
                    description: plan.description,
                    price_per_camera: plan.price_per_camera,
                    max_cameras: plan.max_cameras,
                    is_trial: plan.is_trial === 1,
                    trial_days: plan.trial_days,
                } : null,
            },
        });
    } catch (error) {
        console.error('Register info error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function logout(request, reply) {
    try {
        const accessToken = request.token || request.cookies.token;
        const refreshToken = request.cookies.refreshToken;
        const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';

        await authService.logout(request.user.id, clientIp, accessToken, refreshToken);

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
        const refreshToken = request.cookies.refreshToken || request.body?.refreshToken;

        if (!refreshToken) {
            return reply.code(401).send({
                success: false,
                message: 'Refresh token required',
            });
        }

        const data = await authService.refreshTokens(refreshToken, request.server, request);

        const cookieOptions = getAuthCookieOptions(request);
        reply.setCookie('token', data.newAccessToken, cookieOptions.access);
        reply.setCookie('refreshToken', data.newRefreshToken, cookieOptions.refresh);

        return reply.send({
            success: true,
            message: 'Tokens refreshed successfully',
            data: {
                token: data.newAccessToken,
                refreshToken: data.newRefreshToken,
            },
        });
    } catch (error) {
        if (error.statusCode === 401) {
            return reply.code(401).send({ success: false, message: error.message });
        }
        console.error('Refresh token error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function verifyToken(request, reply) {
    try {
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
