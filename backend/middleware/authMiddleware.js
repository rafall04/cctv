export async function authMiddleware(request, reply) {
    try {
        // Try to verify from header first
        await request.jwtVerify();
    } catch (error) {
        // If header verification fails, try cookie
        const token = request.cookies.token;

        if (!token) {
            return reply.code(401).send({
                success: false,
                message: 'Unauthorized - No token provided',
            });
        }

        try {
            const decoded = request.server.jwt.verify(token);
            request.user = decoded;
        } catch (cookieError) {
            return reply.code(401).send({
                success: false,
                message: 'Unauthorized - Invalid or expired token',
            });
        }
    }
}

/**
 * Role guard — requires the authenticated user to have the `admin` role.
 * MUST be chained AFTER authMiddleware (it relies on request.user being set),
 * e.g. `onRequest: [authMiddleware, requireAdmin]`. A non-admin (e.g. `viewer`)
 * authenticated user is rejected with 403 so the role is actually enforced.
 */
export async function requireAdmin(request, reply) {
    if (request.user?.role !== 'admin') {
        return reply.code(403).send({
            success: false,
            message: 'Forbidden - admin access required',
        });
    }
}

export async function optionalAuthMiddleware(request, reply) {
    try {
        await request.jwtVerify();
        return;
    } catch {
        // Fall back to cookie-based auth if available
    }

    const token = request.cookies.token;
    if (!token) {
        return;
    }

    try {
        const decoded = request.server.jwt.verify(token);
        request.user = decoded;
    } catch {
        // Treat invalid public playback auth as anonymous instead of failing request
    }
}

export default authMiddleware;
