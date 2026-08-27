/**
 * Purpose: Lock the recording player's media-error mapping — especially that the codec message it
 *          has always carried can now actually be reached.
 * Caller: Frontend Vitest suite.
 * Deps: pure mapping.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { classifyPlaybackMediaError } from './playbackMediaError.js';

describe('classifyPlaybackMediaError', () => {
    /*
     * REGRESSION: PlaybackVideo has shipped a `codec` error variant since the H.265 work, and
     * nothing could ever reach it — Playback mapped code 2 and sent every other code to null, the
     * generic "Video Tidak Tersedia". Dead UI, on the one case it was written for: this fleet
     * records mostly H.265, so a phone without an HEVC decoder is the common visitor, not the edge.
     */
    it('memetakan kode "tak bisa memutar berkas ini" ke pesan codec', () => {
        expect(classifyPlaybackMediaError({ code: 3 })).toBe('codec'); // MEDIA_ERR_DECODE
        expect(classifyPlaybackMediaError({ code: 4 })).toBe('codec'); // SRC_NOT_SUPPORTED
    });

    it('kode jaringan tetap jaringan', () => {
        expect(classifyPlaybackMediaError({ code: 2 })).toBe('network');
    });

    /* ABORTED biasanya kode kita sendiri berpindah segmen — bukan vonis untuk penonton. */
    it('ABORTED tetap generik, bukan vonis codec', () => {
        expect(classifyPlaybackMediaError({ code: 1 })).toBe(null);
    });

    it('tidak tersinggung oleh error kosong', () => {
        expect(classifyPlaybackMediaError(null)).toBe(null);
        expect(classifyPlaybackMediaError(undefined)).toBe(null);
        expect(classifyPlaybackMediaError({})).toBe(null);
        expect(classifyPlaybackMediaError({ code: 99 })).toBe(null);
    });
});

/*
 * Bentuk yang sama persis dengan bug pemutar live 2026-08-26: menyimpulkan "browser Anda tidak
 * mendukung H.265" dari perangkat yang BARU SAJA mendekode berkas itu. Untuk rekaman, vonis itu
 * menyuruh pengunjung pindah browser padahal browsernya jelas mampu.
 */
describe('kode DECODE sesudah bingkai terbukti ter-decode bukan vonis codec', () => {
    const videoDengan = (frames) => ({ getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }) });

    it('menjadi "stalled" kalau bingkai sudah pernah ter-decode', () => {
        expect(classifyPlaybackMediaError({ code: 3 }, videoDengan(240))).toBe('stalled');
    });

    it('tetap "codec" kalau tidak satu bingkai pun pernah ter-decode', () => {
        expect(classifyPlaybackMediaError({ code: 3 }, videoDengan(0))).toBe('codec');
    });

    it('tetap "codec" kalau browsernya tidak melaporkan penghitung sama sekali', () => {
        // null berarti TIDAK TAHU, dan tidak tahu tidak boleh dipakai membantah vonis.
        expect(classifyPlaybackMediaError({ code: 3 }, {})).toBe('codec');
        expect(classifyPlaybackMediaError({ code: 3 }, undefined)).toBe('codec');
    });

    it('kode SRC_NOT_SUPPORTED tetap codec walau ada bingkai - sumbernya ditolak mentah', () => {
        expect(classifyPlaybackMediaError({ code: 4 }, videoDengan(240))).toBe('codec');
    });

    it('network tetap network', () => {
        expect(classifyPlaybackMediaError({ code: 2 }, videoDengan(240))).toBe('network');
    });
});
