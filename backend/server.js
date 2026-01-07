import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { config } from './config/config.js';

// Import security middleware (in order of execution)
import { securityHeadersMiddleware } from './middleware/securityHeaders.js';
import { rateLimiterMiddleware } from './middleware/rateLimiter.js';
import { apiKeyValidatorMiddleware } from './middleware/apiKeyValidator.js';
import { originValidatorMiddleware } from './middleware/originValidator.js';
import { csrfMiddleware } from './middleware/csrfProtection.js';
import { inputSanitizerMiddleware } from './middleware/inputSanitizer.js';
import { schemaErrorHandler } from './middleware/schemaValidators.js';

// Import services
import { startDailyCleanup, stopDailyCleanup, logSecurityEvent, SECURITY_EVENTS } from './services/securityAuditLogger.js';

// Import routes
import authRoutes from './routes/authRoutes.js';
import cameraRoutes from './routes/cameraRoutes.js';
import areaRoutes from './routes/areaRoutes.js';
import streamRoutes from './routes/streamRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import userRoutes from './routes/userRoutes.js';
import feedbackRoutes from './routes/feedbackRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import viewerRoutes from './routes/viewerRoutes.js';
import hlsProxyRoutes from './routes/hlsProxyRoutes.js';
import mediaMtxService from './services/mediaMtxService.js';
import streamWarmer from './services/streamWarmer.js';
import cameraHealthService from './services/cameraHealthService.js';
import viewerSessionService from './services/viewerSessionService.js';

const fastify = Fastify({
    logger: config.server.env === 'production' 
        ? { level: 'info' }  // Simple JSON logging in production
        : {
            level: 'debug',
            transport: {
                target: 'pino-pretty',
                options: {
                    translateTime: 'HH:mm:ss Z',
                    ignore: 'pid,hostname,reqId,res,responseTime',
                    messageFormat: '{req.method} {req.url} - {res.statusCode}'
                }
            }
        },
});

// ============================================
// SECURITY MIDDLEWARE CHAIN (ORDER MATTERS!)
// ============================================
// 1. Security Headers (first - applies to all responses)
// 2. Rate Limiter (early rejection of abusive requests)
// 3. API Key Validator (authenticate API clients)
// 4. Origin Validator (validate request origins)
// 5. CSRF Validator (protect state-changing requests)
// 6. Input Sanitizer (sanitize all inputs)
// 7. Auth Middleware (for protected routes - applied per route)
// ============================================

// Allowed origins for CORS
const allowedOrigins = config.security?.allowedOrigins || [
    'https://cctv.raf.my.id',
    'http://cctv.raf.my.id',
    'http://172.17.11.12',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:8080'
];

// Register CORS with logging for rejected origins
await fastify.register(cors, {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            // Log rejected origin
            logSecurityEvent(SECURITY_EVENTS.ORIGIN_VALIDATION_FAILURE, {
                reason: 'CORS origin rejected',
                origin,
                allowedOrigins
            });
            
            callback(new Error('Not allowed by CORS'), false);
        }
    },
    credentials: true,
});

// Register Cookie (required for CSRF and session management)
await fastify.register(cookie, {
    secret: config.jwt.secret,
    parseOptions: {},
});

// ============================================
// 1. SECURITY HEADERS MIDDLEWARE (FIRST)
// ============================================
// Adds security headers to all responses:
// - X-Content-Type-Options: nosniff
// - X-Frame-Options: DENY
// - X-XSS-Protection: 1; mode=block
// - Content-Security-Policy
// - Removes X-Powered-By and Server headers
// - Cache-Control: no-store for auth endpoints
// Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7
await fastify.register(securityHeadersMiddleware);

// ============================================
// 2. RATE LIMITER MIDDLEWARE
// ============================================
// Implements sliding window rate limiting:
// - 100 req/min for public endpoints
// - 30 req/min for auth endpoints
// - Whitelist for /health and /api/stream/*
// - Returns 429 with Retry-After header when exceeded
// Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
await fastify.register(rateLimiterMiddleware);

// ============================================
// 3. API KEY VALIDATOR MIDDLEWARE
// ============================================
// Validates X-API-Key header:
// - Rejects requests with missing/invalid keys (403)
// - Skips public endpoints (login, active cameras, streams)
// - Logs validation failures
// Requirements: 1.1, 1.2, 1.3
if (config.security?.apiKeyValidationEnabled !== false) {
    await fastify.register(apiKeyValidatorMiddleware);
}

// ============================================
// 4. ORIGIN VALIDATOR MIDDLEWARE
// ============================================
// Validates Origin and Referer headers:
// - Validates against allowed domains
// - Uses Referer as fallback for browser requests
// - Allows non-browser clients without Origin
// Requirements: 1.4, 1.5
await fastify.register(originValidatorMiddleware);

// ============================================
// 5. CSRF PROTECTION MIDDLEWARE
// ============================================
// Validates CSRF tokens for state-changing requests:
// - Applies to POST, PUT, DELETE, PATCH
// - Skips API key-only endpoints
// - Returns 403 for invalid/missing tokens
// Requirements: 1.6, 1.7
await fastify.register(csrfMiddleware);

// ============================================
// 6. INPUT SANITIZER MIDDLEWARE
// ============================================
// Sanitizes and validates all inputs:
// - XSS prevention (HTML entity encoding)
// - Content-Type validation
// - Request body size limit (1MB)
// - URL and query parameter sanitization
// Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7
await fastify.register(inputSanitizerMiddleware);

// ============================================
// JWT REGISTRATION
// ============================================
// Register JWT for token generation and verification
await fastify.register(jwt, {
    secret: config.jwt.secret,
    sign: {
        expiresIn: config.jwt.expiration,
    },
});

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================
// Whitelisted from rate limiting and API key validation
fastify.get('/health', async (request, reply) => {
    return { 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        security: {
            rateLimiting: true,
            apiKeyValidation: config.security?.apiKeyValidationEnabled !== false,
            csrfProtection: true,
            securityHeaders: true
        }
    };
});

// ============================================
// API ROUTES
// ============================================
// Auth middleware is applied per-route in route files
// using fingerprintAuthMiddleware for enhanced security
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(cameraRoutes, { prefix: '/api/cameras' });
await fastify.register(areaRoutes, { prefix: '/api/areas' });
await fastify.register(streamRoutes, { prefix: '/api/stream' });
await fastify.register(adminRoutes, { prefix: '/api/admin' });
await fastify.register(userRoutes, { prefix: '/api/users' });
await fastify.register(feedbackRoutes, { prefix: '/api/feedback' });
await fastify.register(settingsRoutes);
await fastify.register(viewerRoutes, { prefix: '/api/viewer' });
await fastify.register(hlsProxyRoutes, { prefix: '/hls' });

// ============================================
// GLOBAL ERROR HANDLER
// ============================================
// Handles schema validation errors and general errors
fastify.setErrorHandler((error, request, reply) => {
    // Handle schema validation errors
    if (error.validation) {
        return schemaErrorHandler(error, request, reply);
    }
    
    fastify.log.error(error);

    // Don't expose internal error details in production
    const message = config.server.env === 'production' 
        ? 'Internal Server Error' 
        : error.message || 'Internal Server Error';

    reply.code(error.statusCode || 500).send({
        success: false,
        message,
    });
});

// ============================================
// SERVER STARTUP
// ============================================
const start = async () => {
    try {
        await fastify.listen({
            port: config.server.port,
            host: config.server.host,
        });

        console.log('');
        console.log('🚀 RAF NET CCTV Backend Server Started');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📡 Server: http://${config.server.host}:${config.server.port}`);
        console.log(`🔧 Environment: ${config.server.env}`);
        console.log(`📊 Health Check: http://${config.server.host}:${config.server.port}/health`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('🔒 Security Middleware Chain:');
        console.log('  1. Security Headers ✓');
        console.log('  2. Rate Limiter ✓');
        console.log(`  3. API Key Validator ${config.security?.apiKeyValidationEnabled !== false ? '✓' : '○ (disabled)'}`);
        console.log('  4. Origin Validator ✓');
        console.log('  5. CSRF Protection ✓');
        console.log('  6. Input Sanitizer ✓');
        console.log('  7. Auth Middleware (per-route) ✓');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('API Endpoints:');
        console.log('  Public:');
        console.log('    GET    /health');
        console.log('    GET    /api/auth/csrf');
        console.log('    POST   /api/auth/login');
        console.log('    GET    /api/cameras/active');
        console.log('    GET    /api/stream');
        console.log('    GET    /api/stream/:cameraId');
        console.log('    POST   /api/viewer/start');
        console.log('    POST   /api/viewer/heartbeat');
        console.log('    POST   /api/viewer/stop');
        console.log('');
        console.log('  HLS Proxy (auto session tracking):');
        console.log('    GET    /hls/:cameraPath/index.m3u8');
        console.log('    GET    /hls/:cameraPath/:segment');
        console.log('');
        console.log('  Admin (requires JWT + CSRF):');
        console.log('    POST   /api/auth/logout');
        console.log('    POST   /api/auth/refresh');
        console.log('    GET    /api/auth/verify');
        console.log('    GET    /api/cameras');
        console.log('    POST   /api/cameras');
        console.log('    PUT    /api/cameras/:id');
        console.log('    DELETE /api/cameras/:id');
        console.log('');
        console.log('  API Key Management (admin only):');
        console.log('    GET    /api/admin/api-keys');
        console.log('    POST   /api/admin/api-keys');
        console.log('    DELETE /api/admin/api-keys/:id');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');

        // Initial sync with MediaMTX and start auto-sync
        await mediaMtxService.syncCameras();
        mediaMtxService.startAutoSync();
        
        // NOTE: StreamWarmer disabled to save bandwidth
        // Streams will start on-demand when viewers connect
        // This means first viewer may experience 2-3 second delay
        // Uncomment below to enable pre-warming (uses bandwidth even without viewers)
        /*
        const cameras = mediaMtxService.getDatabaseCameras();
        if (cameras.length > 0) {
            console.log(`[StreamWarmer] Pre-warming ${cameras.length} camera streams...`);
            await streamWarmer.warmAllCameras(cameras);
            console.log('[StreamWarmer] Streams pre-warmed for instant playback');
        }
        */
        console.log('[StreamWarmer] Disabled - streams will start on-demand to save bandwidth');
        
        // Start security audit log cleanup scheduler
        startDailyCleanup();
        console.log('[Security] Daily audit log cleanup scheduled (90-day retention)');
        
        // Start camera health check service (every 30 seconds)
        cameraHealthService.start(30000);
        console.log('[CameraHealth] Health check service started (30s interval)');
        
        // Start viewer session cleanup service
        viewerSessionService.startCleanup();
        console.log('[ViewerSession] Session cleanup service started (15s interval)');
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
const shutdown = async () => {
    console.log('\n[Server] Shutting down gracefully...');
    mediaMtxService.stopAutoSync();
    streamWarmer.stopAll();
    cameraHealthService.stop();
    viewerSessionService.stopCleanup();
    stopDailyCleanup();
    await fastify.close();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
