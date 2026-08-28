/*
 * Purpose: Kunci jawaban terhadap galat FATAL hls.js sesudah stream terbukti hidup.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Sebelumnya kedua pemutar membuang galat ini lewat `if (... || isLive) return;`, dan karena
 * hls.js sudah memanggil stopLoad() lebih dulu, gerbang itu membuang satu-satunya kesempatan
 * tersisa untuk menghidupkan pemuatan kembali. Hasilnya bingkai beku di bawah lencana LIVE.
 *
 * Setiap tes di sini dipasangkan dengan mutasi yang dibunuhnya - tes yang tidak bisa gagal
 * adalah teater, dan proyek ini sudah pernah tertipu olehnya.
 */

import { describe, expect, it, vi } from 'vitest';
import { resumeAtLiveEdge, resumeAtLiveEdgeOrFail, LIVE_SNAP_TOLERANCE_S, MAX_RESUMES_PER_EPISODE, PLAYHEAD_FROZEN } from './liveEdgeRecovery.js';

const TIPE = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' };

function buat({ liveSyncPosition = 42, frames = 100 } = {}) {
    const hls = {
        liveSyncPosition,
        startLoad: vi.fn(),
        recoverMediaError: vi.fn(),
    };
    const video = {
        currentTime: 10,
        getVideoPlaybackQuality: frames === null ? undefined : () => ({ totalVideoFrames: frames }),
    };
    const onGiveUp = vi.fn();
    const requestPlay = vi.fn();
    return { hls, video, onGiveUp, requestPlay,
        ctx: { hls, video, HlsErrorTypes: TIPE, requestPlay, onGiveUp } };
}

const fatal = (details, type = TIPE.NETWORK_ERROR) => ({ fatal: true, details, type });

describe('galat non-fatal tidak pernah disentuh', () => {
    it('mengabaikan galat non-fatal sepenuhnya', () => {
        const t = buat();
        resumeAtLiveEdgeOrFail({ fatal: false, details: 'bufferNudgeOnStall', type: TIPE.MEDIA_ERROR }, t.ctx);

        expect(t.hls.startLoad).not.toHaveBeenCalled();
        expect(t.hls.recoverMediaError).not.toHaveBeenCalled();
        expect(t.onGiveUp).not.toHaveBeenCalled();
    });
});

describe('segmen kedaluwarsa: lanjutkan di live edge, jangan tampilkan panel', () => {
    it('menggeser playhead ke live edge dan menghidupkan pemuatan lagi', () => {
        const t = buat({ liveSyncPosition: 42 });
        resumeAtLiveEdgeOrFail(fatal('fragLoadError'), t.ctx);

        expect(t.video.currentTime).toBe(42);
        expect(t.onGiveUp).not.toHaveBeenCalled();
        expect(t.requestPlay).toHaveBeenCalledWith(t.video);
    });

    it('memanggil startLoad dengan target NUMERIK, bukan tanpa argumen', () => {
        // startLoad() = startLoad(-1), dan hls.js mengganti -1 dengan lastCurrentTime: posisi
        // basi yang barusan 404. Itu resep 404 berulang.
        const t = buat({ liveSyncPosition: 42 });
        resumeAtLiveEdgeOrFail(fatal('fragLoadError'), t.ctx);

        expect(t.hls.startLoad).toHaveBeenCalledTimes(1);
        expect(t.hls.startLoad.mock.calls[0]).toEqual([42]);
    });

    // Meneruskan `undefined` ke buat() justru MEMICU nilai default parameternya - jebakan yang
    // sempat membuat tes ini lulus karena alasan yang salah. Disetel sesudah objeknya dibuat.
    for (const [nama, nilai] of [['undefined', undefined], ['null', null], ['NaN', NaN]]) {
        it(`menyerah kalau live edge ${nama}, bukan menyetel currentTime = NaN`, () => {
            const t = buat();
            t.hls.liveSyncPosition = nilai;
            resumeAtLiveEdgeOrFail(fatal('fragLoadError'), t.ctx);

            expect(t.video.currentTime).toBe(10);
            expect(t.hls.startLoad).not.toHaveBeenCalled();
            expect(t.onGiveUp).toHaveBeenCalledTimes(1);
        });
    }
});

describe('playlist hilang = sumber mati: langsung beri tahu, jangan buang percobaan', () => {
    for (const detail of ['levelLoadError', 'manifestLoadError', 'levelEmptyError']) {
        it(`${detail} langsung divonis`, () => {
            const t = buat();
            resumeAtLiveEdgeOrFail(fatal(detail), t.ctx);

            expect(t.onGiveUp).toHaveBeenCalledTimes(1);
            expect(t.hls.startLoad).not.toHaveBeenCalled();
        });
    }
});

describe('anggaran percobaan', () => {
    it(`melanjutkan ${MAX_RESUMES_PER_EPISODE}x lalu menyerah, bukan selamanya`, () => {
        const t = buat({ frames: 100 });     // bingkai TIDAK maju: tak ada bukti kemajuan
        for (let i = 0; i < MAX_RESUMES_PER_EPISODE + 1; i += 1) {
            resumeAtLiveEdgeOrFail(fatal('fragLoadError'), t.ctx);
        }

        expect(t.hls.startLoad).toHaveBeenCalledTimes(MAX_RESUMES_PER_EPISODE);
        expect(t.onGiveUp).toHaveBeenCalledTimes(1);
    });

    it('mengisi ulang anggaran ketika bingkai benar-benar MAJU', () => {
        let frames = 100;
        const t = buat();
        t.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });

        for (let i = 0; i < MAX_RESUMES_PER_EPISODE; i += 1) {
            resumeAtLiveEdgeOrFail(fatal('fragLoadError'), t.ctx);
        }
        expect(t.onGiveUp).not.toHaveBeenCalled();

        frames = 500;                        // dekodernya menghasilkan gambar baru: itu bukti
        resumeAtLiveEdgeOrFail(fatal('fragLoadError'), t.ctx);

        expect(t.onGiveUp, 'stream yang pulih tetap kena panel').not.toHaveBeenCalled();
        expect(t.hls.startLoad).toHaveBeenCalledTimes(MAX_RESUMES_PER_EPISODE + 1);
    });

    it('penghitung yang MUNDUR bukan bukti kemajuan - anggaran tidak diisi ulang', () => {
        /*
         * Pipeline media dibangun ulang mereset totalVideoFrames ke nol (terukur di Chromium:
         * 1636 -> 0). Di livePictureWatch itu berarti "dekoder baru, jangan divonis"; DI SINI ia
         * bukan bukti ada gambar baru. Asimetri itu disengaja dan dikunci di sini.
         */
        let frames = 500;
        const t = buat();
        t.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });

        resumeAtLiveEdgeOrFail(fatal('fragLoadError'), t.ctx);
        frames = 0;
        for (let i = 0; i < MAX_RESUMES_PER_EPISODE; i += 1) {
            resumeAtLiveEdgeOrFail(fatal('fragLoadError'), t.ctx);
        }

        expect(t.onGiveUp).toHaveBeenCalledTimes(1);
    });

    it('browser yang tidak melaporkan bingkai tetap habis anggarannya, tanpa melempar', () => {
        const t = buat({ frames: null });     // Safari tanpa getVideoPlaybackQuality
        for (let i = 0; i < MAX_RESUMES_PER_EPISODE + 1; i += 1) {
            resumeAtLiveEdgeOrFail(fatal('fragLoadError'), t.ctx);
        }

        expect(t.hls.startLoad).toHaveBeenCalledTimes(MAX_RESUMES_PER_EPISODE);
        expect(t.onGiveUp).toHaveBeenCalledTimes(1);
    });
});

describe('media error dibangun ulang dekodernya, bukan dimuat ulang segmennya', () => {
    it('memanggil recoverMediaError dan TIDAK menggeser playhead', () => {
        const t = buat();
        resumeAtLiveEdgeOrFail(fatal('bufferStalledError', TIPE.MEDIA_ERROR), t.ctx);

        expect(t.hls.recoverMediaError).toHaveBeenCalledTimes(1);
        expect(t.hls.startLoad).not.toHaveBeenCalled();
        expect(t.video.currentTime).toBe(10);
    });
});

describe('tidak ada galat fatal yang dibuang diam-diam', () => {
    /*
     * Sapuan ini adalah penjaga sesungguhnya: SETIAP galat fatal harus berakhir - dilanjutkan
     * atau divonis. Satu saja yang lolos tanpa jawaban = bingkai beku permanen, yaitu persis bug
     * yang modul ini perbaiki. `return` baru apa pun yang membuang sebuah kasus akan memerahkannya.
     */
    const SEMUA = [
        'fragLoadError', 'fragLoadTimeOut', 'fragParsingError', 'fragDecryptError',
        'levelLoadError', 'levelLoadTimeOut', 'levelEmptyError', 'manifestLoadError',
        'manifestLoadTimeOut', 'manifestParsingError', 'bufferStalledError',
        'bufferAppendError', 'bufferFullError', 'internalException', 'keyLoadError',
    ];

    for (const detail of SEMUA) {
        for (const type of [TIPE.NETWORK_ERROR, TIPE.MEDIA_ERROR]) {
            it(`menjawab ${detail} (${type})`, () => {
                const t = buat();
                resumeAtLiveEdgeOrFail(fatal(detail, type), t.ctx);

                const dijawab = t.hls.startLoad.mock.calls.length
                    + t.hls.recoverMediaError.mock.calls.length
                    + t.onGiveUp.mock.calls.length;
                expect(dijawab, 'galat fatal dibuang tanpa jawaban').toBeGreaterThanOrEqual(1);
            });
        }
    }

    it('menyerah dengan aman kalau instans hls sudah hilang', () => {
        const onGiveUp = vi.fn();
        expect(() => resumeAtLiveEdgeOrFail(fatal('fragLoadError'), { hls: null, video: null, onGiveUp }))
            .not.toThrow();
        expect(onGiveUp).toHaveBeenCalledTimes(1);
    });
});

/*
 * Playhead beku dilaporkan watchdog gambar-hidup, bukan hls.js - dan ia punya DUA bentuk yang
 * butuh obat berbeda. Kalau datanya sudah ada di depan dan playhead tetap diam, yang macet
 * dekodernya: memuat ulang segmen tidak menolong sama sekali, dekodernya yang harus dibangun
 * ulang. Kalau tidak ada data di depan, itu kelaparan: pemuatannya yang harus dihidupkan.
 */
describe('playhead beku dibedakan: dekoder macet lawan kelaparan data', () => {
    const dgnBuffer = (mulai, akhir) => ({
        currentTime: 10,
        buffered: { length: 1, start: () => mulai, end: () => akhir },
        getVideoPlaybackQuality: () => ({ totalVideoFrames: 100, droppedVideoFrames: 0 }),
    });

    it('data ADA di depan -> bangun ulang dekoder, jangan geser playhead', () => {
        const hls = { liveSyncPosition: 42, startLoad: vi.fn(), recoverMediaError: vi.fn() };
        const video = dgnBuffer(0, 25);          // 15 detik di depan playhead
        resumeAtLiveEdgeOrFail({ fatal: true, details: PLAYHEAD_FROZEN }, { hls, video });

        expect(hls.recoverMediaError).toHaveBeenCalledTimes(1);
        expect(hls.startLoad).not.toHaveBeenCalled();
        expect(video.currentTime).toBe(10);
    });

    it('TIDAK ada data di depan -> hidupkan pemuatan di live edge', () => {
        const hls = { liveSyncPosition: 42, startLoad: vi.fn(), recoverMediaError: vi.fn() };
        const video = dgnBuffer(0, 10);          // playhead persis di ujung buffer
        resumeAtLiveEdgeOrFail({ fatal: true, details: PLAYHEAD_FROZEN }, { hls, video });

        expect(hls.startLoad).toHaveBeenCalledWith(42);
        expect(hls.recoverMediaError).not.toHaveBeenCalled();
        expect(video.currentTime).toBe(42);
    });

    it('sisa buffer sekejap (<1 dtk) tetap dibaca sebagai kelaparan', () => {
        const hls = { liveSyncPosition: 42, startLoad: vi.fn(), recoverMediaError: vi.fn() };
        const video = dgnBuffer(0, 10.6);        // 0,6 detik: bukan bukti dekoder macet
        resumeAtLiveEdgeOrFail({ fatal: true, details: PLAYHEAD_FROZEN }, { hls, video });

        expect(hls.startLoad).toHaveBeenCalledWith(42);
        expect(hls.recoverMediaError).not.toHaveBeenCalled();
    });

    it('tanpa buffer sama sekali tidak melempar', () => {
        const hls = { liveSyncPosition: 42, startLoad: vi.fn(), recoverMediaError: vi.fn() };
        const video = { currentTime: 10, buffered: { length: 0 },
            getVideoPlaybackQuality: () => ({ totalVideoFrames: 100, droppedVideoFrames: 0 }) };

        expect(() => resumeAtLiveEdgeOrFail({ fatal: true, details: PLAYHEAD_FROZEN }, { hls, video })).not.toThrow();
        expect(hls.startLoad).toHaveBeenCalledWith(42);
    });

    it('anggaran yang sama berlaku: beku berulang akhirnya divonis', () => {
        const hls = { liveSyncPosition: 42, startLoad: vi.fn(), recoverMediaError: vi.fn() };
        const onGiveUp = vi.fn();
        const video = dgnBuffer(0, 10);
        for (let i = 0; i < MAX_RESUMES_PER_EPISODE + 1; i += 1) {
            video.currentTime = 10;
            resumeAtLiveEdgeOrFail({ fatal: true, details: PLAYHEAD_FROZEN }, { hls, video, onGiveUp });
        }

        expect(onGiveUp).toHaveBeenCalledTimes(1);
    });
});

/*
 * MELANJUTKAN DI TEPI-LIVE — akar keluhan 2026-08-28 ("keluar 5-10 menit, kembali, beku").
 *
 * usePauseOnHidden menjeda video saat tab tersembunyi dan memanggil play() saat kembali. Untuk
 * siaran LANGSUNG itu tidak cukup: sesudah sepuluh menit di latar belakang, playhead tertinggal
 * sepuluh menit dan segmen di posisi itu sudah lama keluar dari jendela playlist. play()
 * melanjutkan ke tempat yang datanya SUDAH TIDAK ADA, dan hasilnya bingkai beku.
 *
 * Komentar di dalam usePauseOnHidden sendiri sudah mencatat bahwa tidak ada yang menarik kamera
 * internal ke tepi-live. Catatan itu benar selama berbulan-bulan; ini isinya.
 */
describe('melanjutkan di tepi-live sesudah kembali dari latar belakang', () => {
    it('MELOMPAT ke tepi-live ketika playhead tertinggal jauh', () => {
        const t = buat({ liveSyncPosition: 600 });
        t.video.currentTime = 12;      // ditinggalkan sepuluh menit lalu

        resumeAtLiveEdge(t.video, t.hls, t.requestPlay);

        expect(t.video.currentTime, 'melanjutkan di posisi basi yang segmennya sudah hilang').toBe(600);
        expect(t.requestPlay).toHaveBeenCalledWith(t.video);
    });

    it('memanggil startLoad, bukan hanya seek', () => {
        // hls.js memanggil stopLoad() pada SETIAP galat fatal, dan galat itu bisa saja sudah
        // terjadi selagi tab tersembunyi. Tanpa startLoad, seek-nya berhasil dan tidak ada yang
        // pernah mengambil segmennya.
        const t = buat({ liveSyncPosition: 600 });
        t.video.currentTime = 12;

        resumeAtLiveEdge(t.video, t.hls, t.requestPlay);

        expect(t.hls.startLoad).toHaveBeenCalledWith(600);
    });

    it('TIDAK melompat ketika masih di tepi - tab tersembunyi sekejap', () => {
        // Melompat di sini akan membuang buffer yang masih sah dan menimbulkan kedipan percuma.
        const t = buat({ liveSyncPosition: 600 });
        t.video.currentTime = 600 - (LIVE_SNAP_TOLERANCE_S - 1);

        resumeAtLiveEdge(t.video, t.hls, t.requestPlay);

        expect(t.video.currentTime).not.toBe(600);
        expect(t.hls.startLoad).not.toHaveBeenCalled();
        expect(t.requestPlay, 'tetap harus diputar').toHaveBeenCalled();
    });

    it('TETAP memutar walaupun tidak ada instans hls (MJPEG / embed / native HLS)', () => {
        const t = buat();

        resumeAtLiveEdge(t.video, null, t.requestPlay);

        expect(t.requestPlay).toHaveBeenCalledWith(t.video);
    });

    it('tidak menyentuh playhead ketika tepi-live tidak diketahui', () => {
        for (const buruk of [undefined, null, NaN, Infinity]) {
            const t = buat();
            t.hls.liveSyncPosition = buruk;
            t.video.currentTime = 12;

            resumeAtLiveEdge(t.video, t.hls, t.requestPlay);

            expect(t.video.currentTime, `liveSyncPosition=${String(buruk)}`).toBe(12);
            expect(t.requestPlay).toHaveBeenCalled();
        }
    });

    it('seek yang DITOLAK tetap tidak menghalangi pemutaran', () => {
        // Sebagian peramban melempar saat currentTime diset pada keadaan tertentu. Kalau itu
        // menghentikan play(), perbaikan ini justru menciptakan bingkai beku yang baru.
        const t = buat({ liveSyncPosition: 600 });
        Object.defineProperty(t.video, 'currentTime', {
            get: () => 12,
            set: () => { throw new Error('InvalidStateError'); },
        });

        expect(() => resumeAtLiveEdge(t.video, t.hls, t.requestPlay)).not.toThrow();
        expect(t.requestPlay).toHaveBeenCalled();
    });

    it('tanpa elemen video tidak melakukan apa-apa dan tidak melempar', () => {
        const t = buat();

        expect(() => resumeAtLiveEdge(null, t.hls, t.requestPlay)).not.toThrow();
        expect(t.requestPlay).not.toHaveBeenCalled();
    });
});
