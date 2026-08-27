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
import { resumeAtLiveEdgeOrFail, MAX_RESUMES_PER_EPISODE } from './liveEdgeRecovery.js';

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
