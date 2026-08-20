/*
 * Purpose: Render one affiliate ("Toko rekanan") offer as a labelled card with up to two outbound
 *          links — the product itself and the partner's shop.
 * Caller: UnderVideoCommerceSlot (below the live video). Presentational only: it fetches nothing,
 *          counts nothing, and holds no state.
 * Deps: none (the payload arrives fully resolved from affiliateService).
 * MainFuncs: AffiliateOfferCard.
 * SideEffects: none. Clicks are counted server-side by the /go redirect the anchors point at.
 *
 * ── Why the anchors look the way they do ──────────────────────────────────────────────────────
 * `rel="noopener noreferrer nofollow sponsored"` — all four words are load-bearing:
 *   · noopener/noreferrer  the destination is a third-party page opened in a new tab; it must not
 *                          get a handle on this window.
 *   · nofollow + sponsored this is a PAID placement on a public-institution-adjacent domain.
 *                          Search engines are told so explicitly; anything less is undisclosed
 *                          link-selling.
 *   · noreferrer (again)   it also suppresses the Referer header, which matters here because the
 *                          backend cannot set Referrer-Policy for this hop — nginx.conf sets it at
 *                          server level and overrides whatever the app would send.
 *
 * `href` comes from the payload verbatim. It is our own redirector path
 * (`/api/public/affiliate/offers/<id>/go?l=p|s`), never the partner's URL, and this component must
 * never assemble one: the redirect re-checks the offer, the partner and the schedule on read, so a
 * deactivated partner stops resolving the moment the operator switches them off.
 *
 * `target="_blank"` also keeps the live stream playing behind the visitor — and, usefully, makes
 * the click a real top-level navigation (Sec-Fetch-Dest: document), which is exactly the shape the
 * backend counts. A prefetch or an <img src> pointing at the same path is not counted.
 *
 * ── Honesty ───────────────────────────────────────────────────────────────────────────────────
 * The "Toko rekanan" label is not decoration. It is the same shape as PromoBanner's "Promo" and
 * the ad slots' "Iklan": commercial content on a public surface says so, in the same place, every
 * time. Do not remove it and do not make it quieter than the surrounding copy.
 *
 * `status-fault` (red) is deliberately absent — a shop link is not a fault.
 */

/*
 * `rel` is written out as a literal on each anchor rather than shared through a constant: the
 * `react/jsx-no-target-blank` lint rule can only read a literal, and a rel this important is worth
 * being machine-checked at every call site.
 */
const ANCHOR_BASE = 'flex min-h-[40px] w-full min-w-0 items-center justify-center gap-1.5 rounded-control px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-h-0 sm:w-auto';

function ExternalLinkIcon() {
    return (
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18v4.5M17.5 6.5L10 14M16 13.5V18H6V8h4.5" />
        </svg>
    );
}

/**
 * @param {object} props
 * @param {object} props.offer - the six-key public payload:
 *   { id, product_title, description, store_name, product_href, store_href }
 * @param {string} [props.className] - wrapper classes supplied by the host slot
 */
export default function AffiliateOfferCard({ offer, className = '' }) {
    // No hooks in this component, so this early return cannot trip React error #310. Should any
    // hook ever be added here, it goes ABOVE this line.
    if (!offer?.product_title || !offer?.product_href) {
        return null;
    }

    const storeLabel = offer.store_name || 'Kunjungi toko';

    return (
        <article className={className || undefined} data-testid="affiliate-offer-card">
            <div className="flex items-center justify-between gap-2 pb-2">
                <span className="text-xs font-medium uppercase tracking-wide text-content-subtle">Toko rekanan</span>
            </div>

            <div className="rounded-card border border-edge bg-surface-sunken p-3">
                <h3 className="text-sm font-semibold leading-snug text-content">{offer.product_title}</h3>

                {offer.description && (
                    /* Clamped, not truncated to one line: the description is the only place the
                       partner gets to explain the product, but it must not push the camera detail
                       panel off the first screen of a phone. */
                    <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-content-muted">{offer.description}</p>
                )}

                {/* flex-wrap + min-w-0 + truncate: with Android font scaling at 1.3x a two-button
                    row is the classic way a card grows wider than the viewport. Here it stacks on
                    narrow screens and only shares a line from sm upwards. */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a
                        href={offer.product_href}
                        target="_blank"
                        rel="noopener noreferrer nofollow sponsored"
                        aria-label={`Lihat barang: ${offer.product_title}`}
                        className={`${ANCHOR_BASE} bg-primary text-white hover:opacity-90 sm:flex-1`}
                    >
                        <span className="truncate">Lihat barang</span>
                        <ExternalLinkIcon />
                    </a>

                    {offer.store_href && (
                        <a
                            href={offer.store_href}
                            target="_blank"
                            rel="noopener noreferrer nofollow sponsored"
                            aria-label={`Buka toko ${storeLabel}`}
                            className={`${ANCHOR_BASE} border border-edge bg-surface font-medium text-content-muted hover:border-edge-strong hover:bg-surface-raised hover:text-content sm:max-w-[50%]`}
                        >
                            <span className="truncate">{storeLabel}</span>
                            <ExternalLinkIcon />
                        </a>
                    )}
                </div>
            </div>
        </article>
    );
}
