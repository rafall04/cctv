/*
 * Purpose: Own the commercial slot directly under the live video and fill it with a partner shop's
 *          offer, or leave it empty.
 * Caller: VideoPopup, immediately below the player. The operator's own installation promo now sits
 *          further down, below CameraDetailPanel — see the note below on why that changed.
 * Deps: affiliateService (resolve + per-day de-dup), AffiliateOfferCard.
 * MainFuncs: UnderVideoCommerceSlot.
 * SideEffects: at most one affiliate GET per camera per day per session, fired only once the slot
 *          is near the viewport. That GET is what counts the impression server-side.
 *
 * ── Why this stopped arbitrating (changed 2026-08-21) ─────────────────────────────────────────
 * It used to render the affiliate offer OR the house promo, never both, because five blocks
 * already sat under the video and the popup has a documented history of becoming unusable on a
 * 390px screen. That reasoning was sound but the premise was not tested: checked on a real Android
 * phone, the offer card is a title, an optional photo and a button — far lighter than a poster —
 * and both fit.
 *
 * So both now render, but NOT stacked. The offer keeps this spot; the promo moved below the camera
 * metadata. The thing being protected was never "only one commercial block", it was "the visitor
 * should not have to scroll past two of them to reach what the camera actually is".
 *
 * One slot, one owner still holds: nothing else may render commercial content in this strip.
 *
 * ── Why nothing renders while the fetch is in flight ──────────────────────────────────────────
 * No skeleton, no reserved box. The slot sits immediately under a starting video, and a
 * placeholder that resolves to "nothing" is a layout shift on the majority of cameras, which have
 * no offer.
 *
 * ── Why the fetch is deferred behind an IntersectionObserver ──────────────────────────────────
 * Same shape as PromoBanner (rootMargin 200px, disconnect before load, `cancelled` flag): the
 * backend counts the impression on the resolve GET, so firing it on mount would make "impression"
 * mean "a popup opened" rather than "the block reached the screen". The wrapper is empty at
 * observe time — that is fine, and is how PromoBanner has run in production: a zero-height element
 * inside the root still reports isIntersecting.
 */

import { useEffect, useRef, useState } from 'react';
import AffiliateOfferCard from './AffiliateOfferCard.jsx';
import { resolveAffiliateOfferOnce } from '../../services/affiliateService';

/** This slot exists on one surface only. */
const PLACEMENT = 'popup';

/** The strip's chrome, applied only once an offer has actually resolved — never to an empty div. */
const SLOT_CLASSNAME = 'border-t border-edge bg-surface px-3 py-3';

/**
 * @param {object} props
 * @param {number} [props.cameraId] - camera currently on screen; drives offer targeting
 */
export default function UnderVideoCommerceSlot({ cameraId }) {
    const [offer, setOffer] = useState(null);
    const wrapperRef = useRef(null);

    // Switching camera invalidates the answer, so an offer bought for camera A never lingers over
    // camera B while B's resolve is still in flight.
    useEffect(() => {
        setOffer(null);
    }, [cameraId]);

    useEffect(() => {
        let cancelled = false;
        const node = wrapperRef.current;
        if (!node) {
            return undefined;
        }

        const load = async () => {
            const result = await resolveAffiliateOfferOnce({ placement: PLACEMENT, cameraId });
            if (cancelled) {
                return;
            }
            // A failed request is treated exactly like "no offer" — the visitor sees no error.
            // affiliateService never throws, so there is nothing to catch here.
            setOffer(result?.data || null);
        };

        if (typeof IntersectionObserver !== 'function') {
            load();
            return () => { cancelled = true; };
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                // Disconnect BEFORE loading: scrolling the popup must not be able to queue a
                // second resolve (and a second impression) for the same mount.
                observer.disconnect();
                load();
            }
        }, { rootMargin: '200px' });

        observer.observe(node);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [cameraId]);

    return (
        <div ref={wrapperRef} data-testid="under-video-commerce-slot">
            {offer && (
                <div className={SLOT_CLASSNAME}>
                    <AffiliateOfferCard offer={offer} />
                </div>
            )}
        </div>
    );
}
