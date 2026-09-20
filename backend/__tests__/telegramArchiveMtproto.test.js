/**
 * Purpose: Kunci jalur MTProto — unduh SEBAGIAN dipakai lebih dulu, dan gagalnya JATUH ke Bot API,
 *          tidak pernah menggantung pemutaran.
 * Caller: Backend test gate (vitest, node env).
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Bot API getFile menarik seluruh 238 MB untuk lompatan 2 detik. Service MTProto (bot, di 127.0.0.1)
 * menarik hanya byte yang diminta. Tes ini menjaga tiga janji yang membuatnya aman dinyalakan di
 * produksi: (1) saat env-nya diisi, Range diteruskan dan Content-Range service dipercaya sebagai
 * kebenaran; (2) saat service menolak, ia JATUH ke Bot API - jadi menyalakannya tak pernah membuat
 * arsip yang tadinya bisa diputar jadi tidak bisa; (3) berkas yang masih di disk tidak menyentuh
 * MTProto MAUPUN Bot API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const rows = { upload: null };
// CACHE_DIR digerakkan lewat getter supaya tes prefetch bisa mengarahkannya ke tmpdir nyata —
// jalur hit-disk di openSegmentStream memakai existsSync, bukan mock.
let cacheDirValue = '/var/lib/telegram-bot-api';
vi.mock('../database/connectionPool.js', () => ({
    query: () => [], queryOne: () => rows.upload, execute: () => ({ changes: 0 }), transaction: (f) => f(),
}));
vi.mock('../services/archiveCacheService.js', () => ({
    default: {
        makeRoom: vi.fn(), pin: vi.fn(), release: vi.fn(),
        get CACHE_DIR() { return cacheDirValue; },
    },
}));
vi.mock('../services/thumbnailPathService.js', () => ({ sanitizeCameraThumbnailList: (x) => x }));

const { openSegmentStream } = await import('../services/telegramArchiveLibraryService.js');

const URL_MT = 'http://127.0.0.1:8093';

function respons({ status = 206, contentRange = 'bytes 5-9/30', contentLength = '5', body = 'HALO!' }) {
    const headers = new Map();
    if (contentRange) headers.set('content-range', contentRange);
    if (contentLength) headers.set('content-length', contentLength);
    return {
        ok: status >= 200 && status < 300,
        status,
        body: body === null ? null : body,   // cukup untuk memeriksa ia diteruskan apa adanya
        headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
    };
}

beforeEach(() => {
    process.env.TG_ARCHIVE_MTPROTO_URL = URL_MT;
    rows.upload = {
        segment_id: 1, camera_id: 9, filename: 'seg.mp4',
        file_size: 30, file_id: 'FID', local_path: null,
    };
});
afterEach(() => {
    delete process.env.TG_ARCHIVE_MTPROTO_URL;
    vi.restoreAllMocks();
});

describe('MTProto dipakai lebih dulu', () => {
    it('meneruskan Range dan mempercayai Content-Range service', async () => {
        globalThis.fetch = vi.fn(async () => respons({}));

        const hasil = await openSegmentStream(1, { start: 5, end: 9 });

        // Panggilan pertama = irisan live; panggilan berikutnya (kalau ada) adalah prefetch latar
        // ke service yang sama — yang tidak boleh terjadi hanya satu: menyentuh Bot API.
        const [url, opt] = globalThis.fetch.mock.calls[0];
        expect(globalThis.fetch.mock.calls.every(([u]) => String(u).startsWith(URL_MT))).toBe(true);
        expect(url).toBe(`${URL_MT}/segment/1`);
        expect(opt.headers.Range).toBe('bytes=5-9');
        expect(hasil.range).toEqual({ start: 5, end: 9 });
        expect(hasil.totalSize).toBe(30);
        expect(hasil.size).toBe(5);
        expect(hasil.stream).toBe('HALO!');
    });

    it('tanpa Range: minta seluruh berkas, tanpa header Range', async () => {
        globalThis.fetch = vi.fn(async () => respons({ status: 200, contentRange: null, contentLength: '30' }));

        const hasil = await openSegmentStream(1, null);

        expect(globalThis.fetch.mock.calls[0][1].headers).toEqual({});
        expect(hasil.range).toBeNull();
        expect(hasil.totalSize).toBe(30);
    });

    it('URL dengan garis miring di ujung tidak jadi dua garis miring', async () => {
        process.env.TG_ARCHIVE_MTPROTO_URL = `${URL_MT}/`;
        globalThis.fetch = vi.fn(async () => respons({}));

        await openSegmentStream(1, { start: 5, end: 9 });

        expect(globalThis.fetch.mock.calls[0][0]).toBe(`${URL_MT}/segment/1`);
    });
});

describe('gagalnya jatuh ke Bot API, tidak menggantung', () => {
    it('service menolak (5xx) -> lanjut ke Bot API', async () => {
        // fetch pertama = MTProto menolak; sesudah itu jalur Bot API mengambil alih dan melempar
        // (token tidak ada di mesin tes). Yang dijaga: ia MELEWATI MTProto, bukan berhenti di situ.
        globalThis.fetch = vi.fn(async () => respons({ status: 502, contentRange: null, contentLength: null, body: null }));

        await expect(openSegmentStream(1, { start: 5, end: 9 })).rejects.toThrow(/Token bot|Telegram|file_id/i);
    });

    it('service tidak terjangkau (fetch melempar) -> lanjut ke Bot API', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });

        await expect(openSegmentStream(1, { start: 5, end: 9 })).rejects.toThrow(/Token bot|Telegram|file_id/i);
    });
});

describe('gerbang tetap dihormati', () => {
    it('tanpa env, MTProto tidak pernah dipanggil', async () => {
        delete process.env.TG_ARCHIVE_MTPROTO_URL;
        globalThis.fetch = vi.fn(async () => respons({}));

        // Langsung ke Bot API (melempar di mesin tes). Yang penting: fetch ke service MTProto
        // TIDAK terjadi.
        await expect(openSegmentStream(1, { start: 5, end: 9 })).rejects.toThrow();
        const keSvc = globalThis.fetch.mock.calls.filter(([u]) => String(u).includes('8093'));
        expect(keSvc.length).toBe(0);
    });

    it('berkas yang masih di disk tidak menyentuh MTProto sama sekali', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-'));
        const berkas = path.join(dir, 'seg.mp4');
        fs.writeFileSync(berkas, Buffer.from('0123456789'));
        rows.upload.local_path = berkas;
        rows.upload.file_size = 10;
        globalThis.fetch = vi.fn(async () => { throw new Error('MTProto disentuh padahal ada di disk'); });

        const hasil = await openSegmentStream(1, { start: 2, end: 5 });

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(hasil.totalSize).toBe(10);
        // Tutup stream sebelum menghapus dir, kalau tidak fd yang terbuka malas memicu ENOENT async.
        hasil.stream.on('error', () => {});
        hasil.stream.destroy();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('prefetch ke transit dir', () => {
    /*
     * Janji fitur: irisan pertama dilayani live dari MTProto, lalu salinan utuh mendarat di
     * CACHE_DIR di latar — request BERIKUTNYA untuk segmen yang sama dibaca dari disk tanpa
     * menyentuh Telegram sama sekali.
     */
    const ISI_PENUH = Buffer.from('0123456789abcdefghijABCDEFGHIJ'); // 30 byte

    function streamWeb(buf) {
        return new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(buf));
                controller.close();
            },
        });
    }

    it('menarik berkas utuh di latar setelah irisan live tersaji', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-cache-'));
        cacheDirValue = dir;
        rows.upload = { ...rows.upload, segment_id: 7, file_size: ISI_PENUH.length, file_id: 'FID7', local_path: null };
        globalThis.fetch = vi.fn(async () => respons({ body: streamWeb(ISI_PENUH) }));

        await openSegmentStream(7, { start: 5, end: 9 });
        // Prefetch adalah fire-and-forget — beri event loop satu giliran untuk menyelesaikannya.
        for (let i = 0; i < 20 && !fs.existsSync(path.join(dir, 'rafnet-mtproto-seg-7.mp4')); i += 1) {
            await new Promise((resolve) => setImmediate(resolve));
        }

        const file = path.join(dir, 'rafnet-mtproto-seg-7.mp4');
        expect(fs.existsSync(file)).toBe(true);
        expect(fs.readFileSync(file).equals(ISI_PENUH)).toBe(true);
        // Prefetch meminta TANPA Range — seluruh berkas, bukan irisan.
        const prefetchCall = globalThis.fetch.mock.calls.find(([, opt]) => opt === undefined || !opt.headers?.Range);
        expect(prefetchCall).toBeTruthy();

        fs.rmSync(dir, { recursive: true, force: true });
        cacheDirValue = '/var/lib/telegram-bot-api';
    });

    it('request berikutnya membaca dari disk — Telegram tidak disentuh lagi', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-cache-'));
        cacheDirValue = dir;
        fs.writeFileSync(path.join(dir, 'rafnet-mtproto-seg-8.mp4'), ISI_PENUH);
        rows.upload = { ...rows.upload, segment_id: 8, file_size: ISI_PENUH.length, file_id: 'FID8', local_path: null };
        globalThis.fetch = vi.fn(async () => { throw new Error('Telegram disentuh padahal prefetch sudah mendarat'); });

        const hasil = await openSegmentStream(8, { start: 2, end: 5 });

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(hasil.totalSize).toBe(ISI_PENUH.length);
        expect(hasil.range).toEqual({ start: 2, end: 5 });
        hasil.stream.on('error', () => {});
        hasil.stream.destroy();

        fs.rmSync(dir, { recursive: true, force: true });
        cacheDirValue = '/var/lib/telegram-bot-api';
    });
});
