/*
 * Purpose: Render the provider promo poster on public surfaces, with a
 *   zoomable full-screen view and a WhatsApp call-to-action.
 * Caller: VideoPopup (below the live video), AreaPublicPage, LandingPage, Playback.
 * Deps: promoBannerService (resolve + click tracking), useFocusTrap (lightbox).
 * MainFuncs: PromoBanner.
 * SideEffects: One GET per mount once scrolled into view (which is what counts the
 *   impression server-side); one fire-and-forget POST per outbound CTA click.
 *
 * ── WHAT CHANGED 2026-08-21 (density pass) AND WHY ──────────────────────────────
 * The poster itself was NOT touched: it still renders at full width and fully
 * visible, which is a deliberate product decision — a promo you have to guess at
 * is not a promo. Under a live video the block was simply carrying more chrome
 * than content around it, so only the label row was tightened:
 *   · the single-child `flex justify-between` wrapper is gone — it was reserving
 *     space for a right-hand element this banner has never had;
 *   · "PROMO" dropped `font-medium` → normal weight. Quieter, but the size and
 *     the `text-content-subtle` colour are unchanged: this label is the honesty
 *     disclosure that says the poster is house advertising, so it may become
 *     lighter, never smaller and never lower-contrast;
 *   · the gap above the poster went `pb-2` → `pb-1.5`.
 * Fetching, IntersectionObserver-gated impression counting, the className
 * passthrough, the lightbox and the CTA (including its `mt-2` offset) are all
 * byte-for-byte what they were.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicPromoBanner, trackPromoBannerClick } from '../../services/promoBannerService';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const MEDIA_BASE = '/api/promo-media';

/**
 * Both renditions the backend generates. `sizes` tells the browser the poster is
 * never wider than the content column, so a phone picks the 640px file and
 * downloads roughly a quarter of the desktop bytes.
 */
function buildSrcSet(imageBase) {
    return `${MEDIA_BASE}/${imageBase}-640.webp 640w, ${MEDIA_BASE}/${imageBase}-1200.webp 1200w`;
}

function PromoImage({ promo, className, sizes }) {
    return (
        <img
            src={`${MEDIA_BASE}/${promo.image_base}-1200.webp`}
            srcSet={buildSrcSet(promo.image_base)}
            sizes={sizes}
            /* Intrinsic size reserves the right box before the bytes land, so the
               poster cannot shove the content below it down as it loads. */
            width={promo.image_width || undefined}
            height={promo.image_height || undefined}
            alt={promo.alt_text || promo.title}
            loading="lazy"
            decoding="async"
            className={className}
        />
    );
}

/**
 * Full-screen view of the poster.
 *
 * The poster carries its terms as body text, which is unreadable at the width of
 * a phone-sized card — this is what makes the whole thing legible, so it is not
 * optional polish.
 */
function PromoLightbox({ promo, onClose, onCtaClick }) {
    const dialogRef = useRef(null);
    useFocusTrap(dialogRef, { active: true, onEscape: onClose });

    return (
        <div
            className="fixed inset-0 z-modal flex items-center justify-center bg-black/80 p-4"
            onClick={onClose}
            role="presentation"
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={promo.title}
                /* Sized with insets + max-*, never 100vw: a fixed element escapes the
                   root overflow-x guard and 100vw grows with the overflow it causes. */
                className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-card bg-surface shadow-e2"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
                    <h2 className="min-w-0 truncate text-base font-semibold text-content">{promo.title}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Tutup promo"
                        className="shrink-0 rounded-control border border-edge bg-surface px-2 py-1 text-sm text-content-muted transition-colors hover:border-edge-strong hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto bg-surface-sunken p-2">
                    <PromoImage promo={promo} sizes="(max-width: 768px) 100vw, 768px" className="mx-auto h-auto w-full max-w-full rounded-card" />
                </div>

                {promo.cta_url && (
                    <div className="border-t border-edge px-4 py-3">
                        <a
                            href={promo.cta_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={onCtaClick}
                            className="flex w-full items-center justify-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            {promo.cta_label || 'Hubungi Kami'}
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * @param {object} props
 * @param {'popup'|'area'|'landing'|'playback'} props.placement - which surface is asking
 * @param {number} [props.cameraId] - camera in context (drives camera/area targeting)
 * @param {number} [props.areaId] - area in context, when there is no single camera
 * @param {string} [props.className] - wrapper classes supplied by the host surface
 */
export default function PromoBanner({ placement, cameraId, areaId, className = '' }) {
    const [promo, setPromo] = useState(null);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const wrapperRef = useRef(null);

    /*
     * The fetch is deferred until the wrapper is near the viewport. That keeps the
     * poster off the critical path while a stream is starting, and — because the
     * backend counts the impression on that GET — makes an "impression" mean the
     * banner actually reached the screen rather than merely that a popup opened.
     */
    useEffect(() => {
        let cancelled = false;
        const node = wrapperRef.current;
        if (!node || !placement) {
            return undefined;
        }

        const load = async () => {
            const result = await getPublicPromoBanner({ placement, cameraId, areaId });
            // Require a usable image_base rather than a merely truthy `data`: "no promo
            // configured" can arrive as null OR as an empty array/object from a proxy or
            // a stubbed endpoint, and both are truthy enough to render a broken <img>.
            if (!cancelled && result?.success && result.data?.image_base) {
                setPromo(result.data);
            }
        };

        if (typeof IntersectionObserver !== 'function') {
            load();
            return () => { cancelled = true; };
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
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

    // Reset when the surface switches to a different camera, so an old poster
    // never lingers over a new context while the next fetch is in flight.
    useEffect(() => {
        setPromo(null);
        setLightboxOpen(false);
    }, [cameraId, areaId, placement]);

    const handleCtaClick = useCallback(() => {
        if (promo) {
            trackPromoBannerClick(promo.id);
        }
    }, [promo]);

    const closeLightbox = useCallback(() => setLightboxOpen(false), []);

    // Body scroll lock while the lightbox owns the screen.
    useEffect(() => {
        if (!lightboxOpen) {
            return undefined;
        }
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previous; };
    }, [lightboxOpen]);

    return (
        <div ref={wrapperRef} className={promo ? className : undefined}>
            {promo && (
                <>
                    {/* Labelled honestly: this is house advertising by the operator, not
                        editorial content and not a third-party network ad. Normal weight
                        rather than font-medium — quiet chrome, but never smaller than
                        text-xs and never below text-content-subtle, because the label IS
                        the disclosure. */}
                    <span className="block pb-1.5 text-xs uppercase tracking-wide text-content-subtle">Promo</span>

                    <button
                        type="button"
                        onClick={() => setLightboxOpen(true)}
                        aria-label={`Lihat promo lebih besar: ${promo.title}`}
                        className="block w-full overflow-hidden rounded-card border border-edge bg-surface-sunken transition-colors hover:border-edge-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <PromoImage
                            promo={promo}
                            sizes="(max-width: 768px) 100vw, 640px"
                            className="h-auto w-full max-w-full"
                        />
                    </button>

                    {promo.cta_url && (
                        <a
                            href={promo.cta_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={handleCtaClick}
                            className="mt-2 flex w-full items-center justify-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885" />
                            </svg>
                            {promo.cta_label || 'Hubungi Kami'}
                        </a>
                    )}
                </>
            )}

            {lightboxOpen && promo && (
                <PromoLightbox promo={promo} onClose={closeLightbox} onCtaClick={handleCtaClick} />
            )}
        </div>
    );
}
