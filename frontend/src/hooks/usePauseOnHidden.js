import { useEffect } from 'react';

/**
 * Pause a <video> element while the browser tab is hidden, and resume it when the tab becomes
 * visible again.
 *
 * Why: a backgrounded tab keeps decoding and (for HLS) buffering live video for nothing — wasting
 * the viewer's bandwidth, CPU and battery. CCTV streams are always muted, so there is no audio to
 * lose by pausing. On resume the component's existing live-edge snap (and HLS.js live recovery)
 * pulls playback back to the live edge.
 *
 * Safety: we only auto-resume a stream that WE paused (one that was playing when the tab hid), so a
 * manual user pause is never overridden. No-op when the ref holds no <video> (e.g. MJPEG/embed tiles).
 *
 * @param {{ current: HTMLVideoElement | null }} videoRef - ref to the <video> element to manage
 */
export function usePauseOnHidden(videoRef) {
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
                // Tab foregrounded: resume only what we paused. The 'play' event re-triggers the
                // component's snap-to-live so we don't sit on a stale buffer.
                pausedByUs = false;
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
    }, [videoRef]);
}

export default usePauseOnHidden;
