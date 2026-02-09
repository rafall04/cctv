/**
 * Configuration Routes
 * 
 * Public endpoint untuk runtime configuration
 * Allows frontend to get configuration dynamically without rebuild
 */

import { config } from '../config/config.js';

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
        let apiUrl;
        if (config.security.backendDomain) {
            // Use configured backend domain
            apiUrl = `${protocol}://${config.security.backendDomain}`;
            
            // Add port if non-standard
            const portPublic = process.env.PORT_PUBLIC;
            if (portPublic && portPublic !== '80' && portPublic !== '443') {
                apiUrl += `:${portPublic}`;
            }
        } else {
            // Fallback to request hostname
            apiUrl = `${protocol}://${request.hostname}`;
            if (config.server.port !== 80 && config.server.port !== 443) {
                apiUrl += `:${config.server.port}`;
            }
        }
        
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
            // Get branding settings
            const db = fastify.db;
            const settings = db.prepare('SELECT key, value FROM settings WHERE key LIKE "company_%" OR key LIKE "meta_%"').all();
            
            const branding = {};
            settings.forEach(setting => {
                branding[setting.key] = setting.value;
            });
            
            // Build manifest
            const manifest = {
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
            
            reply.header('Content-Type', 'application/manifest+json');
            reply.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
            return manifest;
        } catch (error) {
            fastify.log.error('Error generating manifest:', error);
            reply.code(500).send({ error: 'Failed to generate manifest' });
        }
    });
}
