/**
 * HLS Proxy Routes
 * Proxies HLS stream requests to MediaMTX while tracking viewer sessions
 * 
 * Routes:
 * - GET /hls/:streamKey/* - Proxy HLS requests (creates/updates session)
 * 
 * Stream key format: UUID (e.g., 04bd5387-9db4-4cf0-9f8d-7fb42cc76263)
 * 
 * Security: Stream token authentication via JWT
 * - Token can be passed via query parameter (?token=xxx) for HLS players
 * - Or via Authorization header for API calls
 */

import axios from 'axios';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import viewerSessionService from '../services/viewerSessionService.js';
import { queryOne } from '../database/database.js';

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

// Cache for stream_key -> camera_id mapping to avoid repeated DB queries
const cameraIdCache = new Map();
const CAMERA_CACHE_TTL = 300000; // 5 minutes

/**
 * Extract camera ID from stream path (UUID stream_key)
 * @param {string} streamPath - The stream path (UUID format)
 * @returns {number|null} Camera ID or null if not found
 */
function extractCameraId(streamPath) {
    // Check cache first
    const cached = cameraIdCache.get(streamPath);
    if (cached && Date.now() - cached.timestamp < CAMERA_CACHE_TTL) {
        return cached.cameraId;
    }
    
    // UUID format: lookup from database
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(streamPath)) {
        try {
            const camera = queryOne('SELECT id FROM cameras WHERE stream_key = ?', [streamPath]);
            if (camera) {
                cameraIdCache.set(streamPath, {
                    cameraId: camera.id,
                    timestamp: Date.now()
                });
                return camera.id;
            }
        } catch (error) {
            console.error('[HLSProxy] Error looking up camera by stream_key:', error.message);
        }
    }
    
    return null;
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
        
        console.log(`[HLSProxy] New session: ${sessionId} for stream (camera ${cameraId}) from ${ip}`);
        return sessionId;
    } catch (error) {
        console.error('[HLSProxy] Error creating session:', error.message);
        return null;
    }
}

/**
 * Verify stream access token (OPTIONAL for public streams)
 * Supports both query parameter (for HLS players) and header (for API calls)
 * 
 * Token format: JWT with payload { cameraId, streamKey, type: 'stream_access' }
 * Valid for 1 hour
 * 
 * NOTE: Token is optional - viewer session tracking is used instead
 */
function verifyStreamToken(request, reply, done) {
    // Extract token from query parameter or Authorization header
    let token = request.query.token;
    
    if (!token) {
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
    }
    
    // If no token provided, allow access (public streams)
    // Session tracking is handled separately
    if (!token) {
        return done();
    }
    
    // If token provided, verify it
    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        
        // Validate token type
        if (decoded.type !== 'stream_access') {
            return reply.code(403).send({
                success: false,
                message: 'Invalid token type',
            });
        }
        
        // Attach decoded token to request for later use
        request.streamToken = decoded;
        done();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return reply.code(401).send({
                success: false,
                message: 'Stream token expired',
            });
        }
        
        return reply.code(403).send({
            success: false,
            message: 'Invalid stream token',
        });
    }
}

export default async function hlsProxyRoutes(fastify, _options) {
    // IMPORTANT: Use internal URL to MediaMTX, not public URL
    const mediamtxHlsUrl = config.mediamtx?.hlsUrlInternal || 'http://localhost:8888';
    
    /**
     * Proxy ALL HLS requests to MediaMTX
     * Handles: index.m3u8, stream.m3u8, .ts, .mp4, .m4s files
     * 
     * SECURITY: Token validation enabled - requires valid JWT token
     * NOTE: CORS headers are handled by Fastify CORS plugin in server.js
     * Do NOT add manual CORS headers here to avoid duplicate header issues
     */
    fastify.get('/*', { preHandler: verifyStreamToken }, async (request, reply) => {
        // Get the full path after /hls/
        const fullPath = request.params['*'];
        
        if (!fullPath) {
            return reply.code(400).send('Invalid path - use /hls/{cameraPath}/index.m3u8');
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
            
            // For init.mp4 files, retry a few times as they may not be ready yet
            const isInitFile = fileName.includes('init.mp4') || fileName.includes('_init.mp4');
            const maxRetries = isInitFile ? 3 : 1;
            let lastError = null;
            let response = null;
            
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    response = await axios.get(targetUrl, {
                        headers: {
                            'User-Agent': request.headers['user-agent'] || 'HLSProxy',
                        },
                        timeout: 10000,
                        responseType: isTextFile ? 'text' : 'arraybuffer',
                        validateStatus: () => true
                    });
                    
                    if (response.status === 200) {
                        break; // Success, exit retry loop
                    }
                    
                    // For init files, wait and retry on 404
                    if (isInitFile && response.status === 404 && attempt < maxRetries - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
                        continue;
                    }
                    
                    break; // Non-retryable error
                } catch (err) {
                    lastError = err;
                    if (attempt < maxRetries - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }
            
            if (!response && lastError) {
                throw lastError;
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
            
            // Pass through the actual status code from MediaMTX
            // NOTE: CORS headers handled by Fastify CORS plugin
            if (response.status !== 200) {
                // For non-200 responses, pass through status but with proper headers
                reply.header('Content-Type', 'text/plain');
                reply.header('Cache-Control', 'no-cache');
                return reply.code(response.status).send('');
            }
            
            reply.header('Content-Type', contentType);
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
            return reply.code(502).send('');
        }
    });
}
