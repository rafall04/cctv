/*
 * Purpose: Derive auth cookie options consistently for domain and direct-IP access.
 * Caller: authController login and refresh handlers.
 * Deps: Fastify request headers/protocol.
 * MainFuncs: isHttpsRequest, getAuthCookieOptions.
 * SideEffects: None.
 */

export function isHttpsRequest(request) {
    return request.headers?.['x-forwarded-proto'] === 'https'
        || request.protocol === 'https'
        || request.socket?.encrypted === true;
}

export function getAuthCookieOptions(request) {
    const isHttps = isHttpsRequest(request);
    const shared = {
        httpOnly: true,
        secure: isHttps,
        sameSite: isHttps ? 'none' : 'lax',
    };

    return {
        access: {
            ...shared,
            path: '/',
            maxAge: 60 * 60,
        },
        refresh: {
            ...shared,
            path: '/api/auth/refresh',
            maxAge: 7 * 24 * 60 * 60,
        },
    };
}
