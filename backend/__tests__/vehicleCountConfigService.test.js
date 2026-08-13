/**
 * Purpose: Verify per-camera counting config is validated before it can reach a counter process.
 * Caller: Backend test gate.
 * Deps: vitest, mocked fs + connectionPool + config.
 * MainFuncs: simpanConfig / bacaConfig / kameraAktif validation tests.
 * SideEffects: none; fs is mocked.
 *
 * Nilai-nilai ini datang dari FORM ADMIN dan berakhir sebagai setelan proses penghitung.
 * Yang dijaga di sini bukan kerapian, melainkan: form tidak boleh menghasilkan penghitung
 * yang mustahil dijalankan, dan tidak boleh menyelundupkan path lewat nama model.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fsMock, queryOneMock } = vi.hoisted(() => ({
    fsMock: {
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        renameSync: vi.fn(),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn(),
        unlinkSync: vi.fn(),
    },
    queryOneMock: vi.fn(),
}));

vi.mock('fs', () => ({ default: fsMock, ...fsMock }));
vi.mock('../database/connectionPool.js', () => ({ queryOne: queryOneMock }));
vi.mock('../config/config.js', () => ({
    default: { vehicleCount: { configDir: '/opt/yolo-demo/config' } },
}));

const GARIS_SAH = [{ a: [0.1, 0.2], b: [0.8, 0.9], nama: 'L1' }];

async function muat() {
    return import('../services/vehicleCountConfigService.js');
}

describe('vehicleCountConfigService', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.values(fsMock).forEach((f) => f.mockReset());
        queryOneMock.mockReset();
        queryOneMock.mockReturnValue({
            id: 15,
            name: 'SOSRODILOGO',
            camera_class: 'community',
            enabled: 1,
            delivery_type: 'external_hls',
            external_stream_url: 'https://contoh.go.id/live/rahasia.m3u8',
        });
    });

    function tersimpan() {
        return JSON.parse(fsMock.writeFileSync.mock.calls[0][1]);
    }

    it('menyimpan lewat berkas sementara lalu rename — penghitung tidak boleh membaca JSON separuh', async () => {
        const { simpanConfig } = await muat();
        simpanConfig(15, { aktif: true, garis: GARIS_SAH });

        expect(fsMock.writeFileSync.mock.calls[0][0]).toMatch(/cam15\.json\.tmp$/);
        expect(fsMock.renameSync).toHaveBeenCalledWith(
            expect.stringMatching(/cam15\.json\.tmp$/),
            expect.stringMatching(/cam15\.json$/),
        );
    });

    it('menolak menyalakan tanpa garis — penghitung yang tak pernah menghitung itu jebakan', async () => {
        const { simpanConfig } = await muat();
        expect(() => simpanConfig(15, { aktif: true, garis: [] }))
            .toThrowError(/minimal satu garis/i);
        expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });

    it('membuang garis di luar 0-1 dan yang terlalu pendek', async () => {
        const { simpanConfig } = await muat();
        simpanConfig(15, {
            aktif: false,
            garis: [
                { a: [0.1, 0.2], b: [0.8, 0.9] },     // sah
                { a: [1.4, 0.2], b: [0.8, 0.9] },     // di luar frame
                { a: [0.5, 0.5], b: [0.51, 0.51] },   // terlalu pendek
                { a: [0.1, 0.1] },                    // tidak lengkap
            ],
        });
        expect(tersimpan().garis).toHaveLength(1);
    });

    it('menolak nama model yang mengandung path', async () => {
        const { simpanConfig } = await muat();
        simpanConfig(15, { garis: GARIS_SAH, model: '../../etc/passwd.pt' });
        expect(tersimpan().model).toBe('yolo11m.pt');       // jatuh ke bawaan, bukan dipakai
    });

    it('menjepit angka ke rentang yang bisa dijalankan', async () => {
        const { simpanConfig } = await muat();
        simpanConfig(15, { garis: GARIS_SAH, imgsz: 5000, fps: 99, conf: 5, min_umur: 0 });
        const c = tersimpan();
        expect(c.imgsz).toBeLessThanOrEqual(960);
        expect(c.imgsz % 32).toBe(0);
        expect(c.fps).toBeLessThanOrEqual(15);
        expect(c.conf).toBeLessThanOrEqual(0.9);
        expect(c.min_umur).toBeGreaterThanOrEqual(1);
    });

    it('menormalkan arah arus supaya menandakan arah, bukan besaran', async () => {
        const { simpanConfig } = await muat();
        simpanConfig(15, { garis: GARIS_SAH, arah_arus: [30, -40] });
        const [x, y] = tersimpan().arah_arus;
        expect(Math.hypot(x, y)).toBeCloseTo(1, 3);
    });

    /*
     * Penghitung tidak bisa memakai /api/stream/:id — begitu kamera dihitung, endpoint itu
     * mengembalikan jalur BERANOTASI dan penghitung akan memakan keluarannya sendiri. Jadi
     * alamat asli ditulis ke berkas config, TAPI tidak boleh ikut keluar lewat API admin.
     */
    it('menulis alamat sumber ke berkas config untuk dipakai penghitung', async () => {
        const { simpanConfig } = await muat();
        simpanConfig(15, { garis: GARIS_SAH });
        expect(tersimpan().sumber).toBe('https://contoh.go.id/live/rahasia.m3u8');
    });

    it('menyaring alamat sumber dari bentuk yang boleh keluar lewat API', async () => {
        const { simpanConfig, tanpaSumber } = await muat();
        const isi = simpanConfig(15, { garis: GARIS_SAH });

        expect(isi.sumber).toBeTruthy();
        expect(tanpaSumber(isi)).not.toHaveProperty('sumber');
        expect(JSON.stringify(tanpaSumber(isi))).not.toMatch(/contoh\.go\.id/);
    });

    it('menolak kamera tanpa sumber yang bisa dihitung', async () => {
        queryOneMock.mockReturnValue({
            id: 20, name: 'TANPA SUMBER', camera_class: 'community', enabled: 1,
            delivery_type: 'external_embed',
        });
        const { simpanConfig } = await muat();
        expect(() => simpanConfig(20, { garis: GARIS_SAH })).toThrowError(/sumber stream/i);
    });

    it('menolak kamera yang tidak ada', async () => {
        queryOneMock.mockReturnValue(undefined);
        const { simpanConfig } = await muat();
        expect(() => simpanConfig(999, { garis: GARIS_SAH })).toThrowError(/tidak ditemukan/i);
    });

    it('kameraAktif hanya benar bila aktif DAN punya garis', async () => {
        const { kameraAktif } = await muat();

        fsMock.readFileSync.mockReturnValue(JSON.stringify({ aktif: true, garis: GARIS_SAH }));
        expect(kameraAktif(15)).toBe(true);

        fsMock.readFileSync.mockReturnValue(JSON.stringify({ aktif: true, garis: [] }));
        expect(kameraAktif(15)).toBe(false);

        fsMock.readFileSync.mockReturnValue(JSON.stringify({ aktif: false, garis: GARIS_SAH }));
        expect(kameraAktif(15)).toBe(false);

        fsMock.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
        expect(kameraAktif(15)).toBe(false);
    });
});
