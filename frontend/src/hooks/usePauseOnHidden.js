import { useEffect } from 'react';

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
 * @param {{ current: HTMLVideoElement | null }} videoRef - ref to the <video> element to manage
 * @param {(video: HTMLVideoElement) => void} [resumePlay] - cara memutar milik pemanggil
 */
export function usePauseOnHidden(videoRef, resumePlay) {
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
                if (resumePlay) {
                    resumePlay(video);
                    return;
                }
                const playPromise = video.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => { /* autoplay/resume race — harmless */ });
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [videoRef, resumePlay]);
}

export default usePauseOnHidden;
