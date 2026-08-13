/**
 * Purpose: Verify the Ronda readiness check names every missing piece instead of failing vaguely.
 * Caller: Backend test gate.
 * Deps: vitest, mocked fs / child_process / connectionPool / rondaConfigService.
 * MainFuncs: kesiapan() tests.
 * SideEffects: none — every external dependency is mocked.
 *
 * Ini menjaga pelajaran dari produksi: runtime detektor sama sekali tidak ada di mesin itu,
 * tetapi satu-satunya pesan yang muncul adalah soal token Telegram — menyesatkan operator ke
 * arah yang salah. Kalau daftar "kurang" ini pernah menciut lagi jadi satu sebab saja, tes gagal.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adaBerkas, execFileMock } = vi.hoisted(() => ({
    adaBerkas: vi.fn(),
    execFileMock: vi.fn(),
}));

vi.mock('fs', () => ({
    default: { existsSync: adaBerkas, mkdirSync: vi.fn(), createReadStream: vi.fn() },
    existsSync: adaBerkas,
}));

vi.mock('child_process', () => ({
    execFile: (cmd, args, opts, cb) => {
        const done = typeof opts === 'function' ? opts : cb;
        try {
            done(null, { stdout: execFileMock(cmd, args) ?? '', stderr: '' });
        } catch (e) {
            done(e);
        }
    },
}));

// Tanpa ini, queryOne akan menyentuh cctv.db yang sebenarnya.
vi.mock('../database/connectionPool.js', () => ({
    query: vi.fn(() => []),
    queryOne: vi.fn(() => null),
}));

vi.mock('../services/rondaConfigService.js', () => ({
    default: {
        isAvailable: vi.fn(() => false),
        anyBotToken: vi.fn(() => ''),
        listRaw: vi.fn(() => []),
        listNames: vi.fn(() => []),
    },
}));

async function muat() {
    const mod = await import('../services/rondaDetectorService.js');
    return mod.default;
}

describe('rondaDetectorService.kesiapan', () => {
    beforeEach(() => {
        vi.resetModules();                 // buang cache kesiapan antar-tes
        adaBerkas.mockReset();
        execFileMock.mockReset();
    });

    it('menyebut SEMUA yang kurang, bukan hanya token — persis keadaan produksi', async () => {
        adaBerkas.mockReturnValue(false);                       // work dir & model tidak ada
        execFileMock.mockImplementation(() => { throw new Error('docker: not found'); });

        const svc = await muat();
        const hasil = await svc.kesiapan();

        expect(hasil.siap).toBe(false);
        expect(hasil.kurang.length).toBeGreaterThanOrEqual(5);
        const gabung = hasil.kurang.join(' | ');
        expect(gabung).toMatch(/Docker/i);
        expect(gabung).toMatch(/image/i);
        expect(gabung).toMatch(/Model/i);
        expect(gabung).toMatch(/Telegram/i);
    });

    it('image tidak diperiksa saat docker sendiri mati — perintahnya pasti gagal', async () => {
        adaBerkas.mockReturnValue(true);
        execFileMock.mockImplementation(() => { throw new Error('docker: not found'); });

        const svc = await muat();
        const hasil = await svc.kesiapan();

        expect(hasil.rincian.docker).toBe(false);
        expect(hasil.rincian.image).toBe(false);
        expect(execFileMock.mock.calls.every(([, args]) => args[0] !== 'image')).toBe(true);
    });

    it('siap hanya bila seluruh bagian ada', async () => {
        adaBerkas.mockReturnValue(true);
        execFileMock.mockReturnValue('sha256:abc');
        const konfig = (await import('../services/rondaConfigService.js')).default;
        konfig.isAvailable.mockReturnValue(true);
        konfig.anyBotToken.mockReturnValue('token-bohongan');

        const svc = await muat();
        const hasil = await svc.kesiapan();

        expect(hasil.siap).toBe(true);
        expect(hasil.kurang).toEqual([]);
    });

    it('hasilnya di-cache — halaman admin tidak boleh memicu docker berkali-kali', async () => {
        adaBerkas.mockReturnValue(false);
        execFileMock.mockReturnValue('');

        const svc = await muat();
        await svc.kesiapan();
        const setelahSekali = execFileMock.mock.calls.length;
        await svc.kesiapan();

        expect(execFileMock.mock.calls.length).toBe(setelahSekali);
    });
});
