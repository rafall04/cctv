/*
 * Purpose: Kunci perilaku watchdog gambar-hidup, terutama jalur SESUDAH vonis yang sebelumnya
 *          tidak punya tes sama sekali.
 * Caller: Vitest.
 * Deps: fake timers; elemen video tiruan.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Watchdog ini dipasang ke VideoPopup (pemutar utama publik) pada 2026-08-25. Sebelum itu ia
 * hanya menjaga ubin Multi-View. Cakupannya melompat dari satu ubin ke SETIAP penonton popup,
 * termasuk 182 kamera publik ber-origin pihak ketiga yang laju bingkainya di luar kendali kita.
 *
 * Jalur SEBELUM vonis sudah murah hati dan komentarnya sendiri menjelaskan alasannya: "Firing
 * early would turn a slow stream into a false 'unsupported' verdict." Jalur SESUDAH vonis dulu
 * melakukan persis kebalikannya — satu tick 500 ms tanpa bingkai baru langsung memvonis, jadi
 * sumber apa pun di bawah ~4 fps divonis "Codec tidak didukung browser" padahal gambarnya jalan.
 *
 * Proyek ini sudah pernah kena bentuk cacat yang sama (9785048: predikat codec yang menjawab
 * destroy() dan mematikan stream sehat), jadi kedua sisinya dikunci di sini: yang lambat harus
 * SELAMAT, yang mati harus tetap TERTANGKAP.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { startLivePictureWatch } from './livePictureWatch.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Video tiruan yang bisa digerakkan waktu dan bingkainya secara terpisah. */
function videoTiruan({ width = 1280, height = 720 } = {}) {
    return {
        readyState: 4,
        paused: false,
        currentTime: 0,
        videoWidth: width,
        videoHeight: height,
        buffered: { length: 1 },
        _frames: 0,
        getVideoPlaybackQuality() {
            return { totalVideoFrames: this._frames };
        },
    };
}

/** Majukan n tick 500 ms, memanggil `perTick(i)` sebelum masing-masing. */
function majukan(n, perTick) {
    for (let i = 0; i < n; i += 1) {
        perTick?.(i);
        vi.advanceTimersByTime(500);
    }
}

describe('watchdog gambar-hidup: sesudah vonis', () => {
    it('TIDAK memvonis sumber lambat yang beberapa tick-nya tanpa bingkai baru', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();
        const onPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onPicture, onNoPicture });

        // Tick pertama menetapkan vonis "hidup".
        vi.advanceTimersByTime(500);
        expect(onPicture).toHaveBeenCalledTimes(1);

        /*
         * Sumber 1 fps: waktu terus maju tiap tick, tapi bingkai baru hanya datang tiap tick
         * kedua. Inilah bentuk yang dulu langsung divonis pada tick pertama yang kosong.
         */
        majukan(8, (i) => {
            video.currentTime += 0.5;
            if (i % 2 === 1) video._frames += 1;
        });

        expect(onNoPicture).not.toHaveBeenCalled();
    });

    it('MASIH menangkap dekoder yang benar-benar mati — bingkai membeku selamanya', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        // Waktu terus berjalan, bingkai tidak pernah bertambah lagi: persis gejala perangkat
        // yang menerima byte H.265 lalu gagal men-decode-nya.
        majukan(12, () => {
            video.currentTime += 0.5;
        });

        expect(onNoPicture).toHaveBeenCalledTimes(1);
    });

    it('memaafkan jeda panjang lalu kembali normal, tanpa menyisakan vonis tertunda', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        // Empat tick sepi (2 detik) - di bawah ambang.
        majukan(4, () => {
            video.currentTime += 0.5;
        });
        expect(onNoPicture).not.toHaveBeenCalled();

        // Lalu bingkai datang lagi: hitungan sepi harus DIRESET, bukan diakumulasi.
        majukan(1, () => {
            video.currentTime += 0.5;
            video._frames += 1;
        });
        majukan(4, () => {
            video.currentTime += 0.5;
        });

        expect(onNoPicture).not.toHaveBeenCalled();
    });

    it('tidak memvonis saat waktu TIDAK maju (stream ter-pause / buffering)', () => {
        const video = videoTiruan();
        const onNoPicture = vi.fn();

        video._frames = 5;
        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);

        // currentTime diam: tidak ada yang bisa disimpulkan, jadi jangan simpulkan apa pun.
        majukan(20);

        expect(onNoPicture).not.toHaveBeenCalled();
    });

    it('diam saja bila browser tidak melaporkan jumlah bingkai sama sekali', () => {
        const video = videoTiruan();
        delete video.getVideoPlaybackQuality;
        const onNoPicture = vi.fn();

        startLivePictureWatch(video, { onNoPicture });
        vi.advanceTimersByTime(500);
        majukan(20, () => {
            video.currentTime += 0.5;
        });

        expect(onNoPicture).not.toHaveBeenCalled();
    });
});
