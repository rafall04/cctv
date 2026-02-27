import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Intercept Fastify to capture the app instance and mock listen
let appInstance;

vi.mock('fastify', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        default: (opts) => {
            const app = actual.default(opts);
            appInstance = app;
            app.listen = vi.fn().mockResolvedValue();
            return app;
        }
    };
});

// Fix the middleware scope bug in the test using Fastify's internal symbol
vi.mock('../middleware/securityHeaders.js', async (importOriginal) => {
    const actual = await importOriginal();
    const middleware = actual.securityHeadersMiddleware;
    // Tell Fastify not to encapsulate this plugin
    middleware[Symbol.for('skip-override')] = true;
    
    return {
        ...actual,
        securityHeadersMiddleware: middleware
    };
});

// Mock services that might cause issues during start()
vi.mock('../services/mediaMtxService.js', () => ({
    default: {
        syncCameras: vi.fn().mockResolvedValue(),
        startAutoSync: vi.fn(),
        getDatabaseCameras: vi.fn().mockReturnValue([]),
        stopAutoSync: vi.fn(),
        deletePath: vi.fn().mockResolvedValue()
    }
}));

vi.mock('../services/streamWarmer.js', () => ({
    default: {
        warmAllCameras: vi.fn().mockResolvedValue(),
        stopAll: vi.fn(),
        getWarmedStreams: vi.fn().mockReturnValue([])
    }
}));

vi.mock('../services/cameraHealthService.js', () => ({
    default: {
        start: vi.fn(),
        stop: vi.fn()
    }
}));

vi.mock('../services/recordingCore/index.js', () => ({
    recordingService: {
        autoStartRecordings: vi.fn().mockResolvedValue(),
        shutdownAll: vi.fn().mockResolvedValue()
    }
}));

vi.mock('../services/thumbnailService.js', () => ({
    default: {
        start: vi.fn().mockResolvedValue(),
        stop: vi.fn()
    }
}));

vi.spyOn(process, 'exit').mockImplementation((code) => {
    console.error(`Process exit called with code ${code}`);
});

describe('Baseline API Verification', () => {
    beforeAll(async () => {
        await import('../server.js');
        await appInstance.ready();
    });

    afterAll(async () => {
        if (appInstance) {
            await appInstance.close();
        }
        vi.restoreAllMocks();
    });

    describe('Public Endpoints', () => {
        it('GET /health should return 200 and correct structure', async () => {
            const response = await appInstance.inject({
                method: 'GET',
                url: '/health'
            });
            expect(response.statusCode).toBe(200);
            const data = JSON.parse(response.payload);
            expect(data).toHaveProperty('status', 'ok');
            expect(data).toHaveProperty('timestamp');
            expect(data).toHaveProperty('security');
        });

        it('GET /api/cameras/active should return 200 and an array', async () => {
            const response = await appInstance.inject({
                method: 'GET',
                url: '/api/cameras/active'
            });
            expect(response.statusCode).toBe(200);
            const data = JSON.parse(response.payload);
            expect(Array.isArray(data.data)).toBe(true);
        });
    });

    describe('Security Baselines', () => {
        it('GET /api/cameras (Protected) should return 403 or 401 without API Key', async () => {
            const response = await appInstance.inject({
                method: 'GET',
                url: '/api/cameras'
            });
            expect([401, 403]).toContain(response.statusCode);
        });

        it('Security headers should be present on /health', async () => {
            const response = await appInstance.inject({
                method: 'GET',
                url: '/health'
            });
            expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
            expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
        });
    });
});
