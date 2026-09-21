/**
 * Purpose: Pin the backend (and its sibling apps) to single-instance fork mode forever.
 *          `instances: 1` in an ecosystem file is NOT enough — pm2 treats the presence of
 *          `instances` as a cluster-mode request, and prod ran cluster-mode for months.
 *          Only `exec_mode: 'fork'` guarantees one process.
 * Caller:  backend test gate (guardrail).
 * Deps:    deployment/ecosystem.config.cjs (parsed via require).
 * SideEffects: none.
 *
 * WHY fork is non-negotiable — in-memory state that silently diverges under 2 workers:
 *   - middleware/rateLimiter.js        — rate-limit buckets per IP (2 workers = 2x quota)
 *   - services/cameraAudioLock.js      — per-camera talk lock (two talkers collide)
 *   - services/audioBroadcastBootstrap — schedule busy-guard (double-fire broadcasts)
 *   - services/cameraRuntimeStateService / cameraHealthService — alert/transition state
 *   - services/hlsProxyService.js / externalStreamCache.js — proxy + segment caches
 *   - services/playbackTelemetryService.js — viewer failure counters
 *   - services/recordingProcessManager.js — ffmpeg child registry
 *   - services/thumbnailService.js — failure dedupe/backoff state
 * If this test ever has to be deleted, the deletion PR must move ALL of the above to a
 * shared store (SQLite/Redis) first — or explicitly accept the divergence.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const ECOSYSTEM_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'deployment', 'ecosystem.config.cjs'
);

const { apps } = require(ECOSYSTEM_PATH);

describe('pm2 single-instance pin', () => {
    it('ecosystem declares the three apps', () => {
        expect(apps.map((a) => a.name)).toEqual(
            expect.arrayContaining([
                expect.stringMatching(/-mediamtx$/),
                expect.stringMatching(/-cctv-backend$/),
                expect.stringMatching(/-cctv-recorder$/),
            ])
        );
    });

    for (const app of apps) {
        it(`${app.name}: instances=1 AND exec_mode=fork`, () => {
            expect(app.instances).toBe(1);
            // exec_mode must be EXPLICIT — omitting it lets `instances` flip pm2 into
            // cluster mode, which is exactly how prod drifted.
            expect(app.exec_mode).toBe('fork');
        });
    }
});
