/*
 * Purpose: Own the single commercial slot directly under the live video and decide who gets it —
 *          a paid affiliate offer, or the operator's own installation promo.
 * Caller: VideoPopup (in place of the bare <PromoBanner placement="popup" …/> that used to sit
 *          there). One slot, one owner: nothing else may render commercial content in this strip.
 * Deps: affiliateService (resolve + per-day de-dup), AffiliateOfferCard, PromoBanner.
 * MainFuncs: UnderVideoCommerceSlot.
 * SideEffects: at most one affiliate GET per camera per day per session, fired only once the slot
 *          is near the viewport. That GET is what counts the impression server-side.
 *
 * ── Precedence: affiliate first, promo second ─────────────────────────────────────────────────
 * The house installation promo targets 'all', so it is available on every camera, every hour,
 * forever. If it won ties it would never yield the slot and no affiliate offer would ever be seen.
 * The affiliate offer is the scarce side of this pair: it is scheduled (term partners have a
 * start/end window), targeted (all/area/camera), and it is the one that carries revenue and an
 * invoice-bearing statistic. So the scarce, expiring content wins and the always-available content
 * takes what is left.
 *
 * That is not a loss of control for the operator: they take the slot back at any time by
 * deactivating the offer or partner, letting the term lapse, or narrowing the offer's targeting.
 * The promo needs no such lever precisely because it is always eligible.
 *
 * ── Why the wrapper classes are passed THROUGH to PromoBanner ─────────────────────────────────
 * `border-t border-edge bg-surface px-3 py-3` is handed to PromoBanner as its `className` prop
 * rather than being worn by this component's own <div>. This is load-bearing, not style:
 * PromoBanner applies its className ONLY once a promo has actually resolved (see its final
 * `className={promo ? className : undefined}`). Put that border on an outer div here and every
 * camera with neither an affiliate offer nor a promo — the common case — would draw a bare
 * bordered strip with nothing in it under the video.
 *
 * ── Why nothing renders while the affiliate fetch is in flight ────────────────────────────────
 * No skeleton, no reserved box. The slot sits immediately under a starting video, and a
 * placeholder that resolves to "nothing" is a layout shift for the majority of cameras. It also
 * keeps promo impressions honest: PromoBanner is not mounted — and therefore does not fetch or
 * count — until it is known that the affiliate offer did not take the slot.
 *
 * ── Why the fetch is deferred behind an IntersectionObserver ──────────────────────────────────
 * Same reasoning as PromoBanner, and the same shape (rootMargin 200px, disconnect before load,
 * `cancelled` flag): the backend counts the impression on the resolve GET, so firing it on mount
 * would make "impression" mean "a popup opened", not "the block reached the screen". The wrapper
 * is empty at observe time — that is fine, and is exactly how PromoBanner has run in production:
 * a zero-height element inside the root still reports isIntersecting.
 */

import { useEffect, useRef, useState } from 'react';
import PromoBanner from '../promo/PromoBanner.jsx';
import AffiliateOfferCard from './AffiliateOfferCard.jsx';
import { resolveAffiliateOfferOnce } from '../../services/affiliateService';

/** This slot exists on one surface only; both children are asked about the same placement. */
const PLACEMENT = 'popup';

/** The strip's chrome. Worn by the affiliate branch, handed to PromoBanner in the promo branch. */
const SLOT_CLASSNAME = 'border-t border-edge bg-surface px-3 py-3';

/**
 * @param {object} props
 * @param {number} [props.cameraId] - camera currently on screen; drives affiliate + promo targeting
 */
export default function UnderVideoCommerceSlot({ cameraId }) {
    const [offer, setOffer] = useState(null);
    // Distinct from `offer`: "no offer" and "not asked yet" must render differently — the first
    // hands the slot to the promo, the second renders nothing at all.
    const [resolved, setResolved] = useState(false);
    const wrapperRef = useRef(null);

    // Switching camera invalidates both answers at once, so an offer bought for camera A never
    // lingers over camera B while B's resolve is still in flight.
    useEffect(() => {
        setOffer(null);
        setResolved(false);
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
            // A failed request is treated exactly like "no offer": the promo takes the slot and
            // the visitor sees no error. affiliateService never throws, so there is nothing to
            // catch here.
            setOffer(result?.data || null);
            setResolved(true);
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

            {resolved && !offer && (
                <PromoBanner placement={PLACEMENT} cameraId={cameraId} className={SLOT_CLASSNAME} />
            )}
        </div>
    );
}
