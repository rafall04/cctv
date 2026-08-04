/*
 * Purpose: Admin routes for the runtime security policy under /api/admin/settings (requireAdmin),
 *          so rate limits, brute-force thresholds, password rules and session lifetimes are set
 *          from the panel instead of by SSH-ing in to edit backend/.env.
 * Caller: server.js route registration.
 * Deps: authMiddleware, securitySettingsService, securityAuditLogger.
 * MainFuncs: GET /security (effective values + where each came from), PUT /security (save).
 * SideEffects: Writes the `security_settings` row and logs an admin audit entry.
 */

import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import securitySettings, { SECURITY_DEFAULTS } from '../services/securitySettingsService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

export default async function securitySettingsRoutes(fastify) {
    fastify.addHook('preHandler', authMiddleware);
    fastify.addHook('preHandler', requireAdmin);

    fastify.get('/security', async (request, reply) => reply.send({
        success: true,
        data: {
            settings: securitySettings.getSecuritySettings({ fresh: true }),
            // Tells the panel which values are still being supplied by .env rather than by
            // anything an admin saved — otherwise a field looks "set" when it is only inherited.
            sources: securitySettings.getSecuritySettingsSources(),
            defaults: SECURITY_DEFAULTS,
        },
    }));

    fastify.put('/security', async (request, reply) => {
        try {
            const before = securitySettings.getSecuritySettings({ fresh: true });
            const after = securitySettings.updateSecuritySettings(request.body || {});

            // Log WHICH policy moved and to what: every field here widens or narrows who can get
            // in, so an unexplained change must be answerable months later.
            const changed = Object.keys(after)
                .filter((key) => before[key] !== after[key])
                .reduce((acc, key) => ({ ...acc, [key]: { from: before[key], to: after[key] } }), {});

            logAdminAction({
                action: 'security_settings_updated',
                details: { changed },
                userId: request.user?.id,
            }, request);

            return reply.send({
                success: true,
                message: 'Pengaturan keamanan disimpan',
                data: { settings: after, sources: securitySettings.getSecuritySettingsSources() },
            });
        } catch (error) {
            const code = error.statusCode || 500;
            if (code === 500) console.error('Update security settings error:', error);
            return reply.code(code).send({
                success: false,
                message: code === 500 ? 'Gagal menyimpan pengaturan keamanan' : error.message,
                errors: error.errors,
            });
        }
    });
}
