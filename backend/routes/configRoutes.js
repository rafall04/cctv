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
        reply.header('Content-Type', 'application/xml');
        reply.header('Cache-Control', 'public, max-age=3600');
        return buildSitemapXml({ protocol: publicProto(request), hostname: request.hostname });
    });

    /**
     * GET /robots.txt — same allow/disallow rules as the old static file, but served by the
     * backend so the Sitemap line can name THIS deployment's domain instead of a placeholder.
     */
    fastify.get('/robots.txt', async (request, reply) => {
        reply.header('Content-Type', 'text/plain');
        reply.header('Cache-Control', 'public, max-age=3600');
        const origin = `${publicProto(request)}://${request.hostname}`;
        return [
            'User-agent: *',
            'Allow: /',
            'Disallow: /admin/',
            'Disallow: /api/',
            '',
            `Sitemap: ${origin}/sitemap.xml`,
            '',
        ].join('\n');
    });
}

// Cloudflare (or another TLS-terminating proxy) sends X-Forwarded-Proto; between nginx and
// the app the hop is plain HTTP, so trust the client-supplied header — never the socket.
// Default https: the public site only exists behind HTTPS.
function publicProto(request) {
    const proto = request.headers['x-forwarded-proto'];
    return proto === 'http' ? 'http' : 'https';
}
