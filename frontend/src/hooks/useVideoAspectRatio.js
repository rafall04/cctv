/*
 * Purpose: Measure a <video>'s true aspect ratio and keep it fresh, so a player can size its
 *          container to the CAMERA (no pillarbox on 4:3 / 16:10 / 9:16) instead of hardcoding 16:9.
 * Caller: TokenLivePlayer, CustomerLivePlayer (and any live player that wants VideoPopup-parity sizing).
 * Deps: utils/publicPopupLayout.getVideoAspectRatio (the shared measure + snap helper).
 * MainFuncs: useVideoAspectRatio.
 *
 * WHY THIS IS A HOOK
 * The measurement helper was already shared (publicPopupLayout), but the wiring — read on
 * loadedmetadata + playing, PLUS a 250ms/~5s poll for upstreams that report frame size late — lived
 * inline in VideoPopup. Every other live player hardcoded `aspect-video` and letterboxed non-16:9
 * cameras. Extracting the wiring here lets them all share the exact "white space on the sides" fix.
 */

import { useState, useEffect, useCallback } from 'react';
import { getVideoAspectRatio } from '../utils/publicPopupLayout';

/**
 * @param {{current: HTMLVideoElement|null}} videoRef
 * @param {*} resetKey - changes (e.g. camera id) reset the measured ratio so a new stream re-measures.
 * @returns {number|null} normalized width/height ratio, or null until it lands.
 */
export function useVideoAspectRatio(videoRef, resetKey) {
    const [aspectRatio, setAspectRatio] = useState(null);

    const sync = useCallback(() => {
        const next = getVideoAspectRatio(videoRef?.current);
        if (next) setAspectRatio(next);
    }, [videoRef]);

    // A new source must re-measure — otherwise a 4:3 camera keeps a previous 16:9 box.
    useEffect(() => { setAspectRatio(null); }, [resetKey]);

    // loadedmetadata + playing: the moments the element first knows its frame size.
    useEffect(() => {
        const video = videoRef?.current;
        if (!video) return undefined;
        video.addEventListener('loadedmetadata', sync);
        video.addEventListener('playing', sync);
        return () => {
            video.removeEventListener('loadedmetadata', sync);
            video.removeEventListener('playing', sync);
        };
    }, [videoRef, sync, resetKey]);

    // Belt-and-braces poll (250ms, ~5s) for upstreams that report videoWidth/Height late — the
    // exact "white space on the sides" fix. Stops as soon as a ratio lands, or after ~5s.
    useEffect(() => {
        if (aspectRatio) return undefined;
        if (!videoRef?.current) return undefined;
        let attempts = 0;
        const handle = setInterval(() => {
            attempts += 1;
            sync();
            if (attempts >= 20) clearInterval(handle);
        }, 250);
        return () => clearInterval(handle);
    }, [aspectRatio, sync, videoRef, resetKey]);

    return aspectRatio;
}

export default useVideoAspectRatio;
