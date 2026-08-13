/**
 * Purpose: Verify the public vehicle-count read model stays honest — community-only, stale-aware, jargon-free.
 * Caller: Backend test gate.
 * Deps: vitest, fs, config, connectionPool mocks.
 * MainFuncs: getPublicVehicleCount, isVehicleCountCamera behavior tests.
 * SideEffects: Mocks fs and the DB layer; touches no real database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { statSyncMock, readFileSyncMock, queryOneMock } = vi.hoisted(() => ({
    statSyncMock: vi.fn(),
    readFileSyncMock: vi.fn(),
    queryOneMock: vi.fn(),
}));

vi.mock('fs', () => ({
    default: { statSync: statSyncMock, readFileSync: readFileSyncMock },
    statSync: statSyncMock,
    readFileSync: readFileSyncMock,
}));

vi.mock('../database/connectionPool.js', () => ({ queryOne: queryOneMock }));

vi.mock('../config/config.js', () => ({
    default: {
        vehicleCount: {
            cameraId: 15,
            statsPath: '/opt/yolo-demo/web/stats.json',
            staleAfterMs: 120000,
            hlsDir: '/opt/yolo-demo/web/hls',
            hlsPath: '/hitung-hls/live.m3u8',
            hlsStaleMs: 30000,
        },
    },
}));

const STATS = {
    total: 1284,
    total_10_menit: 37,
    per_jenis_10_menit: { motor: 24, mobil: 11, truk: 2, bus: 0 },
    total_jenis: { motor: 812, mobil: 390, truk: 68, bus: 14 },
    arah: {
        'Menuju barat (jembatan)': { motor: 400, mobil: 190, truk: 30, bus: 6 },
        'Menuju timur (belakang kamera)': { motor: 412, mobil: 200, truk: 38, bus: 8 },
    },
    per_menit: [
        { menit: '07:01', ke_barat: 10, ke_timur: 12 },
        { menit: '07:02', ke_barat: 8, ke_timur: 9 },
    ],
    mulai: '2026-08-12 20:57:33 WIB',
    // Detail internal yang TIDAK boleh bocor ke permukaan publik:
    model: 'yolo11m.pt imgsz=384',
    frame_diproses: 98123,
};

async function muat() {
    return import('../services/vehicleCountService.js');
}

describe('vehicleCountService', () => {
    beforeEach(() => {
        vi.resetModules();
        statSyncMock.mockReset();
        readFileSyncMock.mockReset();
        queryOneMock.mockReset();
        // Selalu kembalikan kamera komunitas kecuali test menimpanya. mockReturnValue,
        // bukan mockReturnValueOnce: antrean yang habis akan jatuh ke DB sungguhan.
        queryOneMock.mockReturnValue({ id: 15, name: 'PEREMPATAN JEMBATAN SOSRODILOGO', location: 'SIMPANG 4' });
        statSyncMock.mockReturnValue({ mtimeMs: Date.now() });
        readFileSyncMock.mockReturnValue(JSON.stringify(STATS));
    });

    it('returns the sanitized totals for the configured camera', async () => {
        const { getPublicVehicleCount } = await muat();
        const data = getPublicVehicleCount(15);

        expect(data.tersedia).toBe(true);
        expect(data.berhenti).toBe(false);
        expect(data.total).toBe(1284);
        expect(data.perJenis).toEqual({ motor: 812, mobil: 390, truk: 68, bus: 14 });
        // Angka yang bisa diperiksa pengunjung sambil menonton, bukan hanya total sesi.
        expect(data.total10m).toBe(37);
        expect(data.perJenis10m).toEqual({ motor: 24, mobil: 11, truk: 2, bus: 0 });
        expect(data.perArah[0]).toMatchObject({ label: 'Menuju timur (belakang kamera)', total: 658 });
        expect(data.perMenit).toEqual([
            { menit: '07:01', total: 22 },
            { menit: '07:02', total: 17 },
        ]);
    });

    it('never leaks internal counter jargon to the public payload', async () => {
        const { getPublicVehicleCount } = await muat();
        const serialized = JSON.stringify(getPublicVehicleCount(15));

        expect(serialized).not.toMatch(/yolo/i);
        expect(serialized).not.toMatch(/imgsz/i);
        expect(serialized).not.toMatch(/frame_diproses/i);
        expect(serialized).not.toMatch(/opt\/yolo-demo/);
    });

    it('marks the counts as stopped once the state file goes stale', async () => {
        statSyncMock.mockReturnValue({ mtimeMs: Date.now() - 600000 });
        const { getPublicVehicleCount } = await muat();
        const data = getPublicVehicleCount(15);

        expect(data.berhenti).toBe(true);
        expect(data.umurDetik).toBeGreaterThanOrEqual(600);
    });

    it('refuses a camera that is not community class', async () => {
        queryOneMock.mockReturnValue(undefined);
        const { getPublicVehicleCount } = await muat();

        expect(() => getPublicVehicleCount(15)).toThrowError(/tidak ditemukan/i);
        try {
            getPublicVehicleCount(15);
        } catch (error) {
            expect(error.statusCode).toBe(404);
        }
    });

    it('reports unavailable for any other camera without touching the database', async () => {
        const { getPublicVehicleCount } = await muat();
        const data = getPublicVehicleCount(16);

        expect(data).toEqual({ cameraId: 16, tersedia: false });
        expect(queryOneMock).not.toHaveBeenCalled();
    });

    it('reports unavailable when the state file is missing or half-written', async () => {
        statSyncMock.mockImplementation(() => { throw new Error('ENOENT'); });
        const { getPublicVehicleCount } = await muat();
        expect(getPublicVehicleCount(15).tersedia).toBe(false);

        vi.resetModules();
        statSyncMock.mockReturnValue({ mtimeMs: Date.now() });
        readFileSyncMock.mockReturnValue('{"total": 12');
        const again = await muat();
        expect(again.getPublicVehicleCount(15).tersedia).toBe(false);
    });

    it('identifies only the configured camera', async () => {
        const { isVehicleCountCamera } = await muat();
        expect(isVehicleCountCamera(15)).toBe(true);
        expect(isVehicleCountCamera('15')).toBe(true);
        expect(isVehicleCountCamera(16)).toBe(false);
    });

    /*
     * The annotated stream is what makes "what you watch" and "what is counted" the same
     * picture. But a public page must never be left with a dead player, so a playlist that
     * stopped updating has to fall back to the untouched camera feed — that is the case
     * these tests exist for.
     */
    describe('getAnnotatedStreamPath', () => {
        it('serves the annotated playlist while the counter is writing it', async () => {
            statSyncMock.mockReturnValue({ mtimeMs: Date.now() - 3000 });
            const { getAnnotatedStreamPath } = await muat();
            expect(getAnnotatedStreamPath(15)).toBe('/hitung-hls/live.m3u8');
        });

        it('falls back to the original feed once the playlist goes stale', async () => {
            statSyncMock.mockReturnValue({ mtimeMs: Date.now() - 60000 });
            const { getAnnotatedStreamPath } = await muat();
            expect(getAnnotatedStreamPath(15)).toBeNull();
        });

        it('falls back when the playlist is missing entirely', async () => {
            statSyncMock.mockImplementation(() => { throw new Error('ENOENT'); });
            const { getAnnotatedStreamPath } = await muat();
            expect(getAnnotatedStreamPath(15)).toBeNull();
        });

        it('never redirects any other camera to the annotated stream', async () => {
            statSyncMock.mockReturnValue({ mtimeMs: Date.now() });
            const { getAnnotatedStreamPath } = await muat();
            expect(getAnnotatedStreamPath(16)).toBeNull();
            expect(getAnnotatedStreamPath(1)).toBeNull();
        });
    });
});
