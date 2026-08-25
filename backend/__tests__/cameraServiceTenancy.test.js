/*
Purpose: cameraService.createCamera must write tenancy (camera_class / owner_user_id) inside the
         INSERT itself. The column default is 'community' — the ONE branch of the public filter that
         ignores is_public — so a rental camera reclassed only afterwards is fully public in between,
         and permanently public if the process dies there.
Caller: Vitest backend suite.
Deps: connectionPool spies, mediaMtxService spy.
SideEffects: None. Every DB function is spied with a persistent mockImplementation (never an
             exhaustible mockReturnValueOnce), so nothing can fall through to the real cctv.db.
*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';
import cameraService from '../services/cameraService.js';
import mediaMtxService from '../services/mediaMtxService.js';

const REQUEST = { user: { id: 1, username: 'admin' }, ip: '127.0.0.1' };

function spyDb() {
    const calls = [];
    vi.spyOn(connectionPool, 'execute').mockImplementation((sql, params = []) => {
        calls.push({ sql, params });
        return { lastInsertRowid: 77, changes: 1 };
    });
    vi.spyOn(connectionPool, 'queryOne').mockImplementation(() => null);
    vi.spyOn(connectionPool, 'query').mockImplementation(() => []);
    vi.spyOn(mediaMtxService, 'updateCameraPath').mockResolvedValue({ success: true });
    return calls;
}

// Read a column out of the INSERT by name, so a future column reorder cannot make this pass falsely.
function insertedValue(calls, column) {
    const insert = calls.find((c) => String(c.sql).startsWith('INSERT INTO cameras'));
    expect(insert, 'no INSERT INTO cameras was issued').toBeTruthy();
    const columns = insert.sql
        .slice(insert.sql.indexOf('(') + 1, insert.sql.indexOf(')'))
        .split(',')
        .map((c) => c.trim());
    const index = columns.indexOf(column);
    expect(index, `INSERT does not mention ${column} at all`).toBeGreaterThanOrEqual(0);
    return insert.params[index];
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('cameraService.createCamera — tenancy is born correct', () => {
    it('writes camera_class + owner_user_id for a rental camera', async () => {
        const calls = spyDb();
        await cameraService.createCamera({
            name: 'Kamera Sewa',
            private_rtsp_url: 'rtsp://192.168.1.10:554/ch1',
            camera_class: 'subscriber',
            owner_user_id: 42,
        }, REQUEST);

        expect(insertedValue(calls, 'camera_class')).toBe('subscriber');
        expect(insertedValue(calls, 'owner_user_id')).toBe(42);
    });

    it('keeps the old default for callers that say nothing (admin path unchanged)', async () => {
        const calls = spyDb();
        await cameraService.createCamera({
            name: 'Kamera Warga',
            private_rtsp_url: 'rtsp://192.168.1.11:554/ch1',
        }, REQUEST);

        expect(insertedValue(calls, 'camera_class')).toBe('community');
        expect(insertedValue(calls, 'owner_user_id')).toBe(null);
    });

    it('ignores an unknown class instead of trusting the payload', async () => {
        const calls = spyDb();
        await cameraService.createCamera({
            name: 'Kamera Ngaco',
            private_rtsp_url: 'rtsp://192.168.1.12:554/ch1',
            camera_class: 'apa_saja',
            owner_user_id: 42,
        }, REQUEST);

        expect(insertedValue(calls, 'camera_class')).toBe('community');
        expect(insertedValue(calls, 'owner_user_id')).toBe(null); // no owner without a real class
    });

    it('does not smuggle an owner onto a community camera', async () => {
        const calls = spyDb();
        await cameraService.createCamera({
            name: 'Kamera Warga 2',
            private_rtsp_url: 'rtsp://192.168.1.13:554/ch1',
            camera_class: 'community',
            owner_user_id: 42,
        }, REQUEST);

        expect(insertedValue(calls, 'owner_user_id')).toBe(null);
    });
});
