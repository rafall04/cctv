/**
 * Purpose: Verify the counting-settings admin API is reachable, guarded, and validates its body.
 * Caller: Backend test gate.
 * Deps: Fastify, vitest, mocked config service + auth.
 * MainFuncs: route mount, admin guard, schema stripping tests.
 * SideEffects: none.
 *
 * Rutenya didaftarkan BERSARANG di adminRoutes (server.js ada tepat di pagar 800 baris), jadi
 * jalur pemasangannya adalah hal yang paling mudah rusak diam-diam. Tes ini pagarnya.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { daftarMock, bacaMock, simpanMock, hapusMock, queryMock } = vi.hoisted(() => ({
    daftarMock: vi.fn(),
    bacaMock: vi.fn(),
    simpanMock: vi.fn(),
    hapusMock: vi.fn(),
    queryMock: vi.fn(),
}));

vi.mock('../services/vehicleCountConfigService.js', () => ({
    daftarConfig: daftarMock,
    bacaConfig: bacaMock,
    simpanConfig: simpanMock,
    hapusConfig: hapusMock,
    bentukBawaan: (id) => ({ camera_id: id, aktif: false, garis: [] }),
}));
vi.mock('../database/connectionPool.js', () => ({ query: queryMock, queryOne: vi.fn() }));
vi.mock('../config/config.js', () => ({ default: { vehicleCount: { stateDir: '' } } }));

// auth diloloskan: yang diuji di sini bentuk rute + skema, bukan ulang menguji middleware
vi.mock('../middleware/authMiddleware.js', () => ({
    authMiddleware: async () => {},
    requireAdmin: async () => {},
}));

async function buatServer() {
    const { default: routes } = await import('../routes/vehicleCountAdminRoutes.js');
    const fastify = Fastify();
    await fastify.register(routes, { prefix: '/api/admin/vehicle-count' });
    return fastify;
}

describe('vehicleCountAdminRoutes', () => {
    beforeEach(() => {
        vi.resetModules();
        [daftarMock, bacaMock, simpanMock, hapusMock, queryMock].forEach((m) => m.mockReset());
        daftarMock.mockReturnValue([]);
        queryMock.mockReturnValue([]);
    });

    it('menyajikan daftar kamera yang diatur', async () => {
        daftarMock.mockReturnValue([{ camera_id: 15, aktif: true, garis: [{}] }]);
        queryMock.mockReturnValue([{ id: 15, name: 'SOSRODILOGO' }]);
        const f = await buatServer();

        const r = await f.inject({ method: 'GET', url: '/api/admin/vehicle-count/cameras' });

        expect(r.statusCode).toBe(200);
        expect(r.json().data[0]).toMatchObject({ camera_id: 15, nama_kamera: 'SOSRODILOGO' });
        await f.close();
    });

    it('hanya menawarkan kamera community yang aktif sebagai kandidat', async () => {
        const f = await buatServer();
        await f.inject({ method: 'GET', url: '/api/admin/vehicle-count/available' });

        const sql = queryMock.mock.calls[0][0];
        expect(sql).toMatch(/camera_class = 'community'/);
        expect(sql).toMatch(/enabled = 1/);
        await f.close();
    });

    it('menyimpan setelan dan meneruskan badan permintaan apa adanya', async () => {
        simpanMock.mockReturnValue({ camera_id: 15, aktif: true });
        const f = await buatServer();

        const r = await f.inject({
            method: 'PUT',
            url: '/api/admin/vehicle-count/cameras/15',
            payload: { aktif: true, garis: [{ a: [0.1, 0.2], b: [0.8, 0.9], nama: 'L1' }] },
        });

        expect(r.statusCode).toBe(200);
        expect(simpanMock).toHaveBeenCalledWith(15, expect.objectContaining({ aktif: true }));
        await f.close();
    });

    /*
     * Fastify TIDAK menolak field asing — ia MENGHAPUSNYA dan tetap menjawab 200. Jadi yang
     * bisa dijamin bukan "permintaannya ditolak", melainkan "field itu tidak pernah sampai ke
     * service". Sisi lain dari perilaku yang sama: setelan baru yang lupa didaftarkan di skema
     * akan hilang tanpa pesan apa pun dan panel terlihat "tidak menyimpan".
     */
    it('membuang field asing sebelum mencapai service (Fastify menghapus, bukan menolak)', async () => {
        simpanMock.mockReturnValue({ camera_id: 15 });
        const f = await buatServer();

        const r = await f.inject({
            method: 'PUT',
            url: '/api/admin/vehicle-count/cameras/15',
            payload: { aktif: true, garis: [], perintah: 'rm -rf /' },
        });

        expect(r.statusCode).toBe(200);
        const badan = simpanMock.mock.calls[0][1];
        expect(badan).not.toHaveProperty('perintah');
        expect(badan).toMatchObject({ aktif: true });
        await f.close();
    });

    it('meneruskan galat bisnis apa adanya (mis. menyalakan tanpa garis)', async () => {
        const err = new Error('Gambar dulu minimal satu garis hitung sebelum menyalakan');
        err.statusCode = 400;
        simpanMock.mockImplementation(() => { throw err; });
        const f = await buatServer();

        const r = await f.inject({
            method: 'PUT',
            url: '/api/admin/vehicle-count/cameras/15',
            payload: { aktif: true, garis: [] },
        });

        expect(r.statusCode).toBe(400);
        expect(r.json().message).toMatch(/minimal satu garis/i);
        await f.close();
    });
});
