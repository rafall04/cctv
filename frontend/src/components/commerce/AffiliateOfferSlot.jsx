/*
 * Purpose: Own the affiliate ("Toko rekanan") slot on ONE public surface and fill it with the offer
 *          that surface resolves to, or leave it empty.
 * Caller: four public surfaces, one mount each, and each mount names its own surface —
 *          VideoPopup (placement="popup", directly under the live video), AreaPublicPage ("area"),
 *          Playback ("playback"), LandingPage + LandingPageSimple ("landing"). The wrapper classes
 *          come from the call site too: this component owns no surface-specific chrome.
 * Deps: affiliateService (resolve + per-surface-per-day de-dup), AffiliateOfferCard.
 * MainFuncs: AffiliateOfferSlot.
 * SideEffects: at most one affiliate GET per (surface, camera/area, day) per session, fired only
 *          once the slot is near the viewport. That GET is what counts the impression server-side.
 *
 * ── Why this is no longer called UnderVideoCommerceSlot (renamed 2026-08-23) ──────────────────
 * It was accurate while there was one mount. It is now mounted on the landing page, which has no
 * video at all, and on the area page, which has thumbnails rather than a player — a name that
 * describes a position the component no longer holds is worse than no name, because the next
 * reader trusts it. What the component actually is, on every surface, is "the slot that owns one
 * affiliate offer", so that is what it is called, and it sits next to AffiliateOfferCard, which is
 * what it renders.
 *
 * ── Every count says WHERE it happened ────────────────────────────────────────────────────────
 * `placement` is threaded into the resolve, into the de-dup key, and into the click beacon. One
 * visitor going landing → area → camera legitimately produces three impressions; blended into one
 * number, a rising figure could mean "this product is interesting" OR "we put it in more places",
 * and those call for opposite decisions. The backend column is NOT NULL with no default so a
 * writer that forgets fails loudly rather than piling everything into one bucket — do not add a
 * default here to make that quieter.
 *
 * ── placement="landing" can only ever match target_mode='all' offers ──────────────────────────
 * The home page has no camera and no area in context, so the two mounts below pass neither. The
 * resolver targets camera → area → all, which means an offer aimed at one camera, or at one area,
 * can NEVER appear on the landing page however it is scheduled or prioritised. That is a product
 * consequence of the home page not being about any one camera, not a bug and not something to fix
 * by inventing a "featured camera" for it: an offer that says "this shop is near camera 12" is a
 * claim about camera 12's page. An operator who wants reach on the home page sets target_mode to
 * 'all'; there is nowhere else for that setting to come from.
 *
 * ── Why nothing renders while the fetch is in flight ──────────────────────────────────────────
 * No skeleton, no reserved box. On the popup the slot sits immediately under a starting video, and
 * a placeholder that resolves to "nothing" is a layout shift on the majority of cameras, which
 * have no offer. The same holds on every other surface, which is why the wrapper classes are
 * applied to the INNER div — an empty slot must contribute no border, no padding and no margin.
 *
 * ── Why the fetch is deferred behind an IntersectionObserver ──────────────────────────────────
 * Same shape as PromoBanner (rootMargin 200px, disconnect before load, `cancelled` flag): the
 * backend counts the impression on the resolve GET, so firing it on mount would make "impression"
 * mean "the page loaded" rather than "the block reached the screen". The wrapper is empty at
 * observe time — that is fine, and is how PromoBanner has run in production: a zero-height element
 * inside the root still reports isIntersecting.
 *
 * ── One slot, one owner ───────────────────────────────────────────────────────────────────────
 * Nothing else may render commercial content inside this wrapper. On the popup the house promo
 * used to be arbitrated against the offer here; it now has its own mount below CameraDetailPanel,
 * and the four public surfaces follow the same rule — <PromoBanner> is a sibling of this slot,
 * never a child of it.
 */

import { useEffect, useRef, useState } from 'react';
import AffiliateOfferCard from './AffiliateOfferCard.jsx';
import { resolveAffiliateOfferOnce } from '../../services/affiliateService';

/**
 * @param {object} props
 * @param {'popup'|'area'|'landing'|'playback'} props.placement - which surface is rendering this
 *   slot. Required: it decides which offers can match, and it is stamped on the impression and on
 *   every click beacon.
 * @param {number} [props.cameraId] - camera currently on screen, when there is one
 * @param {number} [props.areaId] - area in context, when there is no single camera
 * @param {string} [props.className] - wrapper classes for this surface, applied ONLY once an offer
 *   has actually resolved — never to an empty div
 */
export default function AffiliateOfferSlot({ placement, cameraId = null, areaId = null, className = '' }) {
    const [offer, setOffer] = useState(null);
    const wrapperRef = useRef(null);

    // Switching context invalidates the answer, so an offer bought for camera A never lingers over
    // camera B while B's resolve is still in flight.
    useEffect(() => {
        setOffer(null);
    }, [placement, cameraId, areaId]);

    useEffect(() => {
        let cancelled = false;
        const node = wrapperRef.current;
        if (!node) {
            return undefined;
        }

        const load = async () => {
            const result = await resolveAffiliateOfferOnce({ placement, cameraId, areaId });
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
                // Disconnect BEFORE loading: scrolling the page must not be able to queue a
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
    }, [placement, cameraId, areaId]);

    return (
        // data-placement is the surface this mount speaks for, readable from a browser test: with
        // four mounts live, "an offer rendered" is no longer specific enough to assert on.
        <div ref={wrapperRef} data-testid="affiliate-offer-slot" data-placement={placement}>
            {offer && (
                <div className={className || undefined}>
                    <AffiliateOfferCard offer={offer} placement={placement} />
                </div>
            )}
        </div>
    );
}
