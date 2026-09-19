/*
Unit tests for the HG680P Armbian node-agent features in audioDeviceService:
  - 'volume' command: level clamped to 0..100; missing/non-numeric level throws 400 before queueing.
  - setDeviceVolume: thin wrapper that enqueues 'volume' to enabled devices.
  - touchDevice: persists the self-reported agent version (truncated to 24 chars); null keeps the old value.
connectionPool is mocked; `execute` captures SQL params so we can assert the values actually stored.
*/

import { vi, describe, it, expect, beforeEach } from 'vitest';

let lastInsert;   // params captured from the audio_device_commands INSERT
let lastUpdate;   // params captured from any UPDATE

vi.mock('../database/connectionPool.js', () => ({
    query: () => [],
    queryOne: (sql) => sql.includes('FROM audio_devices')
        ? { id: 7, name: 'STB Ruang Utama', enabled: 1 }   // a live device
        : null,
    execute: (sql, params = []) => {
        if (sql.includes('INSERT INTO audio_device_commands')) lastInsert = params;
        else lastUpdate = params;
        return { changes: 1, lastInsertRowid: 1 };
    },
}));

const svc = await import('../services/audioDeviceService.js');
const { enqueueCommand, setDeviceVolume, touchDevice } = svc;

describe('volume command (HG680P remote ALSA volume)', () => {
    beforeEach(() => { lastInsert = undefined; lastUpdate = undefined; });

    it('queues a volume command with the level stored verbatim', () => {
        enqueueCommand([7], 'volume', null, 1, 45);
        expect(lastInsert.at(-1)).toBe(45);
        expect(lastInsert[1]).toBe('volume');
    });

    it('clamps out-of-range levels into 0..100 so amixer never sees garbage', () => {
        enqueueCommand([7], 'volume', null, 1, 150);
        expect(lastInsert.at(-1)).toBe(100);
        enqueueCommand([7], 'volume', null, 1, -20);
        expect(lastInsert.at(-1)).toBe(0);
    });

    it('rejects a missing or non-numeric level with 400 and writes nothing', () => {
        for (const bad of [undefined, null, 'loud']) {
            expect(() => enqueueCommand([7], 'volume', null, 1, bad))
                .toThrowError(expect.objectContaining({ statusCode: 400 }));
        }
        expect(lastInsert).toBeUndefined();
    });

    it('setDeviceVolume enqueues volume to the enabled device', () => {
        const n = setDeviceVolume([7], 30);
        expect(n).toBe(1);
        expect(lastInsert.at(-1)).toBe(30);
    });
});

describe('touchDevice agent version (self-reported via x-agent-version)', () => {
    beforeEach(() => { lastUpdate = undefined; });

    it('persists the reported version for the device', () => {
        touchDevice(7, '10.0.0.5', '1.1.0');
        expect(lastUpdate[1]).toBe('1.1.0');
        expect(lastUpdate[2]).toBe(7);
    });

    it('keeps the stored version when the agent sends none (COALESCE null)', () => {
        touchDevice(7, '10.0.0.5', null);
        expect(lastUpdate[1]).toBeNull();
    });

    it('truncates absurdly long version strings to the column budget', () => {
        touchDevice(7, null, 'x'.repeat(300));
        expect(lastUpdate[1]).toHaveLength(24);
    });
});
