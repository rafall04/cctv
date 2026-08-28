/*
Purpose: Lock the tab-hidden pause/resume behavior so backgrounded live tabs stop wasting
         bandwidth/CPU without ever overriding a manual user pause.
Caller: Frontend Vitest suite.
Deps: React Testing Library renderHook, usePauseOnHidden hook.
SideEffects: Toggles document.hidden and dispatches visibilitychange.
*/

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePauseOnHidden } from './usePauseOnHidden.js';

function setHidden(hidden) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

describe('usePauseOnHidden', () => {
    it('pauses a playing video when the tab hides and resumes it when visible again', () => {
        const video = {
            paused: false,
            play: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(() => { video.paused = true; }),
        };
        renderHook(() => usePauseOnHidden({ current: video }));

        setHidden(true);
        expect(video.pause).toHaveBeenCalledTimes(1);

        setHidden(false);
        expect(video.play).toHaveBeenCalledTimes(1);
    });

    it('does not resume a video the user paused themselves', () => {
        const video = {
            paused: true, // user already paused it
            play: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
        };
        renderHook(() => usePauseOnHidden({ current: video }));

        setHidden(true);
        expect(video.pause).not.toHaveBeenCalled(); // already paused → leave it

        setHidden(false);
        expect(video.play).not.toHaveBeenCalled(); // we never paused it → don't resume
    });

    it('is a no-op when the ref holds no video element (MJPEG / embed)', () => {
        renderHook(() => usePauseOnHidden({ current: null }));
        expect(() => setHidden(true)).not.toThrow();
        expect(() => setHidden(false)).not.toThrow();
    });

    it('removes the visibilitychange listener on unmount', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        const { unmount } = renderHook(() => usePauseOnHidden({
            current: { paused: false, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() },
        }));

        unmount();
        expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
        removeSpy.mockRestore();
    });
});

/*
 * Kembali dari latar belakang adalah tempat kebijakan autoplay paling sering menolak, dan
 * penolakannya datang sebagai promise yang ditolak - bukan galat. Dengan video.play() mentah,
 * penolakan itu hanya di-catch dan dibuang, jadi pengunjung kembali ke bingkai beku tanpa satu
 * pun petunjuk. VideoPopup punya requestVideoPlay yang mengenali NotAllowedError dan memunculkan
 * prompt ketuk-untuk-memutar; hook ini harus memakainya, bukan memutar sendiri.
 */
describe('melanjutkan lewat cara-memutar milik pemanggil', () => {
    it('memakai resumePlay dan TIDAK memanggil video.play() sendiri', () => {
        const video = { paused: false, pause: vi.fn(function () { this.paused = true; }), play: vi.fn() };
        const resumePlay = vi.fn();
        const videoRef = { current: video };

        renderHook(() => usePauseOnHidden(videoRef, resumePlay));

        setHidden(true);
        expect(video.pause).toHaveBeenCalledTimes(1);

        setHidden(false);
        expect(resumePlay, 'penolakan autoplay akan hilang tanpa suara').toHaveBeenCalledWith(video);
        expect(video.play, 'play() mentah melewati prompt ketuk-untuk-memutar').not.toHaveBeenCalled();
    });

    it('tetap memutar sendiri bila pemanggil tidak memberi cara-memutar', () => {
        const video = { paused: false, pause: vi.fn(function () { this.paused = true; }), play: vi.fn(() => Promise.resolve()) };
        renderHook(() => usePauseOnHidden({ current: video }));

        setHidden(true);
        setHidden(false);

        expect(video.play).toHaveBeenCalledTimes(1);
    });

    it('tidak melanjutkan video yang dijeda PENGGUNA, walau ada resumePlay', () => {
        const video = { paused: true, pause: vi.fn(), play: vi.fn() };
        const resumePlay = vi.fn();
        renderHook(() => usePauseOnHidden({ current: video }, resumePlay));

        setHidden(true);
        setHidden(false);

        expect(video.pause).not.toHaveBeenCalled();
        expect(resumePlay).not.toHaveBeenCalled();
    });

    /*
     * MELANJUTKAN DI TEPI-LIVE — keluhan 2026-08-28: keluar 5-10 menit, kembali, gambarnya beku,
     * tanpa satu pun pesan.
     *
     * Menjeda saat tersembunyi itu benar; melanjutkan DI TEMPAT YANG SAMA tidak. Playhead
     * tertinggal sepuluh menit dan segmen di posisi itu sudah keluar dari jendela playlist, jadi
     * play() melanjutkan ke tempat yang datanya sudah tidak ada. Diamnya pun bukan kebetulan:
     * livePictureWatch sengaja tidak memvonis video yang PAUSED.
     */
    const videoHidup = () => ({
        paused: false,
        currentTime: 12,
        pause: vi.fn(function () { this.paused = true; }),
        play: vi.fn(() => Promise.resolve()),
    });

    it('MELOMPAT ke tepi-live saat kembali, bukan melanjutkan di posisi basi', () => {
        const video = videoHidup();
        const hls = { liveSyncPosition: 600, startLoad: vi.fn() };
        renderHook(() => usePauseOnHidden({ current: video }, undefined, { current: hls }));

        setHidden(true);
        setHidden(false);

        expect(video.currentTime, 'melanjutkan di posisi yang segmennya sudah hilang').toBe(600);
        expect(hls.startLoad, 'seek saja tidak cukup: hls stopLoad() pada tiap galat fatal').toHaveBeenCalledWith(600);
        expect(video.play).toHaveBeenCalled();
    });

    it('TIDAK melompat ketika masih di tepi - tersembunyi sekejap', () => {
        const video = videoHidup();
        video.currentTime = 599;
        const hls = { liveSyncPosition: 600, startLoad: vi.fn() };
        renderHook(() => usePauseOnHidden({ current: video }, undefined, { current: hls }));

        setHidden(true);
        setHidden(false);

        expect(video.currentTime, 'membuang buffer sah dan berkedip percuma').toBe(599);
        expect(hls.startLoad).not.toHaveBeenCalled();
        expect(video.play).toHaveBeenCalled();
    });

    it('tanpa hlsRef tetap bekerja seperti sebelumnya (MJPEG / embed / HLS native)', () => {
        const video = videoHidup();
        renderHook(() => usePauseOnHidden({ current: video }));

        setHidden(true);
        setHidden(false);

        expect(video.currentTime).toBe(12);
        expect(video.play).toHaveBeenCalled();
    });

    it('lompatannya memakai resumePlay pemanggil, bukan play() mentah', () => {
        // Supaya penolakan autoplay tetap memunculkan prompt ketuk-untuk-memutar dan bukan diam.
        const video = videoHidup();
        const hls = { liveSyncPosition: 600, startLoad: vi.fn() };
        const resumePlay = vi.fn();
        renderHook(() => usePauseOnHidden({ current: video }, resumePlay, { current: hls }));

        setHidden(true);
        setHidden(false);

        expect(video.currentTime).toBe(600);
        expect(resumePlay).toHaveBeenCalledWith(video);
        expect(video.play).not.toHaveBeenCalled();
    });
});
