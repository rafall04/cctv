/*
 * Purpose: Play one archived CCTV segment at the shape it was actually recorded in, instead of
 *          forcing every camera into a 16:9 box.
 * Caller: pages/TelegramArchiveLibrary.jsx (inside a Modal).
 * Deps: React only.
 * MainFuncs: ArchiveVideo.
 * SideEffects: Requests fullscreen on the wrapper element when asked.
 *
 * Why the aspect ratio is measured rather than declared: this fleet records at FOUR different
 * shapes — 1280x720 and 1920x1080 (1.78), 704x576 (1.22), and 640x480 (1.33). A hardcoded
 * `aspect-video` fits only the 16:9 cameras; on a 704x576 camera it throws away 31% of the width
 * as black pillarbox, which on a phone is most of the picture. So the box takes its ratio from the
 * decoded stream via loadedmetadata.
 *
 * A ratio is still reserved BEFORE metadata arrives (FALLBACK_RATIO). Sizing from zero would let
 * the dialog jump the moment the first frame decodes — the layout shift the reserve exists to
 * prevent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { readRecordingMutePreference, writeRecordingMutePreference } from '../../../utils/recordingAudio';

// Only used for the instant between opening and the first metadata event. 16:9 is the widest shape
// in the fleet, so the box can only ever shrink to fit — it never has to grow and shove the
// surrounding chrome down.
const FALLBACK_RATIO = 16 / 9;

function FullscreenIcon({ active }) {
    return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            {active ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            )}
        </svg>
    );
}

export default function ArchiveVideo({ src, segmentId, onFullscreenChange }) {
    const wrapperRef = useRef(null);
    const [ratio, setRatio] = useState(FALLBACK_RATIO);
    const [isFullscreen, setIsFullscreen] = useState(false);
    // Recordings now carry the camera microphone, and `autoPlay` on an element with a real
    // audio track is exactly what the browser autoplay policy blocks. `key={segmentId}`
    // remounts this element on every clip, so an unmuted default would mean a fresh block
    // per segment. Start from the remembered preference (muted unless asked otherwise) and
    // keep it in step with the native control below.
    const [isMuted, setIsMuted] = useState(readRecordingMutePreference);

    // Reset per segment: without this, switching clips keeps the previous camera's ratio until the
    // new metadata lands, which is a visible wrong-shaped flash between two different cameras.
    useEffect(() => {
        setRatio(FALLBACK_RATIO);
    }, [segmentId]);

    const handleMetadata = useCallback((event) => {
        const { videoWidth, videoHeight } = event.currentTarget;
        if (videoWidth > 0 && videoHeight > 0) {
            setRatio(videoWidth / videoHeight);
        }
    }, []);

    // The guard drops the echo of React writing `muted` back onto the element, which fires
    // volumechange as well and otherwise costs a render per toggle for no news.
    const handleVolumeChange = useCallback((event) => {
        const muted = event.currentTarget.muted;
        if (muted === isMuted) return;
        setIsMuted(muted);
        writeRecordingMutePreference(muted);
    }, [isMuted]);

    // `autoPlay` alone gives no way to observe a refusal. Asking explicitly means an unmuted
    // preference degrades to a paused player with visible controls — the operator presses
    // play — rather than to a clip that silently never starts.
    const handleCanPlay = useCallback((event) => {
        // `?.catch?.` and not `.catch(...)`: play() is only guaranteed to return a promise in
        // modern browsers, and jsdom's returns nothing at all — a bare .catch() there turns a
        // best-effort nudge into a TypeError thrown out of an event handler.
        event.currentTarget.play?.()?.catch?.(() => {
            // Blocked by the autoplay policy. Controls are rendered; nothing else to do.
        });
    }, []);

    // Fullscreen can also be left with Escape or the browser's own control, so the button's label
    // has to follow the DOM rather than a local guess about what the click did.
    useEffect(() => {
        const sync = () => {
            const active = document.fullscreenElement === wrapperRef.current;
            setIsFullscreen(active);
            onFullscreenChange?.(active);
        };
        document.addEventListener('fullscreenchange', sync);
        return () => document.removeEventListener('fullscreenchange', sync);
    }, [onFullscreenChange]);

    const toggleFullscreen = useCallback(async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await wrapperRef.current?.requestFullscreen?.();
            }
        } catch {
            // iOS Safari refuses fullscreen on a container; the video's own native control still
            // works there, so a failure here is not worth interrupting playback over.
        }
    }, []);

    return (
        <div className="relative">
            <div
                ref={wrapperRef}
                className="flex w-full items-center justify-center bg-black"
                // Inline because the value is measured at runtime — Tailwind cannot express an
                // arbitrary computed ratio without generating a class per camera shape.
                style={isFullscreen ? undefined : { aspectRatio: String(ratio) }}
            >
                <video
                    key={segmentId}
                    src={src}
                    controls
                    autoPlay
                    muted={isMuted}
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={handleMetadata}
                    onVolumeChange={handleVolumeChange}
                    onCanPlay={handleCanPlay}
                    // object-contain is the browser default for video, but stating it means a later
                    // `object-cover` elsewhere cannot silently crop evidence footage.
                    className="h-full w-full object-contain"
                />
            </div>

            <IconButton
                label={isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
                size="sm"
                onClick={toggleFullscreen}
                // Sits over the video's top-right, clear of the native controls along the bottom.
                className="absolute right-2 top-2 bg-black/60 text-white hover:bg-black/80"
            >
                <FullscreenIcon active={isFullscreen} />
            </IconButton>
        </div>
    );
}
