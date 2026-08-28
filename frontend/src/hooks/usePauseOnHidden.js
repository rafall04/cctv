import { useEffect } from 'react';
import { resumeAtLiveEdge } from '../utils/liveEdgeRecovery.js';

/**
 * Pause a <video> element while the browser tab is hidden, and resume it when the tab becomes
 * visible again.
 *
 * Why: a backgrounded tab keeps decoding and (for HLS) buffering live video for nothing — wasting
 * the viewer's bandwidth, CPU and battery. The LIVE players this hook serves are muted, so there is
 * no audio to lose by pausing. On resume the component's existing live-edge snap (and HLS.js live
 * recovery) pulls playback back to the live edge.
 *
 * Scope note: "muted" is a property of the live players (VideoPopup, MultiViewVideoItem), not of the
 * medium. RECORDINGS now carry the camera microphone, and their players let the viewer unmute — so
 * do not reuse this hook on a recording player without first deciding what silently pausing audio
 * mid-sentence should do.
 *
 * Safety: we only auto-resume a stream that WE paused (one that was playing when the tab hid), so a
 * manual user pause is never overridden. No-op when the ref holds no <video> (e.g. MJPEG/embed tiles).
 *
 * MELANJUTKANNYA lewat `resumePlay` milik pemanggil, bukan video.play() mentah. Kembali dari latar
 * belakang adalah tempat kebijakan autoplay paling sering menolak - dan penolakan itu datang
 * sebagai promise yang ditolak, bukan galat. Dengan play() mentah, penolakannya hanya di-catch dan
 * dibuang, sehingga pengunjung kembali ke bingkai beku tanpa satu pun petunjuk. VideoPopup punya
 * requestVideoPlay yang mengenali NotAllowedError dan memunculkan prompt ketuk-untuk-memutar;
 * itulah yang seharusnya dipakai di sini.
 *
 * MELANJUTKAN DI TEPI-LIVE, BUKAN DI TEMPAT IA DITINGGALKAN
 * ---------------------------------------------------------
 * Untuk siaran LANGSUNG, play() saja tidak cukup. Sesudah 5-10 menit di latar belakang playhead
 * tertinggal sepuluh menit, dan segmen di posisi itu sudah lama keluar dari jendela playlist —
 * jadi pemutaran dilanjutkan ke tempat yang datanya SUDAH TIDAK ADA. Yang dilihat pengunjung:
 * bingkai beku tanpa satu pun pesan, karena livePictureWatch sengaja tidak memvonis video yang
 * PAUSED. Dilaporkan 2026-08-28.
 *
 * Komentar di bawah sudah lama mencatat bahwa tidak ada yang menarik kamera internal ke tepi-live.
 * Catatan itu benar berbulan-bulan; sekarang hook inilah yang melakukannya, lewat `hlsRef`.
 * Ditaruh DI SINI dan bukan di tiap pemanggil supaya kedua permukaan live tidak bisa lagi
 * berbeda perilaku — MultiViewVideoItem dulu memanggil hook ini tanpa jalur lanjut sama sekali.
 *
 * @param {{ current: HTMLVideoElement | null }} videoRef - ref to the <video> element to manage
 * @param {(video: HTMLVideoElement) => void} [resumePlay] - cara memutar milik pemanggil
 * @param {{ current: object | null }} [hlsRef] - instans hls.js yang sedang berjalan, bila ada
 */
export function usePauseOnHidden(videoRef, resumePlay, hlsRef) {
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;

        let pausedByUs = false;

        const handleVisibilityChange = () => {
            const video = videoRef.current;
            if (!video) return;

            if (document.hidden) {
                // Tab backgrounded: stop decode/buffering, but only if it was actually playing
                // (don't fight a manual pause).
                if (!video.paused) {
                    video.pause();
                    pausedByUs = true;
                }
            } else if (pausedByUs) {
                /*
                 * Tab kembali ke depan: lanjutkan HANYA yang kami jeda.
                 *
                 * Komentar lama di sini menyatakan event 'play' memicu snap-to-live komponennya.
                 * Itu tidak benar: snap milik VideoPopup digerbang `!isExternal`, jadi untuk kamera
                 * internal - mayoritas armada ini - tidak ada yang menariknya ke live edge.
                 */
                pausedByUs = false;
                const play = resumePlay || ((el) => {
                    const p = el.play();
                    if (p && typeof p.catch === 'function') p.catch(() => { /* race — harmless */ });
                });
                resumeAtLiveEdge(video, hlsRef?.current, play);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [videoRef, resumePlay, hlsRef]);
}

export default usePauseOnHidden;
