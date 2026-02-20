import { config } from '../config/config.js';
import authService from '../services/authService.js';

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

        const isHttps = request.headers['x-forwarded-proto'] === 'https' ||
            request.protocol === 'https' ||
            request.headers.host?.includes(config.security.backendDomain);

        reply.setCookie('token', data.accessToken, {
            path: '/',
            httpOnly: true,
            secure: isHttps,
            sameSite: isHttps ? 'none' : 'lax',
            maxAge: 60 * 60,
        });

        reply.setCookie('refreshToken', data.refreshToken, {
            path: '/api/auth/refresh',
            httpOnly: true,
            secure: isHttps,
            sameSite: isHttps ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60,
        });

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
        console.error('Login error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
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

        const isHttps = request.headers['x-forwarded-proto'] === 'https' ||
            request.protocol === 'https' ||
            request.headers.host?.includes(config.security.backendDomain);

        reply.setCookie('token', data.newAccessToken, {
            path: '/',
            httpOnly: true,
            secure: isHttps,
            sameSite: isHttps ? 'none' : 'lax',
            maxAge: 60 * 60,
        });

        reply.setCookie('refreshToken', data.newRefreshToken, {
            path: '/api/auth/refresh',
            httpOnly: true,
            secure: isHttps,
            sameSite: isHttps ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60,
        });

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
