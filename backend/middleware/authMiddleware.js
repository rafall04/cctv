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
