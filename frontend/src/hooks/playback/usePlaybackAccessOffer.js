/*
 * Purpose: Answer one question for the playback page — is ANY access package on offer right now?
 * Caller: PlaybackTokenAccess and PlaybackOptions (the two "coba gratis atau beli akses" buttons).
 * Deps: playbackAccessService.
 * MainFuncs: usePlaybackAccessOffer, resetPlaybackAccessOfferCache.
 * SideEffects: One GET /api/playback-access/products per page load, shared by every caller.
 *
 * WHY THIS EXISTS
 * Both entry-point buttons used to render unconditionally, while the panel behind them only shows a
 * card per ENABLED product. Disable every package and the buttons still promised "Coba gratis 3 hari
 * atau beli akses", then opened a completely empty box. The catalogue is the honest source for
 * whether that invitation can be kept, so the buttons now ask it before offering anything.
 *
 * WHY A MODULE-LEVEL CACHE
 * Two components ask the same question on one page. Without the dedupe each would fire its own
 * request for one answer. The cache lives for the page load only: an operator flipping a package on
 * or off is picked up on the visitor's next load, which is soon enough for a catalogue edited by hand.
 *
 * WHY IT FAILS *OPEN*
 * A transient network error must never hide the only route to buying access. When the request fails
 * we report `offered: true` and let the panel show its own "Gagal memuat paket" message — an honest
 * error beats a silently missing button. The case this hook exists for (every package disabled) is a
 * SUCCESSFUL response carrying an empty list, so failing open does not weaken it.
 */

import { useState, useEffect } from 'react';
import playbackAccessService from '../../services/playbackAccessService';

let cachedOffer = null;
let inFlight = null;

/** Test seam: module state outlives a component tree, so tests must be able to clear it. */
export function resetPlaybackAccessOfferCache() {
    cachedOffer = null;
    inFlight = null;
}

function loadOffer() {
    if (cachedOffer) return Promise.resolve(cachedOffer);
    if (!inFlight) {
        inFlight = playbackAccessService
            .getProducts()
            .then((res) => ({ offered: (res?.data?.products || []).length > 0 }))
            .catch(() => ({ offered: true })) // fail open — see header
            .then((result) => {
                cachedOffer = result;
                inFlight = null;
                return result;
            });
    }
    return inFlight;
}

/**
 * Starts as `{ ready: false, offered: false }` so nothing is promised before the answer arrives.
 * Appearing a moment late is better than offering access and then withdrawing it mid-render.
 */
export default function usePlaybackAccessOffer() {
    const [state, setState] = useState(() =>
        cachedOffer ? { ready: true, offered: cachedOffer.offered } : { ready: false, offered: false }
    );

    useEffect(() => {
        if (cachedOffer) {
            setState({ ready: true, offered: cachedOffer.offered });
            return undefined;
        }
        let alive = true;
        loadOffer().then((result) => {
            if (alive) setState({ ready: true, offered: result.offered });
        });
        return () => {
            alive = false;
        };
    }, []);

    return state;
}
