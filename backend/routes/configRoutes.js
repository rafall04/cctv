/**
 * Configuration Routes
 * 
 * Public endpoint untuk runtime configuration
 * Allows frontend to get configuration dynamically without rebuild
 */

import { config } from '../config/config.js';
import { query } from '../database/connectionPool.js';

export function buildManifestFromBranding(branding = {}) {
    return {
        name: branding.meta_title || branding.company_name || 'CCTV System',
        short_name: branding.company_name || 'CCTV',
        description: branding.meta_description || 'Pantau CCTV secara online dan live streaming 24 jam',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: branding.primary_color || '#0ea5e9',
        orientation: 'any',
        icons: [
            {
                src: '/favicon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any maskable'
            },
            {
                src: '/favicon-192x192.png',
                sizes: '192x192',
                type: 'image/png'
            },
            {
                src: '/favicon-512x512.png',
                sizes: '512x512',
                type: 'image/png'
            }
        ],
        categories: ['security', 'utilities'],
        lang: 'id',
        dir: 'ltr'
    };
}

function loadBrandingSettings() {
    try {
        const settings = query(
            "SELECT key, value FROM settings WHERE key LIKE 'company_%' OR key LIKE 'meta_%' OR key = 'primary_color'"
        );

        return settings.reduce((acc, setting) => {
            acc[setting.key] = setting.value;
            return acc;
        }, {});
    } catch (error) {
        console.warn('[ConfigRoutes] Failed to load branding settings for manifest:', error.message);
        return {};
    }
}

export default async function configRoutes(fastify) {
    /**
     * GET /api/config/public
     * 
     * Returns public configuration for frontend
     * No authentication required
     * 
     * Response:
     * {
     *   apiUrl: string,
     *   frontendDomain: string,
     *   serverIp: string,
     *   portPublic: string,
     *   protocol: string,
     *   wsProtocol: string
     * }
     */
    fastify.get('/api/config/public', async (request, reply) => {
        // Detect protocol from request
        const protocol = request.headers['x-forwarded-proto'] ||
            (request.socket.encrypted ? 'https' : 'http');

        // Build API URL
        // In the Single-Port Nginx Architecture, we use relative paths for everything.
        const apiUrl = '/api';

        // WebSocket protocol
        const wsProtocol = protocol === 'https' ? 'wss' : 'ws';

        return {
            apiUrl,
            frontendDomain: config.security.frontendDomain || request.hostname,
            serverIp: config.security.serverIp || '',
            portPublic: process.env.PORT_PUBLIC || '800',
            protocol,
            wsProtocol,
            timestamp: new Date().toISOString(),
        };
    });

    /**
     * GET /api/config/version
     * 
     * Returns application version info
     * No authentication required
     */
    fastify.get('/api/config/version', async (request, reply) => {
        return {
            name: 'RAF NET CCTV',
            version: '1.0.0',
            environment: config.server.env,
            timestamp: new Date().toISOString(),
        };
    });

    /**
     * GET /api/config/manifest
     * 
     * Returns dynamic PWA manifest based on branding settings
     * No authentication required
     * 
     * Response: Web App Manifest JSON
     */
    fastify.get('/api/config/manifest', async (request, reply) => {
        try {
            const manifest = buildManifestFromBranding(loadBrandingSettings());

            reply.header('Content-Type', 'application/manifest+json');
            reply.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
            return manifest;
        } catch (error) {
            fastify.log.error('Error generating manifest:', error);
            reply.header('Content-Type', 'application/manifest+json');
            reply.header('Cache-Control', 'public, max-age=3600');
            return buildManifestFromBranding();
        }
    });
}
