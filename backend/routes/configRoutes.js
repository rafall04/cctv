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
}
