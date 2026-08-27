/*
 * Purpose: Render one affiliate ("Toko rekanan") offer as a labelled card — photo, title,
 *          description, price, and up to five actions: open the product, ask about it on WhatsApp,
 *          visit the shop, copy the link, share it.
 * Caller: CommercialSlot, on any of the public surfaces. The slot tells this card which
 *          surface it is on; the card's only use for that is stamping the click beacons.
 * Deps: affiliateService (countAffiliateClick + AFFILIATE_LINK). The payload arrives fully
 *          resolved and already sanitised by that service; this component builds no URLs of its
 *          own except the media path for the photo.
 * MainFuncs: AffiliateOfferCard.
 * SideEffects: one fire-and-forget counting beacon per outbound tap; clipboard write / native
 *          share sheet on the two utility buttons.
 *
 * ── WHAT CHANGED 2026-08-21 (density pass) AND WHY ────────────────────────────────────────────
 * On a real phone this card was three stacked rows of chrome under a starting video: a banner-ish
 * photo, a full-width red-ish primary button on its own line, then a second line holding the shop
 * link + "Salin link" + "Bagikan". A full-width primary CTA directly under a live stream competes
 * with the stream, and the second "Bagikan" collided with the camera's own "Bagikan" a few pixels
 * above it — two controls, same word, different objects.
 *
 * Five capabilities are unchanged; only their density and their labels moved:
 *   · photo      full-width-ish banner → FIXED 64/80px square thumbnail beside the text. A portrait
 *                photo used to make the whole card as tall as the phone; a fixed box cannot.
 *   · title+price now share one line — title `min-w-0 flex-1 truncate`, price `shrink-0
 *                tabular-nums` on the right. The full title stays reachable via the `title`
 *                attribute and via the CTA's aria-label, so truncation hides nothing.
 *   · CTA        `w-full` → sized to its content, still `bg-primary` so it still reads as primary.
 *                It now shares ONE row with WhatsApp + the two icon buttons.
 *   · WhatsApp   visible label shortened "Tanya barang ini" → "Tanya" so the row fits 390px. The
 *                accessible name still carries the long form AND the word WhatsApp.
 *   · copy/share ICON-ONLY, and disambiguated by aria-label/title: "Salin link barang" /
 *                "Bagikan barang". The chip row above this card owns the camera's share; inside
 *                this card, sharing means the ITEM. Visually the card does that work; for a screen
 *                reader and for a long-press tooltip the label has to say it out loud.
 *   · shop link  moved onto the honesty-label row ("TOKO REKANAN … NamaToko ↗"), which is where it
 *                belongs — the disclosure and the shop it discloses are one thought — and which
 *                frees the action row to hold exactly four controls.
 * Nothing was removed, no flag was introduced, and every beacon still fires with the same `l=`.
 *
 * ── WHAT CHANGED 2026-08-21 (second pass — sizing only) AND WHY ───────────────────────────────
 * Same five capabilities, same DOM, same hrefs, same beacons. Three numbers moved on the action
 * row, and nothing else in this file was touched:
 *   · CTA        `px-3` → `px-4`. It stays sized to its content and never `w-full`, so it reads as
 *                the primary thing to do without becoming a filled bar under a starting stream:
 *                the extra horizontal padding is what buys it presence, instead of width.
 *   · copy/share 40px square → 44px (`h-11 w-11`, and no `sm:` shrink any more). An icon with no
 *                label is a SMALLER visual target than a labelled chip, so its hit area goes UP,
 *                never down — 44px is the floor for a control whose whole affordance is a 16px
 *                glyph, and it does not get to shrink on a pointer device it may never meet.
 *   · labelled   `sm:min-h-0` → `sm:min-h-[36px]`, the same floor common/ActionChip uses for the
 *                chip row directly above this card. Identical in practice (py-2 + text-sm already
 *                measures 36px) but stated rather than inferred, so the two rows cannot drift.
 * The two icon buttons therefore sit 4px taller than the labelled controls beside them. That is
 * deliberate, not an oversight: `items-center` on the row centres the mismatch, and an honest tap
 * target beats a flush edge.
 * Padding now lives on the two variants rather than on ACTION_BASE. Two `px-*` classes in one
 * string do not "override" each other — same specificity, so whichever Tailwind emits last wins,
 * which is not something a component should be betting on.
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
 * Every beacon carries `placement`, so a tap is filed against the surface it happened on rather
 * than blended across all four. KNOWN GAP, and it belongs to the backend rather than here: the
 * `/go` FALLBACK path is counted by the 302, and `product_href` / `store_href` arrive prebuilt in
 * the payload with no surface on them. The resolver knows the placement it was asked for, so that
 * is where the two hrefs should be stamped — this component deliberately builds no URLs of its
 * own, and appending a query parameter to a link it was handed would be exactly that.
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
 * time. Do not remove it and do not make it quieter than the surrounding copy — the density pass
 * moved the shop link ONTO this row but left the label's own size, weight and colour untouched,
 * for exactly that reason.
 * `status-fault` (red) is deliberately absent everywhere below — a shop link is not a fault, and
 * neither is a clipboard that refused to open.
 *
 * ── Mobile hard rules obeyed here (each earned by a production bug) ───────────────────────────
 * The action row is `flex flex-wrap` with `min-w-0` items and `truncate` labels, because Android
 * font scaling at 1.3× is the classic way a row of buttons grows wider than the viewport: at 1×
 * the four controls share one line, above that they wrap instead of widening the card. Labelled
 * targets are `min-h-[40px] sm:min-h-[36px]`; the two icon-only buttons are a fixed 44px square at
 * every width, because a glyph with no label is the smallest target on the card. The photo carries
 * width/height AND a fixed CSS box, so it reserves its exact space before the bytes land — no
 * layout shift under a starting video, and no tall poster from a portrait upload. Nothing in this
 * tree is an iframe or an embed, nothing is sized in viewport units, and nothing is position-fixed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AFFILIATE_LINK, countAffiliateClick } from '../../services/affiliateService';
import { disclosureFor } from '../../utils/commercialDisclosure.js';

/** Where the WebP renditions are served. Matches backend routes/affiliateMediaRoutes.js. */
const MEDIA_BASE = '/api/affiliate-media';

/** The two renditions the backend generates for an offer photo: 1× and 2× of the thumbnail box. */
const IMAGE_RENDITIONS = [160, 320];

/** How long "Tersalin" stays on screen. Long enough to read, short enough not to become chrome. */
const COPY_FEEDBACK_MS = 2200;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/* Sized to content, not to the row: the CTA under a live video must read as primary without
   becoming the loudest thing on the screen. `min-w-0` + a truncating label is what lets four
   controls share one line at 1× and wrap — rather than widen — at Android's 1.3× font scale.
   Horizontal padding is NOT set here: each variant owns its own, so the primary can be roomier
   than the secondary without two competing `px-*` in one class string. */
const ACTION_BASE = `inline-flex min-h-[40px] min-w-0 items-center justify-center gap-1.5 rounded-control py-2 text-sm font-semibold transition-colors ${FOCUS_RING} sm:min-h-[36px]`;

/* px-4, not px-3: the CTA earns its primacy from padding and fill, never from taking the row. */
const PRIMARY_ACTION = `${ACTION_BASE} px-4 bg-primary text-white hover:opacity-90`;
const SECONDARY_ACTION = `${ACTION_BASE} px-3 border border-edge bg-surface font-medium text-content-muted hover:border-edge-strong hover:bg-surface-raised hover:text-content`;

/* Icon-only, so the tap target cannot borrow height from a label: a fixed 44px square instead, at
   every width. An unlabelled glyph is the smallest thing on this card to aim at, so it gets the
   biggest hit area — and it does not shrink at `sm:` the way a labelled control safely can. */
const ICON_ACTION = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-edge bg-surface text-content-muted transition-colors hover:border-edge-strong hover:bg-surface-raised hover:text-content ${FOCUS_RING}`;

/* Rides the honesty-label row. Capped at 60% so a long shop name can never push "TOKO REKANAN"
   off its own line; the label is the disclosure and always wins the space it needs. */
const STORE_LINK = `inline-flex min-h-[40px] min-w-0 max-w-[60%] items-center gap-1 rounded-control px-2 text-xs font-medium text-content-muted transition-colors hover:text-content ${FOCUS_RING} sm:min-h-0 sm:py-1`;

function ShopIcon() {
    return (
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14l-1 12H6L5 8zm4 0V6a3 3 0 016 0v2" />
        </svg>
    );
}

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
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 8V6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2M6 8h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a2 2 0 012-2z" />
        </svg>
    );
}

function ShareIcon() {
    return (
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
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
 * @param {'popup'|'area'|'landing'|'playback'} [props.placement] - the surface this card is being
 *   rendered on, supplied by the host slot. Used for one thing only: stamping the click beacons,
 *   so a tap is filed against the surface that earned it.
 */
export default function AffiliateOfferCard({ offer, className = '', placement }) {
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
            countAffiliateClick(offerId, AFFILIATE_LINK.PRODUCT, placement);
        }
    }, [offerId, productUrl, placement]);

    const handleStoreClick = useCallback(() => {
        if (storeUrl) {
            countAffiliateClick(offerId, AFFILIATE_LINK.STORE, placement);
        }
    }, [offerId, storeUrl, placement]);

    const handleWhatsAppClick = useCallback(() => {
        countAffiliateClick(offerId, AFFILIATE_LINK.WHATSAPP, placement);
    }, [offerId, placement]);

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
            {/* Disclosure row: what this block is, and — on the right — whose shop it is. */}
            <div className="flex items-center justify-between gap-2 pb-1.5">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-content-subtle">
                    <ShopIcon />
                    {disclosureFor('affiliate')}
                </span>

                {storeHref && (
                    <a
                        href={storeHref}
                        target="_blank"
                        rel="noopener noreferrer nofollow sponsored"
                        onClick={handleStoreClick}
                        aria-label={`Buka toko ${storeLabel}`}
                        title={`Buka toko ${storeLabel}`}
                        className={STORE_LINK}
                    >
                        <span className="truncate">{storeLabel}</span>
                        <ExternalLinkIcon />
                    </a>
                )}
            </div>

            <div className="rounded-card border border-edge bg-surface-sunken p-3">
                <div className="flex gap-3">
                    {offer.image_base && (
                        /* Thumbnail, not poster: a fixed square box, so a portrait upload cannot
                           make this card as tall as the phone. 160/320 covers 1× and 2× of it,
                           which is why the backend generates those two and nothing larger — it
                           loads under a live video, where every kilobyte competes with the
                           stream. */
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-card border border-edge bg-surface sm:h-20 sm:w-20">
                            <img
                                src={`${MEDIA_BASE}/${offer.image_base}-320.webp`}
                                srcSet={buildSrcSet(offer.image_base)}
                                sizes="(min-width: 640px) 80px, 64px"
                                width={offer.image_width || undefined}
                                height={offer.image_height || undefined}
                                alt={offer.product_title}
                                loading="lazy"
                                decoding="async"
                                /* max-w-full is redundant next to w-full inside an
                                   overflow-hidden fixed box, and it stays anyway: it is the
                                   clamp the mobile guard looks for, and it costs nothing. */
                                className="h-full w-full max-w-full object-cover"
                            />
                        </div>
                    )}

                    <div className="min-w-0 flex-1">
                        {/* One line, two jobs: the title yields space, the price never does. */}
                        <div className="flex items-baseline gap-2">
                            <h3 title={offer.product_title} className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug text-content">
                                {offer.product_title}
                            </h3>

                            {hasPrice && (
                                <span
                                    data-testid="affiliate-offer-price"
                                    className="shrink-0 text-sm font-bold tabular-nums text-content"
                                >
                                    {formatRupiah(offer.price_rupiah)}
                                </span>
                            )}
                        </div>

                        {offer.description && (
                            /* Clamped, not truncated to one line: the description is the only place
                               the partner gets to explain the product, but it must not push the
                               camera detail panel off the first screen of a phone. Two lines beside
                               an 80px thumbnail is the budget. */
                            <p className="mt-1 line-clamp-2 text-sm leading-snug text-content-muted">{offer.description}</p>
                        )}
                    </div>
                </div>

                {/* ONE action row. flex-wrap + min-w-0 + truncate: with Android font scaling at
                    1.3× a row of buttons is the classic way a card grows wider than the viewport,
                    so above 1× these wrap onto a second line instead of widening the card. */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a
                        href={productHref}
                        target="_blank"
                        rel="noopener noreferrer nofollow sponsored"
                        onClick={handleProductClick}
                        aria-label={`Lihat barang: ${offer.product_title}`}
                        className={PRIMARY_ACTION}
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
                            title={`Tanya barang ini lewat WhatsApp: ${offer.product_title}`}
                            className={SECONDARY_ACTION}
                        >
                            <WhatsAppIcon />
                            <span className="truncate">Tanya</span>
                        </a>
                    )}

                    {/* Both utilities share one link — the shop URL. With only the redirector
                        available there is nothing worth sending anyone, so they do not render.
                        Icon-only: the camera's own "Bagikan" sits a few pixels above this card, so
                        the label here has to name its object rather than repeat the verb. */}
                    {productUrl && (
                        <>
                            <button
                                type="button"
                                onClick={copyShareUrl}
                                aria-label="Salin link barang"
                                title="Salin link barang"
                                className={ICON_ACTION}
                            >
                                <CopyIcon />
                            </button>

                            <button
                                type="button"
                                onClick={handleShare}
                                aria-label="Bagikan barang"
                                title="Bagikan barang"
                                className={ICON_ACTION}
                            >
                                <ShareIcon />
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
