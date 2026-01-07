/**
 * HLS Proxy Routes
 * Proxies HLS stream requests to MediaMTX while tracking viewer sessions
 * 
 * This allows tracking ALL viewers, whether they access via:
 * - Frontend website
 * - Direct URL access (VLC, browser, etc.)
 * - Any HLS-compatible player
 * 
 * Routes:
 * - GET /hls/:cameraPath/index.m3u8 - Main playlist (creates/updates session)
 * - GET /hls/:cameraPath/:segment - Video segments (updates session heartbeat)
 */

import axios from 'axios';
import { config } from '../config/config.js';
import viewerSessionService from '../services/viewerSessionService.js';

// Session cache to avoid creating duplicate sessions for same IP+camera
// Key: `${ip}_${cameraId}`, Value: { sessionId, lastAccess }
const sessionCache = new Map();

// Cleanup old cache entries every 60 seconds
const CACHE_CLEANUP_INTERVAL = 60000;
const SESSION_CACHE_TTL = 45000; // 45 seconds - slightly longer than heartbeat interval

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of sessionCache.entries()) {
        if (now - value.lastAccess > SESSION_CACHE_TTL) {
            sessionCache.delete(key);
        }
    }
}, CACHE_CLEANUP_INTERVAL);

/**
 * Extract real IP from request (handles proxy headers)
 */
function getRealIP(request) {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    
    const realIP = request.headers['x-real-ip'];
    if (realIP) {
        return realIP.trim();
    }
    
    return request.ip || request.socket?.remoteAddress || 'unknown';
}

/**
 * Extract camera ID from path (e.g., "camera1" -> 1)
 */
function extractCameraId(cameraPath) {
    const match = cameraPath.match(/camera(\d+)/);
    return match ? parseInt(match[1]) : null;
}

/**
 * Get or create session for this viewer
 */
function getOrCreateSession(ip, cameraId, request) {
    const cacheKey = `${ip}_${cameraId}`;
    const cached = sessionCache.get(cacheKey);
    
    if (cached) {
        // Update last access time
        cached.lastAccess = Date.now();
        
        // Send heartbeat to keep session alive (async, don't wait)
        try {
            viewerSessionService.heartbeat(cached.sessionId);
        } catch (e) {
            // Ignore heartbeat errors
        }
        
        return cached.sessionId;
    }
    
    // Create new session
    try {
        const sessionId = viewerSessionService.startSession(cameraId, request);
        
        sessionCache.set(cacheKey, {
            sessionId,
            lastAccess: Date.now()
        });
        
        console.log(`[HLSProxy] New session: ${sessionId} for camera${cameraId} from ${ip}`);
        return sessionId;
    } catch (error) {
        console.error('[HLSProxy] Error creating session:', error.message);
        return null;
    }
}

export default async function hlsProxyRoutes(fastify, _options) {
    // IMPORTANT: Use internal URL to MediaMTX, not public URL
    const mediamtxHlsUrl = config.mediamtx?.hlsUrlInternal || 'http://localhost:8888';
    
    /**
     * Handle CORS preflight for all HLS routes
     */
    fastify.options('/*', async (_request, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        reply.header('Access-Control-Allow-Headers', '*');
        return reply.code(204).send();
    });
    
    /**
     * Proxy ALL HLS requests to MediaMTX
     * Handles: index.m3u8, stream.m3u8, .ts, .mp4, .m4s files
     */
    fastify.get('/*', async (request, reply) => {
        // Get the full path after /hls/
        const fullPath = request.params['*'];
        
        if (!fullPath) {
            return reply.code(400).send({ error: 'Invalid path' });
        }
        
        // Extract camera path (first segment)
        const pathParts = fullPath.split('/');
        const cameraPath = pathParts[0];
        const fileName = pathParts[pathParts.length - 1];
        
        // Extract camera ID for session tracking
        const cameraId = extractCameraId(cameraPath);
        const ip = getRealIP(request);
        
        // Create/update session only for playlist requests (not segments)
        if (fileName.endsWith('.m3u8') && cameraId) {
            try {
                getOrCreateSession(ip, cameraId, request);
            } catch (e) {
                console.error('[HLSProxy] Session error:', e.message);
            }
        }
        
        // Update heartbeat for segment requests
        if (cameraId && !fileName.endsWith('.m3u8')) {
            try {
                const cacheKey = `${ip}_${cameraId}`;
                const cached = sessionCache.get(cacheKey);
                if (cached) {
                    cached.lastAccess = Date.now();
                    viewerSessionService.heartbeat(cached.sessionId);
                }
            } catch (e) {
                // Ignore heartbeat errors
            }
        }
        
        // Proxy request to MediaMTX
        try {
            const targetUrl = `${mediamtxHlsUrl}/${fullPath}`;
            const isTextFile = fileName.endsWith('.m3u8');
            
            const response = await axios.get(targetUrl, {
                headers: {
                    'User-Agent': request.headers['user-agent'] || 'HLSProxy',
                },
                timeout: 10000,
                responseType: isTextFile ? 'text' : 'arraybuffer',
                validateStatus: () => true
            });
            
            if (response.status !== 200) {
                return reply.code(response.status).send({ 
                    error: 'Resource not available',
                    status: response.status 
                });
            }
            
            // Determine content type based on extension
            let contentType = 'application/octet-stream';
            if (fileName.endsWith('.m3u8')) {
                contentType = 'application/vnd.apple.mpegurl';
            } else if (fileName.endsWith('.ts')) {
                contentType = 'video/mp2t';
            } else if (fileName.endsWith('.mp4') || fileName.endsWith('.m4s')) {
                contentType = 'video/mp4';
            }
            
            reply.header('Content-Type', contentType);
            // CORS headers - Nginx doesn't add them for /hls, so we add here
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');
            
            if (isTextFile) {
                return reply.send(response.data);
            } else {
                return reply.send(Buffer.from(response.data));
            }
        } catch (error) {
            console.error(`[HLSProxy] Error proxying ${fullPath}:`, error.message);
            return reply.code(502).send({ error: 'Failed to fetch resource' });
        }
    });
}
