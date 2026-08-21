/*
 * Purpose: Render one affiliate ("Toko rekanan") offer as a labelled card — photo, title,
 *          description, price, and up to five actions: open the product, ask about it on WhatsApp,
 *          visit the shop, copy the link, share it.
 * Caller: UnderVideoCommerceSlot (below the live video).
 * Deps: affiliateService (countAffiliateClick + AFFILIATE_LINK). The payload arrives fully
 *          resolved and already sanitised by that service; this component builds no URLs of its
 *          own except the media path for the photo.
 * MainFuncs: AffiliateOfferCard.
 * SideEffects: one fire-and-forget counting beacon per outbound tap; clipboard write / native
 *          share sheet on the two utility buttons.
 *
 * ── Presence is the switch ────────────────────────────────────────────────────────────────────
 * Every part of this card renders only when its data is present, and disappears when the operator
 * clears the field: no photo key → no photo, no whatsapp_url → no WhatsApp button, price_rupiah
 * null → no price line. There is deliberately no show_photo / show_price flag anywhere in the
 * feature, and this component must not grow one: two pieces of state describing one thing
 * eventually disagree.
 * The price is the trap in that rule — `null` and `0` are different. null means "this offer does
 * not advertise a price"; 0 is a price of zero rupiah and MUST still render. So the test is
 * `price_rupiah !== null`, never truthiness.
 *
 * ── WHY THE ANCHOR POINTS AT THE REAL SHOP URL AND NOT AT OUR /go REDIRECTOR ──────────────────
 * Phase 1 pointed these anchors at `/api/public/affiliate/offers/<id>/go?l=p`, so the partner's
 * URL never left the backend. That was never a security property — a shop page is public by
 * definition — and it broke the product in a way only a phone reveals:
 *
 * this site's PWA manifest is scope "/" with display "standalone", so a RELATIVE `/go` href is IN
 * SCOPE. An installed PWA therefore handles that navigation ITSELF, follows the 302, and lands the
 * visitor on a third-party shop inside our shell — no address bar, no back affordance, and no
 * second origin to escape through (there is exactly one origin; api-cctv.raf.my.id is NXDOMAIN and
 * everything is proxied by nginx). An absolute https:// href is OUT of scope, so Android hands it
 * to the real browser. That is the platform's own rule rather than a workaround, and it is also
 * what makes long-press → "copy link" yield a shop domain the recipient recognises instead of an
 * opaque redirector on a CCTV domain.
 *
 * `product_href` / `store_href` are still used — as the FALLBACK when the backend could not vouch
 * for the stored URL (it re-validates on the way out and emits null for anything doubtful). A
 * redirector inside the PWA shell is a poor experience; a dead card is a worse one.
 *
 * ── Counting, and why it is not double-counted ────────────────────────────────────────────────
 * The 302 path counts a click server-side by watching the navigation. When the anchor points at
 * the real URL that navigation never touches us, so the click is counted by an explicit beacon
 * fired from onClick (affiliateService.countAffiliateClick — never inline here, and never
 * awaited: it must not delay the navigation the visitor asked for).
 * The beacon therefore fires ONLY when the anchor carries the direct URL. On the `/go` fallback
 * the redirect counts it, and firing both would file one tap as two.
 * WhatsApp always beacons: `l=w` has no redirect target at all — wa.me is a deep link the phone
 * hands to another app, so a redirector would break it.
 *
 * ── Why the anchors carry that exact rel ──────────────────────────────────────────────────────
 *   · noopener/noreferrer  the destination is a third-party page opened in a new tab; it must not
 *                          get a handle on this window. noreferrer also suppresses the Referer
 *                          header, which matters because nginx sets Referrer-Policy at server
 *                          level and overrides whatever the app would send.
 *   · nofollow + sponsored this is a PAID placement on a public-institution-adjacent domain.
 *                          Search engines are told so explicitly; anything less is undisclosed
 *                          link-selling.
 * The rel string is written out as a literal on every anchor rather than shared through a
 * constant: `react/jsx-no-target-blank` can only read a literal, and a rel this important is worth
 * being machine-checked at every call site.
 *
 * ── Copy / Share act on the shop URL, never on /go ────────────────────────────────────────────
 * A recipient who is sent `https://<shop>/produk/…` sees a domain they recognise. A recipient who
 * is sent `https://cctv…/api/public/affiliate/offers/12/go?l=p` sees an opaque path on a CCTV
 * domain and does not click it. So both buttons hide themselves when only the redirector exists.
 * Share mirrors the existing pattern in VideoPopup.handleShare — navigator.share when the platform
 * offers it, clipboard otherwise — rather than inventing a second one; the only refinement is that
 * an explicit cancel (AbortError) does nothing instead of falling through to a copy the visitor
 * did not ask for. Confirmation is in-card and transient; never an alert(), which blocks the
 * stream playing behind it.
 *
 * ── Honesty & tokens ──────────────────────────────────────────────────────────────────────────
 * The "Toko rekanan" label is not decoration. It is the same shape as PromoBanner's "Promo" and
 * the ad slots' "Iklan": commercial content on a public surface says so, in the same place, every
 * time. Do not remove it and do not make it quieter than the surrounding copy.
 * `status-fault` (red) is deliberately absent everywhere below — a shop link is not a fault, and
 * neither is a clipboard that refused to open.
 *
 * ── Mobile hard rules obeyed here (each earned by a production bug) ───────────────────────────
 * Action rows are `flex flex-wrap` with `min-w-0` items and `truncate` labels, because Android
 * font scaling at 1.3× is the classic way a row of buttons grows wider than the viewport. Touch
 * targets are `min-h-[40px] sm:min-h-0`. The photo carries width/height so it reserves its box
 * before the bytes land — no layout shift under a starting video. Nothing in this tree is an
 * iframe or an embed, nothing is sized in viewport units, and nothing is position-fixed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AFFILIATE_LINK, countAffiliateClick } from '../../services/affiliateService';

/** Where the WebP renditions are served. Matches backend routes/affiliateMediaRoutes.js. */
const MEDIA_BASE = '/api/affiliate-media';

/** The two renditions the backend generates for an offer photo: 1× and 2× of a ~96px thumbnail. */
const IMAGE_RENDITIONS = [160, 320];

/** How long "Tersalin" stays on screen. Long enough to read, short enough not to become chrome. */
const COPY_FEEDBACK_MS = 2200;

const ACTION_BASE = 'flex min-h-[40px] w-full min-w-0 items-center justify-center gap-1.5 rounded-control px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-h-0 sm:w-auto';
const SECONDARY_ACTION = `${ACTION_BASE} border border-edge bg-surface font-medium text-content-muted hover:border-edge-strong hover:bg-surface-raised hover:text-content`;
const UTILITY_ACTION = 'inline-flex min-h-[40px] min-w-0 max-w-full items-center justify-center gap-1.5 rounded-control border border-edge bg-surface px-3 py-2 text-xs font-medium text-content-muted transition-colors hover:border-edge-strong hover:bg-surface-raised hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-h-0';

function ExternalLinkIcon() {
    return (
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18v4.5M17.5 6.5L10 14M16 13.5V18H6V8h4.5" />
        </svg>
    );
}

function WhatsAppIcon() {
    return (
        <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885" />
        </svg>
    );
}

function CopyIcon() {
    return (
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 8V6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2M6 8h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a2 2 0 012-2z" />
        </svg>
    );
}

function ShareIcon() {
    return (
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.7 10.7l6.6-3.4M8.7 13.3l6.6 3.4M18 8a2 2 0 100-4 2 2 0 000 4zM6 14a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4z" />
        </svg>
    );
}

/**
 * Money is INTEGER rupiah end to end (Critical Invariant), so this only ever formats — it never
 * rounds, and it is never handed a float. `toLocaleString('id-ID')` gives the thousand separators
 * an Indonesian reader expects (150000 → "Rp150.000"); a price of 0 formats as "Rp0" rather than
 * being reworded, because inventing copy for one value is how a rendered zero turns into a missing
 * price later.
 */
function formatRupiah(value) {
    return `Rp${Number(value).toLocaleString('id-ID')}`;
}

function buildSrcSet(imageBase) {
    return IMAGE_RENDITIONS.map((width) => `${MEDIA_BASE}/${imageBase}-${width}.webp ${width}w`).join(', ');
}

/**
 * @param {object} props
 * @param {object} props.offer - the thirteen-key public payload:
 *   { id, product_title, description, store_name, product_url, store_url, product_href,
 *     store_href, whatsapp_url, price_rupiah, image_base, image_width, image_height }
 * @param {string} [props.className] - wrapper classes supplied by the host slot
 */
export default function AffiliateOfferCard({ offer, className = '' }) {
    /*
     * ALL HOOKS FIRST — the "nothing to render" guard lives below them (React error #310). Every
     * value they close over is read with `?.`, so they are safe to declare before the offer has
     * been validated.
     */
    const [copyState, setCopyState] = useState(null); // null | 'copied' | 'failed'
    const feedbackTimerRef = useRef(null);

    const offerId = offer?.id ?? null;
    const productTitle = offer?.product_title || '';
    // The direct URLs are also the "should this tap be beaconed?" flags: present means the anchor
    // leaves our origin, so nothing server-side will see the click.
    const productUrl = offer?.product_url || null;
    const storeUrl = offer?.store_url || null;
    const whatsappUrl = offer?.whatsapp_url || null;

    useEffect(() => () => clearTimeout(feedbackTimerRef.current), []);

    // A new offer starts with a clean slate: a "Tersalin" left over from the previous camera would
    // be claiming something about a link the visitor never copied.
    useEffect(() => {
        setCopyState(null);
        clearTimeout(feedbackTimerRef.current);
    }, [offerId]);

    const showFeedback = useCallback((state) => {
        setCopyState(state);
        clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = setTimeout(() => setCopyState(null), COPY_FEEDBACK_MS);
    }, []);

    const copyShareUrl = useCallback(async () => {
        if (!productUrl) {
            return false;
        }
        try {
            // navigator.clipboard is undefined outside a secure context; that reads as a throw
            // here, which is exactly the branch we want.
            await navigator.clipboard.writeText(productUrl);
            showFeedback('copied');
            return true;
        } catch {
            showFeedback('failed');
            return false;
        }
    }, [productUrl, showFeedback]);

    const handleShare = useCallback(async () => {
        if (!productUrl) {
            return;
        }
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({ title: productTitle, text: productTitle, url: productUrl });
                return;
            } catch (error) {
                // Cancelling the share sheet is a decision, not a failure — do not "helpfully"
                // copy instead. Anything else means the sheet is unusable, so fall back.
                if (error?.name === 'AbortError') {
                    return;
                }
            }
        }
        await copyShareUrl();
    }, [productUrl, productTitle, copyShareUrl]);

    const handleProductClick = useCallback(() => {
        if (productUrl) {
            countAffiliateClick(offerId, AFFILIATE_LINK.PRODUCT);
        }
    }, [offerId, productUrl]);

    const handleStoreClick = useCallback(() => {
        if (storeUrl) {
            countAffiliateClick(offerId, AFFILIATE_LINK.STORE);
        }
    }, [offerId, storeUrl]);

    const handleWhatsAppClick = useCallback(() => {
        countAffiliateClick(offerId, AFFILIATE_LINK.WHATSAPP);
    }, [offerId]);

    // ── end of hooks ─────────────────────────────────────────────────────────────────────────
    const productHref = productUrl || offer?.product_href || null;
    if (!offer?.product_title || !productHref) {
        return null;
    }

    const storeHref = storeUrl || offer.store_href || null;
    const storeLabel = offer.store_name || 'Kunjungi toko';
    const hasPrice = offer.price_rupiah !== null && offer.price_rupiah !== undefined;

    return (
        <article className={className || undefined} data-testid="affiliate-offer-card">
            <div className="flex items-center justify-between gap-2 pb-2">
                <span className="text-xs font-medium uppercase tracking-wide text-content-subtle">Toko rekanan</span>
            </div>

            <div className="rounded-card border border-edge bg-surface-sunken p-3">
                <div className="flex gap-3">
                    {offer.image_base && (
                        /* Thumbnail, not poster: 160/320 covers 1× and 2× of this ~96px box, which
                           is why the backend generates those two and nothing larger. It loads
                           under a live video on a phone, where every kilobyte competes with the
                           stream. */
                        <div className="w-20 shrink-0 overflow-hidden rounded-card border border-edge bg-surface sm:w-24">
                            <img
                                src={`${MEDIA_BASE}/${offer.image_base}-320.webp`}
                                srcSet={buildSrcSet(offer.image_base)}
                                sizes="(min-width: 640px) 96px, 80px"
                                width={offer.image_width || undefined}
                                height={offer.image_height || undefined}
                                alt={offer.product_title}
                                loading="lazy"
                                decoding="async"
                                className="h-auto w-full max-w-full"
                            />
                        </div>
                    )}

                    <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold leading-snug text-content">{offer.product_title}</h3>

                        {offer.description && (
                            /* Clamped, not truncated to one line: the description is the only place
                               the partner gets to explain the product, but it must not push the
                               camera detail panel off the first screen of a phone. */
                            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-content-muted">{offer.description}</p>
                        )}

                        {hasPrice && (
                            <p className="mt-1.5 text-base font-bold text-content" data-testid="affiliate-offer-price">
                                {formatRupiah(offer.price_rupiah)}
                            </p>
                        )}
                    </div>
                </div>

                {/* flex-wrap + min-w-0 + truncate: with Android font scaling at 1.3× a two-button
                    row is the classic way a card grows wider than the viewport. Here the buttons
                    stack on narrow screens and only share a line from sm upwards. */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a
                        href={productHref}
                        target="_blank"
                        rel="noopener noreferrer nofollow sponsored"
                        onClick={handleProductClick}
                        aria-label={`Lihat barang: ${offer.product_title}`}
                        className={`${ACTION_BASE} bg-primary text-white hover:opacity-90 sm:flex-1`}
                    >
                        <span className="truncate">Lihat barang</span>
                        <ExternalLinkIcon />
                    </a>

                    {whatsappUrl && (
                        <a
                            href={whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow sponsored"
                            onClick={handleWhatsAppClick}
                            aria-label={`Tanya barang ini lewat WhatsApp: ${offer.product_title}`}
                            className={`${SECONDARY_ACTION} sm:max-w-[60%]`}
                        >
                            <WhatsAppIcon />
                            <span className="truncate">Tanya barang ini</span>
                        </a>
                    )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                    {storeHref && (
                        <a
                            href={storeHref}
                            target="_blank"
                            rel="noopener noreferrer nofollow sponsored"
                            onClick={handleStoreClick}
                            aria-label={`Buka toko ${storeLabel}`}
                            className={UTILITY_ACTION}
                        >
                            <span className="truncate">{storeLabel}</span>
                            <ExternalLinkIcon />
                        </a>
                    )}

                    {/* Both utilities share one link — the shop URL. With only the redirector
                        available there is nothing worth sending anyone, so they do not render. */}
                    {productUrl && (
                        <>
                            <button type="button" onClick={copyShareUrl} className={UTILITY_ACTION}>
                                <CopyIcon />
                                <span className="truncate">Salin link</span>
                            </button>

                            <button type="button" onClick={handleShare} className={UTILITY_ACTION}>
                                <ShareIcon />
                                <span className="truncate">Bagikan</span>
                            </button>
                        </>
                    )}

                    {copyState && (
                        /* Announced, not shouted: polite live region, muted text, gone in ~2s. */
                        <span role="status" aria-live="polite" className="min-w-0 truncate text-xs text-content-muted">
                            {copyState === 'copied' ? 'Tersalin' : 'Gagal menyalin'}
                        </span>
                    )}
                </div>
            </div>
        </article>
    );
}
