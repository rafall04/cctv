/**
 * Purpose: Pin the public telemetry route's edge contract — strict schema in, identical 202 out.
 * Caller: backend test gate.
 * Deps: Fastify injection; playbackTelemetryService mocked.
 * MainFuncs: POST /api/public/playback-telemetry.
 * SideEffects: None.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }));

vi.mock('../services/playbackTelemetryService.js', () => ({ default: { record: recordMock, getSummary: vi.fn() } }));

const buildApp = async () => {
    const { default: routes } = await import('../routes/publicPlaybackTelemetryRoutes.js');
    const app = Fastify();
    await app.register(routes, { prefix: '/api/public/playback-telemetry' });
    return app;
};

describe('POST /api/public/playback-telemetry', () => {
    beforeEach(() => recordMock.mockClear());

    it('accepts a well-formed report and answers 202 without revealing anything', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'POST',
            url: '/api/public/playback-telemetry',
            payload: { stage: 'source_load', errorCode: 'codec', cameraId: 1443, scope: 'public_preview', segment: 'x.mp4' },
        });
        expect(res.statusCode).toBe(202);
        // Identical body for every report — a private/nonexistent cameraId must look the same.
        expect(res.payload).toBe('{"success":true}');
        expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ cameraId: 1443 }));
    });

    it('rejects a body without stage, and STRIPS extra fields instead of storing them', async () => {
        const app = await buildApp();
        const noStage = await app.inject({ method: 'POST', url: '/api/public/playback-telemetry', payload: { cameraId: 1 } });
        expect(noStage.statusCode).toBe(400);
        // Fastify's ajv removeAdditional silently deletes undeclared fields — the point here is
        // that `ip` never reaches record(), not that the request 400s.
        const extra = await app.inject({ method: 'POST', url: '/api/public/playback-telemetry', payload: { stage: 'unknown', ip: '1.2.3.4' } });
        expect(extra.statusCode).toBe(202);
        expect(recordMock).toHaveBeenCalledWith({ stage: 'unknown' });
        expect(recordMock.mock.calls[0][0]).not.toHaveProperty('ip');
    });
});
