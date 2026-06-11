import { logAuthorizationFailure } from '../services/securityAuditLogger.js';

export async function authMiddleware(request, reply) {
    // Mark that this route REQUIRES auth — customerAccessPolicy uses this flag to
    // deny-by-default the `customer` role on staff endpoints (public and
    // optional-auth routes never set it, so they stay untouched).
    request.authWasRequired = true;
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
        // Record the denial so it shows up on the Security Activity page.
        logAuthorizationFailure({
            reason: 'admin_role_required',
            requiredRole: 'admin',
            actualRole: request.user?.role || 'none',
            username: request.user?.username || null,
            endpoint: request.url,
        }, request);
        return reply.code(403).send({
            success: false,
            message: 'Forbidden - admin access required',
        });
    }
}

/**
 * Role guard for the customer portal API — allows `customer` and `admin`
 * (admins may inspect the portal on behalf of a customer). MUST be chained
 * AFTER authMiddleware. Staff `viewer` is intentionally excluded: the portal
 * scopes data by request.user.id, which has no meaning for non-owners.
 */
export async function requireCustomerOrAdmin(request, reply) {
    const role = request.user?.role;
    if (role !== 'customer' && role !== 'admin') {
        logAuthorizationFailure({
            reason: 'customer_role_required',
            requiredRole: 'customer',
            actualRole: role || 'none',
            username: request.user?.username || null,
            endpoint: request.url,
        }, request);
        return reply.code(403).send({
            success: false,
            message: 'Forbidden - customer access required',
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
