/**
 * Purpose: Kunci bahwa segmen yang MASIH ADA di disk ini dilayani tanpa menyentuh Telegram sama
 *          sekali — dan bahwa yang tidak ada tetap lewat jalur lama.
 * Caller: Backend test gate (vitest, node env).
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Terukur di produksi 2026-08-28: 476 dari 54.621 arsip masih punya rekaman aslinya di disk
 * (retensi lokal ~12 jam lawan 32 hari di Telegram). Untuk yang 476 itu, jalur lama TETAP memanggil
 * `getFile` lebih dulu — dan `getFile` adalah perintah yang menyuruh server Bot API mengunduh.
 *
 * Untuk berkas yang masih ada, getFile memang hanya menunjuk balik ke folder rekaman kita sendiri
 * sehingga tidak ada byte yang tertarik. Tapi ia tetap satu perjalanan bolak-balik yang tidak
 * diperlukan, dan — ini yang penting — ia menggantungkan pemutaran rekaman yang ADA DI SINI pada
 * sebuah layanan luar yang bisa sedang mati. Segmen dari sepuluh menit lalu, yang justru paling
 * sering diperiksa operator, tidak boleh gagal diputar hanya karena Telegram sedang tidak bisa
 * dihubungi.
 *
 * Tes ini memakai fetch tiruan yang MELEMPAR: kalau ada satu saja panggilan ke Telegram di jalur
 * lokal, tesnya merah.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const rows = { upload: null };

vi.mock('../database/connectionPool.js', () => ({
    query: () => [],
    queryOne: () => rows.upload,
    execute: () => ({ changes: 0 }),
    transaction: (fn) => fn(),
}));
vi.mock('../services/archiveCacheService.js', () => ({
    default: { makeRoom: vi.fn(), pin: vi.fn(), release: vi.fn(), CACHE_DIR: '/var/lib/telegram-bot-api' },
}));
vi.mock('../services/thumbnailPathService.js', () => ({ sanitizeCameraThumbnailList: (x) => x }));

const { openSegmentStream, localSegmentFile } = await import('../services/telegramArchiveLibraryService.js');

let dir;
let berkas;
const ISI = Buffer.from('0123456789abcdefghijABCDEFGHIJ');   // 30 byte, cukup untuk menguji Range

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arsip-'));
    berkas = path.join(dir, '20260828_140003.mp4');
    fs.writeFileSync(berkas, ISI);

    rows.upload = {
        segment_id: 1, camera_id: 9, filename: '20260828_140003.mp4',
        file_size: ISI.length, file_id: 'BAADBAADrwADBREAAWdSAAH', local_path: berkas,
    };

    // Satu panggilan ke Telegram = tes merah.
    globalThis.fetch = vi.fn(() => { throw new Error('Telegram DISENTUH padahal berkasnya ada di disk'); });
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/** Kumpulkan seluruh isi stream jadi satu Buffer. */
async function baca(stream) {
    const potongan = [];
    for await (const c of stream) potongan.push(c);
    return Buffer.concat(potongan);
}

describe('segmen yang masih di disk tidak menyentuh Telegram', () => {
    it('menyajikan seluruh berkas tanpa satu pun panggilan Telegram', async () => {
        const hasil = await openSegmentStream(1, null);

        expect(globalThis.fetch, 'getFile dipanggil untuk berkas yang ada di disk').not.toHaveBeenCalled();
        expect(await baca(hasil.stream)).toEqual(ISI);
        expect(hasil.totalSize).toBe(ISI.length);
    });

    it('memotong Range dari disk, tetap tanpa Telegram', async () => {
        const hasil = await openSegmentStream(1, { start: 5, end: 9 });

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(await baca(hasil.stream)).toEqual(ISI.subarray(5, 10));
        expect(hasil.size).toBe(5);
        expect(hasil.range).toEqual({ start: 5, end: 9 });
        expect(hasil.totalSize, 'ukuran TOTAL harus tetap ukuran berkas penuh').toBe(ISI.length);
    });

    it('Range terbuka (bytes=20-) dijepit ke ujung berkas', async () => {
        const hasil = await openSegmentStream(1, { start: 20, end: Number.MAX_SAFE_INTEGER });

        expect(await baca(hasil.stream)).toEqual(ISI.subarray(20));
        expect(hasil.range.end).toBe(ISI.length - 1);
    });
});

describe('yang TIDAK ada di disk tetap lewat Telegram', () => {
    /*
     * Diperiksa lewat GALATNYA, bukan lewat fetch: token bot dibaca dari .env sidecar yang
     * tidak ada di mesin tes, jadi cabang Telegram melempar sebelum sempat menyentuh
     * jaringan. Yang penting justru itu - galatnya berasal dari cabang Telegram, BUKAN dari
     * kegagalan membaca disk yang tersamar.
     */
    const galatTelegram = /Token bot Telegram|Telegram menolak|file_id|terarsip sebelum/i;

    it('tanpa local_path, ia masuk cabang Telegram - bukan gagal baca disk', async () => {
        rows.upload.local_path = null;

        await expect(openSegmentStream(1, null)).rejects.toThrow(galatTelegram);
    });

    it('baris ADA tapi berkasnya sudah dipangkas: jatuh ke Telegram, bukan melempar ENOENT', async () => {
        // Balapan nyata: pemangkas berjalan di antara baca-DB dan buka-berkas. Kalau ini
        // melempar ENOENT, operator melihat galat sistem berkas untuk keadaan yang normal.
        fs.rmSync(berkas);

        await expect(openSegmentStream(1, null)).rejects.toThrow(galatTelegram);
    });
});

describe('localSegmentFile: dasar keputusan rute', () => {
    it('mengembalikan path, ukuran, dan nama berkas saat ada', () => {
        expect(localSegmentFile(1)).toEqual({ path: berkas, size: ISI.length, filename: '20260828_140003.mp4' });
    });

    it('null saat tidak ada baris segmennya', () => {
        rows.upload.local_path = null;
        expect(localSegmentFile(1)).toBeNull();
    });

    it('null saat pathnya menunjuk DIREKTORI, bukan berkas', () => {
        // Penjaga bentuk: menyerahkan direktori ke nginx lewat X-Accel akan jadi 403/404 misterius.
        rows.upload.local_path = dir;
        expect(localSegmentFile(1)).toBeNull();
    });

    it('null saat berkasnya sudah hilang', () => {
        fs.rmSync(berkas);
        expect(localSegmentFile(1)).toBeNull();
    });

    it('TIDAK menyentuh Telegram sama sekali - ia murni DB + disk', () => {
        localSegmentFile(1);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});
