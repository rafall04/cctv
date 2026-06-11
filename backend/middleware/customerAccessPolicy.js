/**
 * Purpose: Deny-by-default lockout for the `customer` role — customers may only reach an
 *          explicit whitelist of auth-required endpoints, so every current AND future staff
 *          route is customer-proof without per-route sweeps.
 * Caller: backend/server.js (registered as a global plugin after route registration order
 *         does not matter — the hook runs in the preHandler phase, after route-level
 *         onRequest auth has populated request.user / request.authWasRequired).
 * Deps: securityAuditLogger.
 * MainFuncs: customerAccessPolicy (fastify plugin), isCustomerAllowedPath.
 * SideEffects: Rejects non-whitelisted authenticated customer requests with 403 + audit log.
 */

import { logAuthorizationFailure } from '../services/securityAuditLogger.js';

// Prefixes an authenticated customer may use on auth-REQUIRED routes. Public and
// optional-auth endpoints are unaffected (authWasRequired is never set there), so
// customers keep the same anonymous/public access as everyone else.
const CUSTOMER_ALLOWED_PREFIXES = [
    '/api/auth/',          // logout, refresh, verify, csrf
    '/api/users/profile',  // own profile read/update
    '/api/users/change-own-password',
    '/api/customer/',      // the customer portal API
];

export function isCustomerAllowedPath(url) {
    if (!url) {
        return false;
    }
    const path = url.split('?')[0];
    return CUSTOMER_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

// Plain hook function — added via fastify.addHook('preHandler', ...) at the ROOT
// scope in server.js. (A fastify plugin would be encapsulated and silently skip
// routes registered outside its scope, which is exactly the failure mode this
// policy exists to prevent.)
export async function customerAccessPolicyHook(request, reply) {
    if (!request.authWasRequired) {
        return;
    }
    if (request.user?.role !== 'customer') {
        return;
    }
    if (isCustomerAllowedPath(request.url)) {
        return;
    }

    logAuthorizationFailure({
        reason: 'customer_role_scope',
        requiredRole: 'staff',
        actualRole: 'customer',
        username: request.user?.username || null,
        endpoint: request.url,
    }, request);

    return reply.code(403).send({
        success: false,
        message: 'Forbidden - customer accounts cannot access this resource',
    });
}

export default customerAccessPolicyHook;
