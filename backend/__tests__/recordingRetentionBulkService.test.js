import { describe, it, expect, vi } from 'vitest';
import { createBulkRecordingDurationUpdater } from '../services/recordingRetentionBulkService.js';

function makeDeps(overrides = {}) {
    const calls = { execute: [] };
    const deps = {
        query: vi.fn(() => []),
        queryOne: vi.fn(() => null),
        execute: vi.fn((sql, params) => { calls.execute.push({ sql, params }); }),
        transaction: vi.fn((fn) => fn()),
        invalidateCameras: vi.fn(),
        ...overrides,
    };
    return { deps, calls };
}

const request = { user: { id: 7 }, ip: '1.2.3.4' };

describe('bulkUpdateRecordingDuration', () => {
    it('menolak jam di luar rentang 1-2160', async () => {
        const { deps } = makeDeps();
        const fn = createBulkRecordingDurationUpdater(deps);
        await expect(fn({ scope: 'ids', cameraIds: [1], recordingDurationHours: 0 }, request)).rejects.toMatchObject({ statusCode: 400 });
        await expect(fn({ scope: 'ids', cameraIds: [1], recordingDurationHours: 5000 }, request)).rejects.toMatchObject({ statusCode: 400 });
        await expect(fn({ scope: 'ids', cameraIds: [1], recordingDurationHours: 'x' }, request)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('scope=ids: update kamera yang cocok, SQL parameterized, cache diinvalidasi', async () => {
        const { deps, calls } = makeDeps({ query: vi.fn(() => [{ id: 1, name: 'A' }, { id: 3, name: 'C' }]) });
        const fn = createBulkRecordingDurationUpdater(deps);
        const res = await fn({ scope: 'ids', cameraIds: [1, 3, 'bad'], recordingDurationHours: 24 }, request);

        expect(res).toMatchObject({ updated: 2, recording_duration_hours: 24, scope: 'ids' });
        // id 'bad' dibuang -> hanya dua placeholder
        expect(deps.query).toHaveBeenCalledWith(expect.stringContaining('IN (?, ?)'), [1, 3]);
        const update = calls.execute.find((c) => c.sql.includes('UPDATE cameras'));
        expect(update.params).toEqual([24, 1, 3]);
        // audit tercatat
        expect(calls.execute.some((c) => c.sql.includes('audit_logs'))).toBe(true);
        expect(deps.invalidateCameras).toHaveBeenCalledOnce();
    });

    it('scope=ids tanpa id valid -> 400', async () => {
        const { deps } = makeDeps();
        const fn = createBulkRecordingDurationUpdater(deps);
        await expect(fn({ scope: 'ids', cameraIds: ['x', null], recordingDurationHours: 12 }, request)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('scope=area: area tak ada -> 404', async () => {
        const { deps } = makeDeps({ queryOne: vi.fn(() => null) });
        const fn = createBulkRecordingDurationUpdater(deps);
        await expect(fn({ scope: 'area', areaId: 9, recordingDurationHours: 12 }, request)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('scope=area: update kamera enabled di area', async () => {
        const { deps } = makeDeps({
            queryOne: vi.fn(() => ({ id: 2, name: 'Dander' })),
            query: vi.fn(() => [{ id: 5, name: 'X' }]),
        });
        const fn = createBulkRecordingDurationUpdater(deps);
        const res = await fn({ scope: 'area', areaId: 2, recordingDurationHours: 48 }, request);
        expect(res.updated).toBe(1);
        expect(deps.query).toHaveBeenCalledWith(expect.stringContaining('area_id = ? AND enabled = 1'), [2]);
    });

    it('scope=group: nama kosong -> 400', async () => {
        const { deps } = makeDeps();
        const fn = createBulkRecordingDurationUpdater(deps);
        await expect(fn({ scope: 'group', groupName: '  ', recordingDurationHours: 12 }, request)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('tidak ada kamera cocok -> 400', async () => {
        const { deps } = makeDeps({ query: vi.fn(() => []) });
        const fn = createBulkRecordingDurationUpdater(deps);
        await expect(fn({ scope: 'group', groupName: 'G', recordingDurationHours: 12 }, request)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('scope tak dikenal -> 400', async () => {
        const { deps } = makeDeps();
        const fn = createBulkRecordingDurationUpdater(deps);
        await expect(fn({ scope: 'nope', recordingDurationHours: 12 }, request)).rejects.toMatchObject({ statusCode: 400 });
    });
});
