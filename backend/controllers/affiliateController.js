/*
Purpose: HTTP handlers for the affiliate feature — the public offer resolve, the public /go
         endpoint (302 redirector AND click beacon), the admin product-photo upload, and admin
         CRUD over partners/offers plus per-offer stats.
Caller: backend/routes/affiliateRoutes.js.
Deps: affiliateOfferService (all data + policy), promoImageService (the shared upload→WebP
      pipeline, called with the affiliate options), affiliateCountThrottle,
      rateLimiter.resolveClientIp, securityAuditLogger.logAdminAction, controllerErrorLog.
MainFuncs: getPublicAffiliateOffer, goAffiliateOffer, uploadAffiliateOfferImage,
           list/get/create/update/delete Partner, list/get/create/update/delete Offer,
           getAffiliateOfferStats, shouldCountNavigation, shouldCountBeacon.
SideEffects: Writes daily stat rollups (best-effort), writes partner/offer rows via the service,
             writes WebP renditions under backend/data/affiliate, emits admin audit events, issues
             302 redirects to partner URLs.

WHY THE ADMIN BASE IS /api/admin/affiliate
------------------------------------------
middleware/rateLimiter.js buckets by URL PREFIX: RATE_LIMIT_CONFIG.adminPrefixes = ['/api/admin'],
everything else that is not /api/auth or whitelisted falls into the PUBLIC bucket (100 req/min per
client IP). Mount admin CRUD anywhere else — /api/affiliate/partners, say — and it silently shares
the public visitor bucket. An operator bulk-editing offers would then be rate-limited alongside
anonymous traffic, and the 429 would look like a bug in the panel. The prefix IS the configuration.

Symmetrically, the public routes live under /api/public/ because middleware/apiKeyValidator.js
whitelists that PREFIX (`publicPrefixes` contains '/api/public/'). The existing promo public route
sits at /api/promo-banners/public, which is NOT whitelisted — a latent bug that only stays invisible
while API_KEY_VALIDATION is lax. Not repeated here.

WHY THE REDIRECT IS 302 AND NEVER 301
-------------------------------------
301 is permanently cacheable: browsers, and Cloudflare in front of this origin, are entitled to
remember it forever. The whole point of routing outbound clicks through our own /go path is that
the destination is re-resolved on every hit — the partner's contract can end, the offer can be
deactivated, the URL can change. A cached 301 would keep sending visitors to a shop we no longer
have a deal with, from a domain that is adjacent to a public institution, with no way to revoke it
short of changing the URL. 302 + `Cache-Control: no-store` keeps every hit under live control.

WHY ONLY TOP-LEVEL NAVIGATIONS ARE COUNTED
------------------------------------------
A 302 is never rendered, so none of the usual embedding defences apply to it: X-Frame-Options and
frame-ancestors describe how a DOCUMENT may be framed, and a redirect has no document. That means
ANY third-party page can point <img src>, <iframe>, <link rel=prefetch> or fetch() at this endpoint
and mint clicks for a partner (or burn a competitor's reported numbers). We cannot stop the request
— it must still redirect, because a real browser sometimes sends odd headers — but we can decline
to COUNT it. Sec-Fetch-Dest/Sec-Fetch-Mode are set by the browser and are not settable from script
(forbidden header names), so they are trustworthy in the one direction we need: an <img> load says
`dest: image`, a real click says `dest: document`. Old browsers send neither header, so "neither
present" counts — otherwise we would under-report exactly the users least able to complain.
Prefetch/prerender hints are excluded for the opposite reason: the navigation may never happen.

WHY THERE ARE NOW TWO WAYS TO COUNT ONE CLICK — AND WHY THE NEW ONE IS STRICTER
------------------------------------------------------------------------------
The public payload now carries the partner's REAL https URL, so the card's anchor points straight
at the shop instead of at /go. That was not a security decision reversed lightly — a shop page is
public by definition and hiding its URL never protected anything — it was forced by the PWA. The
site's manifest is scope "/" + display "standalone", so a RELATIVE /go href is IN SCOPE: an
installed PWA follows the 302 itself and strands the visitor on a third-party shop inside our
shell, with no address bar and no way back (there is no second origin to escape to —
api-cctv.raf.my.id is NXDOMAIN, everything is one origin behind nginx). An absolute off-scope URL
is handed to the browser by Android — the platform's own behaviour, not a workaround — and a
long-press "copy link" then yields a domain the recipient recognises instead of an opaque
redirector on ours.

That moves the click OFF this endpoint, so the count has to travel separately:

    GET …/go?l=p|s|w&beacon=1   -> 204 No Content, counts, no Location header, no body.

The 302 path is untouched and remains the no-JS fallback. What changes is the gate: a beacon is
counted only when `sec-fetch-site` is `same-origin` or `same-site` — strictly less tolerant than
shouldCountNavigation() a few lines below, deliberately:

  * A beacon is fired by OUR javascript on OUR page, so "did this come from our own site" is
    exactly the truth condition for it. Anything else is forgery: without this gate any page
    anywhere could fetch() this URL in a loop and mint clicks a partner is invoiced against — and
    a 204 is even easier to fire than the 302 was, since nothing navigates.
  * shouldCountNavigation() CANNOT use that signal, which is why the two differ. A top-level
    navigation from anywhere is a real person walking to the shop, and Sec-Fetch-Site reads
    `cross-site` for a perfectly honest inbound link. That path can only ask "is this a navigation
    at all", and it must count the header-less case, because a browser too old for Fetch Metadata
    gets no second chance: the same request both counts the click and carries the visitor.
  * A beacon does get a second chance to be wrong harmlessly. Refusing to count one costs a stat
    row and nothing else — the visitor is already on their way via the real href, which the
    browser followed without asking us. Under-counting an ancient browser is recoverable; a forged
    number on an invoice is not. So the strict gate goes where the stakes are one-sided.

Sec-Fetch-Site is a forbidden header name (page script cannot set it) and referrer policy does not
strip it — the same property services/streamHotlinkPolicy.js leans on for the HLS hotlink gate.
That gate falls back to Origin/Referer when the header is absent; this one does not, because there
the fallback decides whether a visitor may WATCH, and here it decides only whether a counter moves.

WHY l=w HAS NO REDIRECT TARGET
------------------------------
`w` counts a WhatsApp tap. wa.me is a URL we could technically redirect to, but the deep link is
built into the payload and opened by the browser, so a `…/go?l=w` redirect would add nothing except
a stable, guessable entry point on our domain that opens a chat with a partner's phone number —
a free "our domain in front of your WhatsApp link" tool for anyone who finds it. `l=w` without
`beacon=1` is therefore a 404: countable, not navigable, on purpose.
*/

import affiliateOfferService from '../services/affiliateOfferService.js';
import {
    savePromoImage,
    MAX_AFFILIATE_UPLOAD_BYTES,
    AFFILIATE_IMAGE_OPTIONS,
} from '../services/promoImageService.js';
import { allowCount } from '../utils/affiliateCountThrottle.js';
import { resolveClientIp } from '../middleware/rateLimiter.js';
import { logAdminAction } from '../services/securityAuditLogger.js';
import { logControllerError } from '../utils/controllerErrorLog.js';

/**
 * Link kinds a /go URL may carry. `p` = product page, `s` = the shop itself, `w` = a WhatsApp tap.
 * Every one of them is countable; only p and s have somewhere to send a visitor.
 */
const LINK_KINDS = new Set(['p', 's', 'w']);
const REDIRECT_LINK_KINDS = new Set(['p', 's']);

function parseId(value) {
    const id = parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 4xx -> one stdout line (a refused request is an outcome, not a fault);
 * 5xx -> stderr with the stack. See utils/controllerErrorLog.js for the rationale.
 */
function fail(reply, error, label, fallback = 'Internal server error') {
    const code = error.statusCode || 500;
    logControllerError(label, error);
    return reply.code(code).send({ success: false, message: code === 500 ? fallback : error.message });
}

function adminContext(request) {
    return {
        adminUserId: request.user?.id,
        adminUsername: request.user?.username,
    };
}

/* ------------------------------------------------------------------ counting */

/**
 * Does this request look like a human actually going somewhere?
 *
 * Exported so it can be exercised directly with plain header objects — the interesting cases
 * (an <img> beacon, a prefetch, an ancient browser) are awkward to reproduce over real HTTP.
 *
 * @param {object} headers Lower-cased header bag (Node normalises names).
 * @returns {boolean}
 */
export function shouldCountNavigation(headers = {}) {
    const purpose = typeof headers.purpose === 'string' ? headers.purpose.trim().toLowerCase() : '';
    const secPurpose = typeof headers['sec-purpose'] === 'string' ? headers['sec-purpose'].toLowerCase() : '';
    // Firefox's legacy spelling; harmless to honour and it is the same intent.
    const mozPurpose = typeof headers['x-moz'] === 'string' ? headers['x-moz'].trim().toLowerCase() : '';

    if (purpose === 'prefetch' || secPurpose.includes('prefetch') || mozPurpose === 'prefetch') {
        return false;
    }

    const dest = typeof headers['sec-fetch-dest'] === 'string' ? headers['sec-fetch-dest'].trim().toLowerCase() : '';
    const mode = typeof headers['sec-fetch-mode'] === 'string' ? headers['sec-fetch-mode'].trim().toLowerCase() : '';

    if (dest === 'document' || mode === 'navigate') {
        return true;
    }
    // Neither header present at all: a browser too old to send Fetch Metadata. Count it.
    return dest === '' && mode === '';
}

/**
 * May THIS beacon move a counter?
 *
 * One header, one question: did the request come from our own site? Our card's click handler is
 * the only legitimate source of a beacon, and it only ever runs on our own page. `same-origin`
 * covers the SPA calling its own API; `same-site` covers a sibling subdomain, the same pair
 * services/streamHotlinkPolicy.js accepts for exactly this reason.
 *
 * Absent header => false, unlike shouldCountNavigation(). This is the one place the two gates
 * disagree, and it is intentional — the full argument is in the file header. Short version: the
 * navigation gate counts the header-less case because that request is also the visitor's ride to
 * the shop, so silence there costs a real person's click. A beacon that goes uncounted costs a
 * row in a stats table, while a beacon we count too eagerly ends up on an invoice.
 *
 * Exported so the interesting cases (cross-site fetch, header absent) can be exercised with a
 * plain header object.
 *
 * @param {object} headers Lower-cased header bag (Node normalises names).
 * @returns {boolean}
 */
export function shouldCountBeacon(headers = {}) {
    const site = typeof headers['sec-fetch-site'] === 'string' ? headers['sec-fetch-site'].trim().toLowerCase() : '';
    return site === 'same-origin' || site === 'same-site';
}

/**
 * `?beacon=1` — the frontend's "count this, do not send me anywhere" mode.
 * Accepts `true` as well so a hand-written call is not silently treated as a navigation; anything
 * else (including `0` and an empty value) leaves the request on the redirect path.
 */
function isBeaconRequest(query = {}) {
    const raw = typeof query.beacon === 'string' ? query.beacon.trim().toLowerCase() : '';
    return raw === '1' || raw === 'true';
}

/**
 * Best-effort stat writes. A counter is never allowed to cost the viewer their card or their
 * redirect, so every path here swallows failure — but it swallows it LOUDLY on stderr, because
 * the service is specified to guard its own UPSERT and therefore should not be throwing.
 */
function countImpression(request, offerId) {
    try {
        if (!allowCount(`${resolveClientIp(request)}:i:${offerId}`)) {
            return;
        }
        affiliateOfferService.recordImpression(offerId);
    } catch (error) {
        logControllerError('Affiliate impression write failed', error);
    }
}

/**
 * @param {object} request Fastify request.
 * @param {number} offerId
 * @param {'p'|'s'|'w'} link
 * @param {{beacon?: boolean}} [mode] Which gate applies — the two are NOT interchangeable, see the
 *        file header. The per-IP throttle key is shared between them on purpose: firing both the
 *        beacon and the 302 for one tap (a mis-wired frontend, or a no-JS fallback that also runs
 *        the handler) must still be one click.
 */
function countClick(request, offerId, link, { beacon = false } = {}) {
    try {
        const passesGate = beacon ? shouldCountBeacon : shouldCountNavigation;
        if (!passesGate(request.headers || {})) {
            return;
        }
        if (!allowCount(`${resolveClientIp(request)}:c:${offerId}:${link}`)) {
            return;
        }
        affiliateOfferService.recordClick(offerId, link);
    } catch (error) {
        logControllerError('Affiliate click write failed', error);
    }
}

/* ------------------------------------------------------------------- public */

/**
 * Resolve the one offer to show in this viewing context.
 *
 * Always 200. "No offer configured for this camera" is the normal state of the system, not an
 * error, and the public slot must not have to distinguish a 404 from a network failure. Even an
 * internal fault answers 200 with `data: null`: a broken affiliate table is not a reason to put a
 * red error state under a live camera. The fault still reaches stderr.
 *
 * `Cache-Control: no-store` is set FIRST so it applies on every exit path. The response is
 * per-viewer and it is the thing an impression was counted for — replaying it from a shared cache
 * would both leak one viewer's targeting to another and decouple the count from reality. For the
 * same reason this route must never be wired to cacheMiddleware.
 */
export async function getPublicAffiliateOffer(request, reply) {
    reply.header('Cache-Control', 'no-store');
    try {
        const { placement, cameraId, areaId } = request.query || {};
        const offer = affiliateOfferService.resolveOfferForContext({
            placement: typeof placement === 'string' ? placement : '',
            cameraId: parseId(cameraId),
            areaId: parseId(areaId),
        });

        if (offer) {
            countImpression(request, offer.id);
        }

        return reply.send({ success: true, data: offer || null });
    } catch (error) {
        logControllerError('Affiliate offer resolve', error);
        return reply.send({ success: true, data: null });
    }
}

/**
 * One endpoint, two jobs: /api/public/affiliate/offers/:id/go?l=p|s|w[&beacon=1]
 *
 *   without `beacon`  -> 302 to the partner (l=p|s), or 404 (l=w). The no-JS fallback, unchanged.
 *   with `beacon=1`   -> 204 No Content. Counts the tap; the browser is already going to the real
 *                        URL from the payload, so this response is never read.
 *
 * They are one route because they are one event, and the throttle key that de-duplicates a tap
 * only works if both paths pass through it.
 *
 * The redirect half re-checks liveness on every read (offer active, partner active, and the
 * partner's schedule) inside the service — a deactivated partner must not keep a working
 * redirector on this domain. Anything that fails that check is a 404, never a redirect: bouncing a
 * visitor to a shop whose contract ended is worse than a dead link.
 *
 * The beacon half deliberately does NOT re-resolve. It hands out nothing — no URL, no visitor, no
 * navigation — so there is no one to protect from a stale row, and the cost of being wrong is one
 * counted click on an offer that has just gone dark (which, being dark, is no longer being shown
 * to anyone, so the case barely occurs). Buying a second SELECT per tap for that is not a trade
 * worth making on a public request path. What still applies is the same-site gate above, the
 * per-IP throttle, and the service's own guarded UPSERT.
 *
 * A beacon answers 204 whatever happens — bad id, dead offer, cross-site caller. The status code
 * of a fire-and-forget request is a channel nobody reads, and making it informative would only
 * turn this into an oracle for probing which offer ids exist.
 *
 * NOTE ON reply.redirect(url, code): Fastify 4.28.1 already uses the (url, code) signature. The
 * legacy (code, url) order still works but emits FSTDEP021 on every hit — do not "fix" this back.
 */
export async function goAffiliateOffer(request, reply) {
    reply.header('Cache-Control', 'no-store');
    try {
        const beacon = isBeaconRequest(request.query || {});
        const id = parseId(request.params?.id);
        if (!id) {
            return beacon
                ? reply.code(204).send()
                : reply.code(404).send({ success: false, message: 'Tautan tidak ditemukan' });
        }

        const link = typeof request.query?.l === 'string' ? request.query.l.trim() : '';
        if (!LINK_KINDS.has(link)) {
            // Not defaulted to 'p' on purpose: guessing would file store interest as product
            // interest, and the stats are what a partner is invoiced against.
            return beacon
                ? reply.code(204).send()
                : reply.code(400).send({ success: false, message: 'Parameter tautan tidak valid' });
        }

        if (beacon) {
            countClick(request, id, link, { beacon: true });
            // 204 = no body, and notably no Location: nothing here is a navigation.
            return reply.code(204).send();
        }

        if (!REDIRECT_LINK_KINDS.has(link)) {
            // l=w on the navigation path. Countable, not navigable — see the file header.
            return reply.code(404).send({ success: false, message: 'Tautan tidak ditemukan' });
        }

        const target = affiliateOfferService.resolveOfferForRedirect(id, link);
        if (!target || !target.url) {
            return reply.code(404).send({ success: false, message: 'Tautan tidak ditemukan' });
        }

        // Count before redirecting: the service is synchronous (better-sqlite3), so the write is
        // already durable by the time the response leaves.
        countClick(request, id, link);

        return reply.redirect(target.url, 302);
    } catch (error) {
        return fail(reply, error, 'Affiliate redirect');
    }
}

/* ---------------------------------------------------------- admin: partners */

export async function listAffiliatePartners(request, reply) {
    try {
        return reply.send({ success: true, data: affiliateOfferService.listPartners() });
    } catch (error) {
        return fail(reply, error, 'Affiliate list partners');
    }
}

export async function getAffiliatePartner(request, reply) {
    try {
        const id = parseId(request.params?.id);
        const partner = id ? affiliateOfferService.getPartner(id) : null;
        if (!partner) {
            return reply.code(404).send({ success: false, message: 'Rekanan tidak ditemukan' });
        }
        return reply.send({ success: true, data: partner });
    } catch (error) {
        return fail(reply, error, 'Affiliate get partner');
    }
}

export async function createAffiliatePartner(request, reply) {
    try {
        const partner = affiliateOfferService.createPartner(request.body || {});
        // Audit payload carries identity only. contact_note can hold a personal WhatsApp number,
        // and the audit log is read by more people than the billing panel is.
        logAdminAction({
            action: 'affiliate_partner_created',
            targetType: 'affiliate_partner',
            targetId: partner.id,
            storeName: partner.store_name,
            ...adminContext(request),
        }, request);
        return reply.code(201).send({ success: true, message: 'Rekanan dibuat', data: partner });
    } catch (error) {
        return fail(reply, error, 'Affiliate create partner');
    }
}

export async function updateAffiliatePartner(request, reply) {
    try {
        const id = parseId(request.params?.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID rekanan tidak valid' });
        }
        const partner = affiliateOfferService.updatePartner(id, request.body || {});
        logAdminAction({
            action: 'affiliate_partner_updated',
            targetType: 'affiliate_partner',
            targetId: id,
            storeName: partner?.store_name,
            ...adminContext(request),
        }, request);
        return reply.send({ success: true, message: 'Rekanan diperbarui', data: partner });
    } catch (error) {
        return fail(reply, error, 'Affiliate update partner');
    }
}

export async function deleteAffiliatePartner(request, reply) {
    try {
        const id = parseId(request.params?.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID rekanan tidak valid' });
        }
        affiliateOfferService.deletePartner(id);
        logAdminAction({
            action: 'affiliate_partner_deleted',
            targetType: 'affiliate_partner',
            targetId: id,
            ...adminContext(request),
        }, request);
        return reply.send({ success: true, message: 'Rekanan dihapus' });
    } catch (error) {
        return fail(reply, error, 'Affiliate delete partner');
    }
}

/* ------------------------------------------------------------ admin: offers */

export async function listAffiliateOffers(request, reply) {
    try {
        return reply.send({ success: true, data: affiliateOfferService.listOffers() });
    } catch (error) {
        return fail(reply, error, 'Affiliate list offers');
    }
}

export async function getAffiliateOffer(request, reply) {
    try {
        const id = parseId(request.params?.id);
        const offer = id ? affiliateOfferService.getOffer(id) : null;
        if (!offer) {
            return reply.code(404).send({ success: false, message: 'Penawaran tidak ditemukan' });
        }
        return reply.send({ success: true, data: offer });
    } catch (error) {
        return fail(reply, error, 'Affiliate get offer');
    }
}

export async function createAffiliateOffer(request, reply) {
    try {
        const offer = affiliateOfferService.createOffer(request.body || {});
        logAdminAction({
            action: 'affiliate_offer_created',
            targetType: 'affiliate_offer',
            targetId: offer.id,
            productTitle: offer.product_title,
            ...adminContext(request),
        }, request);
        return reply.code(201).send({ success: true, message: 'Penawaran dibuat', data: offer });
    } catch (error) {
        return fail(reply, error, 'Affiliate create offer');
    }
}

export async function updateAffiliateOffer(request, reply) {
    try {
        const id = parseId(request.params?.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID penawaran tidak valid' });
        }
        const offer = affiliateOfferService.updateOffer(id, request.body || {});
        logAdminAction({
            action: 'affiliate_offer_updated',
            targetType: 'affiliate_offer',
            targetId: id,
            productTitle: offer?.product_title,
            ...adminContext(request),
        }, request);
        return reply.send({ success: true, message: 'Penawaran diperbarui', data: offer });
    } catch (error) {
        return fail(reply, error, 'Affiliate update offer');
    }
}

/**
 * Store a product photo for one offer: POST /api/admin/affiliate/offers/:id/image
 *
 * base64-in-JSON rather than multipart, for the same reason the promo poster is: this is a rare
 * admin action on a file of a few MB, and the ~33% transfer overhead buys not adding a body-parsing
 * dependency to an API surface that is otherwise all JSON.
 *
 * The pipeline itself is promoImageService, called with AFFILIATE_IMAGE_OPTIONS — same magic-byte
 * allowlist, same ffmpeg re-encode (which is what actually guarantees the stored file is an image
 * and not a polyglot), different directory, renditions and filename prefix. A product photo is a
 * small card image, so it lands as 320px + 160px WebP under backend/data/affiliate, not as the
 * 1200px poster pair.
 *
 * TWO SIZE CEILINGS GUARD THIS ROUTE AND THEY MUST AGREE:
 *   middleware/inputSanitizer.js  LARGE_BODY_ROUTES -> 8 MiB (8388608), matched on METHOD + WHOLE
 *                                 PATH, and enforced from an onRequest hook that runs BEFORE auth;
 *   routes/affiliateRoutes.js     bodyLimit         -> 7344128 bytes, i.e. the 5 MiB decoded
 *                                 ceiling inflated 1.4x for base64 plus 4 KiB of JSON envelope.
 * The route limit sits under the middleware allowance, so the middleware never rejects a body the
 * route would have accepted, and the route rejects before ffmpeg is ever reached. Changing one
 * without the other produces a 413 from whichever is lower and a puzzled operator.
 *
 * The encoded-length check below is a third, cheaper gate: it refuses on the base64 string length
 * so a 10 MB decode is never allocated just to be rejected by savePromoImage a line later.
 */
export async function uploadAffiliateOfferImage(request, reply) {
    try {
        const id = parseId(request.params?.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID penawaran tidak valid' });
        }

        const raw = request.body?.data;
        if (typeof raw !== 'string' || raw.length === 0) {
            return reply.code(400).send({ success: false, message: 'Data gambar tidak ada' });
        }
        // Tolerate a browser-style data URL prefix as well as bare base64.
        const base64 = raw.includes(',') && raw.slice(0, 64).includes('base64') ? raw.slice(raw.indexOf(',') + 1) : raw;

        if (base64.length > Math.ceil(MAX_AFFILIATE_UPLOAD_BYTES / 3) * 4 + 8) {
            return reply.code(413).send({
                success: false,
                message: `Ukuran gambar melebihi ${Math.round(MAX_AFFILIATE_UPLOAD_BYTES / (1024 * 1024))}MB`,
            });
        }

        const image = await savePromoImage(Buffer.from(base64, 'base64'), AFFILIATE_IMAGE_OPTIONS);
        const offer = affiliateOfferService.setOfferImage(id, image);

        logAdminAction({
            action: 'affiliate_offer_image_uploaded',
            targetType: 'affiliate_offer',
            targetId: id,
            imageBase: image.imageBase,
            imageBytes: image.bytes,
            ...adminContext(request),
        }, request);

        return reply.send({
            success: true,
            message: 'Gambar diunggah',
            data: { offer, image },
        });
    } catch (error) {
        return fail(reply, error, 'Affiliate image upload', 'Gagal mengunggah gambar');
    }
}

export async function deleteAffiliateOffer(request, reply) {
    try {
        const id = parseId(request.params?.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID penawaran tidak valid' });
        }
        affiliateOfferService.deleteOffer(id);
        logAdminAction({
            action: 'affiliate_offer_deleted',
            targetType: 'affiliate_offer',
            targetId: id,
            ...adminContext(request),
        }, request);
        return reply.send({ success: true, message: 'Penawaran dihapus' });
    } catch (error) {
        return fail(reply, error, 'Affiliate delete offer');
    }
}

export async function getAffiliateOfferStats(request, reply) {
    try {
        const id = parseId(request.params?.id);
        if (!id) {
            return reply.code(400).send({ success: false, message: 'ID penawaran tidak valid' });
        }
        const days = parseInt(request.query?.days, 10);
        return reply.send({
            success: true,
            data: affiliateOfferService.getOfferStats(id, Number.isInteger(days) ? days : 30),
        });
    } catch (error) {
        return fail(reply, error, 'Affiliate offer stats');
    }
}
