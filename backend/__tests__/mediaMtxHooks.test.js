/*
 * Purpose: Cover the Phase 3 push-hook fields on MediaMTX path config — hooks appear ONLY for an
 *          always_on path AND only when INTERNAL_HOOK_SECRET is set (so an unconfigured deploy is a
 *          dormant no-op), an on-demand path stays hook-free, an unsafe secret disables hooks, and
 *          pathConfigNeedsUpdate treats absent vs "" hook fields as equal while detecting real drift.
 * Caller:  Backend Vitest suite.
 * Deps:    mediaMtxService with mocked axios/config/connectionPool; real ingest-policy resolvers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
    default: { create: () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }) },
}));
vi.mock('../config/config.js', () => ({
    config: {
        mediamtx: { apiUrl: 'http://localhost:9997' },
        server: { port: 3000 },
        security: { internalHookSecret: '' },
    },
}));
vi.mock('../database/connectionPool.js', () => ({ query: vi.fn(), queryOne: vi.fn() }));

const { config } = await import('../config/config.js');
const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

const alwaysOnCam = { id: 1, rtsp_url: 'rtsp://10.0.0.5/live', stream_key: 'uuid-1', path_name: 'uuid-1' };
const onDemandCam = {
    id: 2, rtsp_url: 'rtsp://10.0.0.6/live', stream_key: 'uuid-2', path_name: 'uuid-2',
    source_profile: 'surabaya_private_rtsp', // strict on-demand profile => mode on_demand
};

beforeEach(() => {
    config.security.internalHookSecret = '';
});

describe('buildInternalPathConfig — push hook fields', () => {
    it('emits EMPTY hooks when the secret is unset (dormant, no-op deploy)', () => {
        const cfg = mediaMtxService.buildInternalPathConfig(alwaysOnCam);
        expect(cfg.runOnReady).toBe('');
        expect(cfg.runOnNotReady).toBe('');
        expect(cfg.runOnReadyRestart).toBe(false);
    });

    it('emits hooks for an always_on path when the secret is set', () => {
        config.security.internalHookSecret = 'sec123ABC';
        const cfg = mediaMtxService.buildInternalPathConfig(alwaysOnCam);
        expect(cfg.runOnReady).toContain('event=ready&path=$MTX_PATH');
        expect(cfg.runOnReady).toContain('X-Internal-Secret: sec123ABC');
        expect(cfg.runOnReady).toContain('127.0.0.1:3000/api/internal/mediamtx/path-event');
        expect(cfg.runOnNotReady).toContain('event=notready&path=$MTX_PATH');
        expect(cfg.runOnReadyRestart).toBe(false);
    });

    it('emits EMPTY hooks for an on-demand path even when the secret is set', () => {
        config.security.internalHookSecret = 'sec123ABC';
        const cfg = mediaMtxService.buildInternalPathConfig(onDemandCam);
        expect(cfg.runOnReady).toBe('');
        expect(cfg.runOnNotReady).toBe('');
    });

    it('emits EMPTY hooks when the secret contains unsafe (quote-breaking) characters', () => {
        config.security.internalHookSecret = 'bad" secret; rm -rf /';
        const cfg = mediaMtxService.buildInternalPathConfig(alwaysOnCam);
        expect(cfg.runOnReady).toBe('');
        expect(cfg.runOnNotReady).toBe('');
    });
});

describe('pathConfigNeedsUpdate — hook drift', () => {
    const base = {
        source: 'rtsp://10.0.0.5/live', rtspTransport: 'tcp', sourceOnDemand: false,
        sourceOnDemandStartTimeout: '10s', sourceOnDemandCloseAfter: '30s',
    };

    it('detects an always_on path missing the hook it should now carry', () => {
        config.security.internalHookSecret = 'sec123ABC';
        const desired = mediaMtxService.buildInternalPathConfig(alwaysOnCam);
        const current = { ...desired, runOnReady: '', runOnNotReady: '', runOnReadyRestart: false };
        expect(mediaMtxService.pathConfigNeedsUpdate(current, desired)).toBe(true);
    });

    it('treats ABSENT (MediaMTX default) vs "" hook fields as equal — no needless patch/bounce', () => {
        const desired = { ...base, runOnReady: '', runOnNotReady: '', runOnReadyRestart: false };
        const current = { ...base }; // MediaMTX returns the record without our empty hook fields
        expect(mediaMtxService.pathConfigNeedsUpdate(current, desired)).toBe(false);
    });

    it('detects when a hook must be CLEARED (feature turned off) so a stale command is removed', () => {
        const current = {
            ...base,
            runOnReady: 'curl ... event=ready ...',
            runOnNotReady: 'curl ... event=notready ...',
        };
        const desired = { ...base, runOnReady: '', runOnNotReady: '', runOnReadyRestart: false };
        expect(mediaMtxService.pathConfigNeedsUpdate(current, desired)).toBe(true);
    });
});
