/**
 * Configuration Routes
 *
 * Public endpoints for runtime configuration so the frontend can read config dynamically
 * without a rebuild. Thin — all business logic / DB access lives in appConfigService.
 */

import {
    getPublicRuntimeConfig,
    getVersionInfo,
    getManifest,
    buildManifestFromBranding,
    buildSitemapXml,
} from '../services/appConfigService.js';

export default async function configRoutes(fastify) {
    /**
     * GET /api/config/public — public configuration for the frontend (no auth).
     */
    fastify.get('/api/config/public', async (request) => {
        const protocol = request.headers['x-forwarded-proto'] ||
            (request.socket.encrypted ? 'https' : 'http');

        return getPublicRuntimeConfig({ protocol, hostname: request.hostname });
    });

    /**
     * GET /api/config/version — application version info (no auth).
     */
    fastify.get('/api/config/version', async () => getVersionInfo());

    /**
     * GET /api/config/manifest — dynamic PWA manifest from branding settings (no auth).
     */
    fastify.get('/api/config/manifest', async (request, reply) => {
        reply.header('Content-Type', 'application/manifest+json');
        reply.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

        try {
            return getManifest();
        } catch (error) {
            fastify.log.error('Error generating manifest:', error);
            return buildManifestFromBranding();
        }
    });

    /**
     * GET /sitemap.xml — static public pages + public area pages (no auth). Nginx proxies
     * it through like every other non-asset path, so it always reflects the live area list.
     */
    fastify.get('/sitemap.xml', async (request, reply) => {
        const protocol = request.headers['x-forwarded-proto'] ||
            (request.socket.encrypted ? 'https' : 'http');
        reply.header('Content-Type', 'application/xml');
        reply.header('Cache-Control', 'public, max-age=3600');
        return buildSitemapXml({ protocol, hostname: request.hostname });
    });
}
