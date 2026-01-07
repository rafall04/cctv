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
     * Proxy HLS playlist request (index.m3u8)
     * This is the main entry point - creates/updates session
     */
    fastify.get('/:cameraPath/index.m3u8', async (request, reply) => {
        const { cameraPath } = request.params;
        const cameraId = extractCameraId(cameraPath);
        
        if (!cameraId) {
            return reply.code(400).send({ error: 'Invalid camera path' });
        }
        
        const ip = getRealIP(request);
        
        // Create or update session (don't block on errors)
        try {
            getOrCreateSession(ip, cameraId, request);
        } catch (e) {
            console.error('[HLSProxy] Session error:', e.message);
        }
        
        // Proxy request to MediaMTX
        try {
            const response = await axios.get(`${mediamtxHlsUrl}/${cameraPath}/index.m3u8`, {
                headers: {
                    'User-Agent': request.headers['user-agent'] || 'HLSProxy',
                },
                timeout: 10000,
                responseType: 'text',
                validateStatus: () => true // Don't throw on non-2xx
            });
            
            if (response.status !== 200) {
                return reply.code(response.status).send({ 
                    error: 'Stream not available',
                    status: response.status 
                });
            }
            
            // Set appropriate headers
            reply.header('Content-Type', 'application/vnd.apple.mpegurl');
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            
            return reply.send(response.data);
        } catch (error) {
            console.error(`[HLSProxy] Error proxying playlist for ${cameraPath}:`, error.message);
            return reply.code(502).send({ error: 'Failed to fetch stream' });
        }
    });
    
    /**
     * Proxy HLS segment requests (.ts files)
     * Updates session heartbeat
     */
    fastify.get('/:cameraPath/:segment', async (request, reply) => {
        const { cameraPath, segment } = request.params;
        
        // Only process .ts and .m3u8 files
        if (!segment.endsWith('.ts') && !segment.endsWith('.m3u8')) {
            return reply.code(404).send({ error: 'Not found' });
        }
        
        const cameraId = extractCameraId(cameraPath);
        const ip = getRealIP(request);
        
        // Update session heartbeat for segment requests (don't block)
        if (cameraId) {
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
            const response = await axios.get(`${mediamtxHlsUrl}/${cameraPath}/${segment}`, {
                headers: {
                    'User-Agent': request.headers['user-agent'] || 'HLSProxy',
                },
                timeout: 10000,
                responseType: 'arraybuffer',
                validateStatus: () => true
            });
            
            if (response.status !== 200) {
                return reply.code(response.status).send({ error: 'Segment not available' });
            }
            
            // Determine content type
            const contentType = segment.endsWith('.ts') 
                ? 'video/mp2t' 
                : 'application/vnd.apple.mpegurl';
            
            reply.header('Content-Type', contentType);
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Cache-Control', 'no-cache');
            
            return reply.send(Buffer.from(response.data));
        } catch (error) {
            console.error(`[HLSProxy] Error proxying segment ${segment}:`, error.message);
            return reply.code(502).send({ error: 'Failed to fetch segment' });
        }
    });
    
    /**
     * Handle CORS preflight
     */
    fastify.options('/:cameraPath/*', async (_request, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type');
        return reply.code(204).send();
    });
}
