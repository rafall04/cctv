/**
 * Purpose: Guard the seam between telegramArchiveRoutes and telegramArchiveLibraryService — every
 *          helper the routes call must be reachable on the DEFAULT export they import.
 * Caller: Backend test gate.
 * Deps: vitest, node:fs (route source text), mocked connectionPool + archiveCacheService.
 * MainFuncs: default-export surface guard.
 * SideEffects: None; reads source text and imports the service with its DB layer mocked.
 *
 * Why this exists: `countUploads` shipped as a named export only. The routes import the default
 * object, so `archiveLibrary.countUploads` was undefined and the archive page died with
 * "countUploads is not a function" — in production, because the whole suite passed. Nothing
 * exercised the seam, so nothing could catch it. Deriving the list from the route SOURCE keeps
 * this honest as new handlers are added, instead of freezing today's names into an assertion.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../database/connectionPool.js', () => ({
    query: vi.fn(() => []),
    queryOne: vi.fn(() => ({ total: 0 })),
}));

vi.mock('../services/archiveCacheService.js', () => ({
    default: { makeRoom: vi.fn(), pathFor: vi.fn(), remember: vi.fn() },
}));

const here = path.dirname(fileURLToPath(import.meta.url));
const ROUTES = path.join(here, '..', 'routes', 'telegramArchiveRoutes.js');

describe('telegramArchiveLibraryService default export covers what the routes call', () => {
    it('exposes every archiveLibrary.<fn> used by telegramArchiveRoutes', async () => {
        const source = fs.readFileSync(ROUTES, 'utf8');
        const used = [...source.matchAll(/archiveLibrary\.(\w+)\s*\(/g)].map((m) => m[1]);
        const wanted = [...new Set(used)].sort();

        // A rename that silently empties this list would turn the guard into a no-op that still
        // reports green, so assert the extraction itself found something.
        expect(wanted.length).toBeGreaterThan(0);

        const { default: archiveLibrary } = await import('../services/telegramArchiveLibraryService.js');
        const missing = wanted.filter((name) => typeof archiveLibrary[name] !== 'function');

        expect(
            missing,
            `\nRoutes call these, but the default export does not expose them: ${missing.join(', ')}\n`,
        ).toEqual([]);
    });

    it('counts rows through the same filter shape the list uses', async () => {
        const { default: archiveLibrary } = await import('../services/telegramArchiveLibraryService.js');

        expect(archiveLibrary.countUploads({ cameraId: 16, from: '2026-07-31T00:00:00.000Z' })).toBe(0);
        expect(archiveLibrary.countUploads()).toBe(0);
    });

    it('applies the caller filters to the summary totals, but never narrows the camera picker', async () => {
        const { queryOne, query } = await import('../database/connectionPool.js');
        const { default: archiveLibrary } = await import('../services/telegramArchiveLibraryService.js');

        queryOne.mockClear();
        query.mockClear();
        archiveLibrary.getSummary({ cameraId: 16, from: '2026-07-31T00:00:00.000Z' });

        const [totalsSql, totalsParams] = queryOne.mock.calls.at(-1);
        expect(totalsSql).toContain('u.camera_id = ?');
        expect(totalsSql).toContain('u.recorded_at >= ?');
        expect(totalsParams).toContain(16);

        // The picker must keep every camera, or filtering to one strands the operator there with
        // no way back. Dates still apply, so the counts match the list.
        const [camerasSql, camerasParams] = query.mock.calls.at(-1);
        expect(camerasSql).not.toContain('u.camera_id = ?');
        expect(camerasSql).toContain('u.recorded_at >= ?');
        expect(camerasParams).not.toContain(16);
    });

    it('leaves the summary unrestricted when no filters are given', async () => {
        const { queryOne } = await import('../database/connectionPool.js');
        const { default: archiveLibrary } = await import('../services/telegramArchiveLibraryService.js');

        queryOne.mockClear();
        archiveLibrary.getSummary();

        const [sql, params] = queryOne.mock.calls.at(-1);
        expect(sql).not.toContain('recorded_at');
        expect(sql).not.toContain('camera_id = ?');
        expect(params).toEqual(['ok']);
    });
});
