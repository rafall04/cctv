/**
 * Purpose: Lock the LOCAL-scoping of Audio Broadcast targets — the area allowlist that keeps the ~394
 *   remote Surabaya cameras out of the picker, and the tri-state capability filter.
 * Caller: Backend test gate (vitest, node env).
 * Deps: better-sqlite3 in-memory with the real areas/cameras columns; connectionPool mocked.
 *
 * WHY: the shipped listTargetCameras() returned ALL 414 internal-RTSP cameras (394 of them Surabaya).
 * The fix is a deterministic area gate (areas.audio_broadcast_enabled DEFAULT 0) + capability gate. A
 * regression here would re-flood the picker or, worse, let audio target a remote/other-city camera.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => {
    const Db = require('better-sqlite3');
    return { db: new Db(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
}));

const { listBroadcastTargets, listAreas, setAreaEnabled } = await import('../services/audioTargetService.js');

function resetSchema() {
    db.exec(`
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS areas;
        CREATE TABLE areas (id INTEGER PRIMARY KEY, name TEXT, audio_broadcast_enabled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY, name TEXT, area_id INTEGER, enabled INTEGER DEFAULT 1,
            stream_source TEXT DEFAULT 'internal', private_rtsp_url TEXT,
            supports_audio_out INTEGER, audio_out_checked_at TEXT, audio_out_note TEXT,
            audio_out_blocked INTEGER NOT NULL DEFAULT 0);
    `);
    // Area 1 = local (Dander), enabled. Area 2 = Surabaya, disabled (default 0).
    db.prepare("INSERT INTO areas (id,name,audio_broadcast_enabled) VALUES (1,'Dander',1),(2,'Surabaya',0)").run();
    const ins = db.prepare("INSERT INTO cameras (id,name,area_id,stream_source,private_rtsp_url,supports_audio_out) VALUES (?,?,?,?,?,?)");
    ins.run(1, 'Dander PS3E', 1, 'internal', 'rtsp://a:b@192.168.12.6:554/x', 1);   // local supported
    ins.run(2, 'Dander S41FE', 1, 'internal', 'rtsp://a:b@192.168.12.2:554/x', 0);  // local unsupported
    ins.run(3, 'Dander baru', 1, 'internal', 'rtsp://a:b@192.168.13.9:554/x', null); // local unknown
    ins.run(4, 'Surabaya cam', 2, 'internal', 'rtsp://a:b@36.66.208.5:554/x', 1);    // remote (disabled area)
    ins.run(5, 'Dander HLS', 1, 'external', null, null);                             // not internal
}

beforeEach(resetSchema);

describe('audioTargetService — local scoping', () => {
    it('includeUnknown: returns supported + unknown in enabled areas, never disabled-area or unsupported', () => {
        const t = listBroadcastTargets({ includeUnknown: true });
        const ids = t.map((c) => c.id).sort();
        expect(ids).toEqual([1, 3]);               // supported + unknown local; NOT 2(unsupported), 4(surabaya), 5(external)
        expect(t.every((c) => c.target_kind === 'camera')).toBe(true);
    });

    it('supported-only: returns just supported cameras in enabled areas', () => {
        expect(listBroadcastTargets({ includeUnknown: false }).map((c) => c.id)).toEqual([1]);
    });

    it('never leaks a Surabaya (disabled-area) camera even when it probes supported', () => {
        const all = listBroadcastTargets({ includeUnknown: true });
        expect(all.find((c) => c.id === 4)).toBeUndefined();
    });

    it('enabling the Surabaya area WOULD include it (proves the gate is the area flag, not an IP heuristic)', () => {
        setAreaEnabled(2, true);
        expect(listBroadcastTargets({ includeUnknown: true }).map((c) => c.id).sort()).toEqual([1, 3, 4]);
    });

    it('a blocked camera (V380-class) is excluded even when supported & in an enabled area', () => {
        db.prepare('UPDATE cameras SET audio_out_blocked = 1 WHERE id = 1').run(); // was the only supported local cam
        expect(listBroadcastTargets({ includeUnknown: false }).map((c) => c.id)).toEqual([]);
        expect(listBroadcastTargets({ includeUnknown: true }).map((c) => c.id).sort()).toEqual([3]); // 1 blocked out
    });
});

describe('audioTargetService — areas', () => {
    it('lists areas with internal camera counts, enabled first', () => {
        const areas = listAreas();
        expect(areas.map((a) => a.name)).toEqual(['Dander', 'Surabaya']);
        expect(areas.find((a) => a.name === 'Dander').internal_camera_count).toBe(3); // id 1,2,3 (id5 external excluded)
    });

    it('setAreaEnabled toggles the flag and 404s on a missing area', () => {
        expect(setAreaEnabled(1, false).audio_broadcast_enabled).toBe(0);
        expect(() => setAreaEnabled(999, true)).toThrow(/tidak ditemukan/i);
    });
});
