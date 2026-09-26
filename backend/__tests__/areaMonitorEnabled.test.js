/**
 * Purpose: Verify the per-area `monitor_enabled` flag — the admin lever that decides which
 *          areas appear on the public /monitor wall. Defaults OFF (opt-in surface), persists
 *          through updateArea, and is published on the public area list because a flag that
 *          says "this area is offered for monitoring" is display metadata, not a secret.
 * Caller: Backend focused test gate.
 * Deps: vitest; real test DB via connectionPool (globalSetup snapshot).
 * SideEffects: Inserts + deletes temp areas/cameras inside the test DB only.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import areaService from '../services/areaService.js';
import { execute, queryOne } from '../database/connectionPool.js';

const AREA_NAME = 'ZZ TEST MONITOR AREA';

function seedArea({ enabled = 0 } = {}) {
    const created = areaService.createArea({ name: AREA_NAME });
    execute('UPDATE areas SET monitor_enabled = ? WHERE id = ?', [enabled, created.id]);
    execute(
        `INSERT INTO cameras (name, area_id, camera_class, enabled, status, private_rtsp_url)
         VALUES ('ZZ TEST MONITOR CAM', ?, 'community', 1, 'active', 'rtsp://127.0.0.1/test')`,
        [created.id]
    );
    return created.id;
}

function cleanup() {
    execute(`DELETE FROM cameras WHERE name = 'ZZ TEST MONITOR CAM'`, []);
    execute(`DELETE FROM areas WHERE name = ?`, [AREA_NAME]);
}

describe('area monitor_enabled flag', () => {
    beforeEach(cleanup);

    it('defaults to 0 — monitor opt-in, not opt-out', () => {
        const id = seedArea();
        const row = queryOne('SELECT monitor_enabled FROM areas WHERE id = ?', [id]);
        expect(row.monitor_enabled).toBe(0);
    });

    it('persists through updateArea and survives untouched by unrelated updates', () => {
        const id = seedArea();
        areaService.updateArea(id, { name: AREA_NAME, monitor_enabled: true });
        expect(queryOne('SELECT monitor_enabled FROM areas WHERE id = ?', [id]).monitor_enabled).toBe(1);

        // A payload that never mentions the flag must NOT reset it (card toggles send
        // partial-field payloads re-normalized from the row).
        areaService.updateArea(id, { name: AREA_NAME, description: 'x' });
        expect(queryOne('SELECT monitor_enabled FROM areas WHERE id = ?', [id]).monitor_enabled).toBe(1);

        areaService.updateArea(id, { name: AREA_NAME, monitor_enabled: false });
        expect(queryOne('SELECT monitor_enabled FROM areas WHERE id = ?', [id]).monitor_enabled).toBe(0);
    });

    it('is carried on the PUBLIC area list (picker needs it) and admin overview', () => {
        const id = seedArea({ enabled: 1 });
        const publicRow = areaService.getAllAreas({ publicOnly: true })
            .areas.find((area) => area.id === id);
        expect(publicRow).toBeTruthy();
        expect(publicRow.monitor_enabled).toBe(1);

        const adminRow = areaService.getAdminOverview()
            .data.find((area) => area.id === id);
        expect(adminRow.monitor_enabled).toBe(1);
    });
});
