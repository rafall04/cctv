import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { config } from './config/config.js';

// Import routes
import authRoutes from './routes/authRoutes.js';
import cameraRoutes from './routes/cameraRoutes.js';
import areaRoutes from './routes/areaRoutes.js';
import streamRoutes from './routes/streamRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

const mediaMtxService = require('./services/mediaMtxService');

const fastify = Fastify({
    logger: config.server.env === 'production' ? true : {
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

// Register CORS
await fastify.register(cors, {
    origin: [
        'https://cctv.raf.my.id',
        'http://cctv.raf.my.id',
        'http://172.17.11.12',
        'http://localhost:5173',
        'http://localhost:8080'
    ],
    credentials: true,
});

// Register Cookie
await fastify.register(cookie, {
    secret: config.jwt.secret,
    parseOptions: {},
});

// Register JWT
await fastify.register(jwt, {
    secret: config.jwt.secret,
    sign: {
        expiresIn: config.jwt.expiration,
    },
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register API routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(cameraRoutes, { prefix: '/api/cameras' });
await fastify.register(areaRoutes, { prefix: '/api/areas' });
await fastify.register(streamRoutes, { prefix: '/api/stream' });
await fastify.register(adminRoutes, { prefix: '/api/admin' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);

    reply.code(error.statusCode || 500).send({
        success: false,
        message: error.message || 'Internal Server Error',
    });
});

// Start server
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
        console.log('API Endpoints:');
        console.log('  Public:');
        console.log('    POST   /api/auth/login');
        console.log('    GET    /api/cameras/active');
        console.log('    GET    /api/stream');
        console.log('    GET    /api/stream/:cameraId');
        console.log('');
        console.log('  Admin (requires JWT):');
        console.log('    POST   /api/auth/logout');
        console.log('    GET    /api/auth/verify');
        console.log('    GET    /api/cameras');
        console.log('    GET    /api/cameras/:id');
        console.log('    POST   /api/cameras');
        console.log('    PUT    /api/cameras/:id');
        console.log('    DELETE /api/cameras/:id');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');

        // Initial sync with MediaMTX
        mediaMtxService.syncCameras();
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
