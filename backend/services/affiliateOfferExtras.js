/*
Purpose: Own the three OPTIONAL extras an affiliate offer may carry — a WhatsApp CTA, a product
         photo and a price — plus the exact shape of the public payload they feed.
Caller: affiliateOfferService only (create/update validation, public resolve, image cleanup).
Deps: utils/outboundUrlPolicy (isSafeOutboundUrl), services/promoImageService
      (AFFILIATE_IMAGE_OPTIONS + deletePromoImage — the photo REUSES the promo pipeline).
MainFuncs: normalizeWhatsAppNumber, normalizeWhatsAppMessage, normalizeProductPrice,
           buildOfferWhatsAppUrl, buildPublicPayload, deleteAffiliateImage,
           OFFER_EXTRA_FIELDS, PUBLIC_PAYLOAD_KEYS.
SideEffects: deleteAffiliateImage unlinks rendition files. Everything else is pure.

WHY THIS SITS BESIDE affiliateOfferService INSTEAD OF INSIDE IT
---------------------------------------------------------------
The service is the data/policy owner and is already 740 lines against the repo's 800-line budget.
These functions are pure and have exactly one caller, so they are the natural cut: nothing here
touches the database, the schedule, or the stats. The service re-exports buildPublicPayload and
buildOfferWhatsAppUrl, so every existing import path still resolves — the split is invisible to
callers and to tests, which is the same fs-cut-then-re-export shape the mega-service split uses.

WHY PRESENCE IS THE SWITCH FOR ALL THREE EXTRAS
------------------------------------------------
whatsapp_number, product_price_rupiah and image_base each gate themselves: filled means the
control appears, cleared means it is gone. There is deliberately NO show_whatsapp / show_price /
show_image boolean beside them, and adding one later would be a regression, not a feature: two
pieces of state describing one thing eventually disagree — a price that is set but hidden, or
shown but empty, with nothing in the row to say which was meant.

That makes the empty case load-bearing. An empty input must store NULL, and NULL is NOT 0:
`0` is a price of zero rupiah ("gratis"), NULL is "this offer does not advertise a price". So the
price normaliser here cannot be the service's normalizeRupiah, whose `?? 0` default would quietly
turn "no price" into "free" on the public card.

WHY THE REAL DESTINATION URL IS IN THE PAYLOAD (this reverses phase 1, deliberately)
-------------------------------------------------------------------------------------
Phase 1 emitted only the `/go` redirector, so the destination never left this process. That was
never a security property — a shop page is public by definition — it was a bet that a later phase
would not have to touch the frontend. The bet cost the product: this site's PWA manifest is scope
"/" with display "standalone", so a RELATIVE `/go` href is IN SCOPE. An installed PWA therefore
handles that navigation itself, follows the 302, and parks the visitor on a stranger's shop inside
our shell — no address bar, no back affordance, and no second origin to escape through (there is
one origin; api-cctv.raf.my.id is NXDOMAIN and everything is proxied by nginx).
An absolute https:// href is OUT of scope, so Android hands it to the real browser. That is the
platform's own rule rather than a workaround, and long-press → "copy link" then yields a shop
domain the recipient recognises instead of an opaque redirector on our domain.
`/go` stays: it is the no-JS fallback and it is what counts the click.

Both URLs are re-checked through isSafeOutboundUrl ON THE WAY OUT, not just on write. A row can be
older than that policy or edited straight in sqlite3, and what leaves here becomes an `href` in a
public page — `javascript:` in an anchor is a different and worse problem than it is in a
`Location:` header. What we cannot vouch for is emitted as null.

WHY {barang} AND {toko} SUBSTITUTE BUT {kamera} NEVER WILL
-----------------------------------------------------------
The WhatsApp template names the PRODUCT and the SHOP — the offer's own fields, both already public
on the card that carries the button. It does not name the camera, and this is the one thing in the
file that must not be "improved". The neighbouring promo resolver substitutes `{kamera}` into its
public cta_url, which meant a query with no camera_class filter could hand an anonymous caller the
NAME of an owner_private or subscriber camera — someone's home. Affiliate offers avoid that by
construction: the resolver selects `c.area_id` and nothing else, so there is no name in scope to
leak. Adding {kamera} would mean selecting the name, which would mean also adding the
`camera_class = 'community'` gate, and the gate is the kind of thing that gets dropped in a
refactor while the substitution survives. Two placeholders are enough.
*/

import { isSafeOutboundUrl } from '../utils/outboundUrlPolicy.js';
import { AFFILIATE_IMAGE_OPTIONS, deletePromoImage, isSafeImageBase } from './promoImageService.js';

/*
 * A WhatsApp opener, not a letter: the whole thing is percent-encoded into a URL that a phone has
 * to hand to another app, and an operator who needs more than this is writing a brochure, not a
 * greeting. Trimmed to this length on the way out too, so a legacy row cannot produce a
 * pathological wa.me link.
 */
export const MAX_WHATSAPP_MESSAGE_LEN = 300;

const DEFAULT_WHATSAPP_MESSAGE = 'Halo, saya ingin bertanya tentang {barang}.';

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

/**
 * Digits only; an Indonesian "08xx" becomes "628xx" because wa.me needs the country code and
 * every operator here types the local form. Same shape as promoBannerService.buildWhatsAppUrl —
 * the number is entered in two different admin panels and must not normalise two different ways.
 *
 * @returns {string} the international digits, or '' when there is nothing to dial
 */
export function toWhatsAppDigits(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

/**
 * WRITE side. Empty means NULL — that is how the button is switched off. A number that is present
 * but implausible is rejected rather than stored, because a wa.me link to a nonexistent number
 * fails silently inside WhatsApp where neither the operator nor we can see it.
 *
 * @returns {string|null}
 */
export function normalizeWhatsAppNumber(value) {
    const digits = toWhatsAppDigits(value);
    if (!digits) return null;
    if (digits.length < 9 || digits.length > 15) {
        throw badRequest('Nomor WhatsApp tidak valid (9-15 digit setelah kode negara)');
    }
    return digits;
}

/** WRITE side. Empty means NULL, and NULL means buildOfferWhatsAppUrl uses the default opener. */
export function normalizeWhatsAppMessage(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (text.length > MAX_WHATSAPP_MESSAGE_LEN) {
        throw badRequest(`Pesan WhatsApp maksimal ${MAX_WHATSAPP_MESSAGE_LEN} karakter`);
    }
    return text;
}

/**
 * WRITE side. INTEGER rupiah, never float (Critical Invariant) — a float here would be rounded by
 * whichever formatter got it first and print a price nobody set. Empty stores NULL ("no price
 * shown"); 0 is accepted and stores 0 ("gratis"). See the header on why those differ.
 *
 * @returns {number|null}
 */
export function normalizeProductPrice(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const num = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(num) || num < 0) {
        throw badRequest('Harga produk harus bilangan bulat rupiah (0 atau lebih), atau dikosongkan');
    }
    return num;
}

/*
 * column -> normaliser, so create and update wire these three the same way and cannot drift into
 * validating one field on create and not on update (the bug shape that lets an admin PUT store a
 * value the POST would have refused).
 */
export const OFFER_EXTRA_FIELDS = Object.freeze({
    whatsapp_number: normalizeWhatsAppNumber,
    whatsapp_message: normalizeWhatsAppMessage,
    product_price_rupiah: normalizeProductPrice,
});

/**
 * READ side. Prebuilt wa.me link for the public payload, or null when the offer has no number.
 *
 * Deliberately forgiving where the write path is strict: this runs on an anonymous request over
 * whatever the row actually holds, so a legacy or hand-edited number is normalised and used rather
 * than thrown over — a public card must not 500 because someone typed a stray character in the
 * panel last year. {barang}/{toko} only; never {kamera} (see the header).
 *
 * @param {{whatsapp_number?: string, whatsapp_message?: string, product_title?: string, store_name?: string}} row
 * @returns {string|null}
 */
export function buildOfferWhatsAppUrl(row) {
    const digits = toWhatsAppDigits(row?.whatsapp_number);
    if (!digits) return null;

    const message = String(row.whatsapp_message || DEFAULT_WHATSAPP_MESSAGE)
        .replace(/\{barang\}/gi, row.product_title || '-')
        .replace(/\{toko\}/gi, row.store_name || '-')
        .slice(0, MAX_WHATSAPP_MESSAGE_LEN);

    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * THE public contract: exactly these keys, in this order, always present. A test asserts
 * Object.keys() against this list, so adding a key means changing this line and being seen doing
 * it. Nothing else about an offer or its partner is public.
 */
export const PUBLIC_PAYLOAD_KEYS = Object.freeze([
    'id', 'product_title', 'description', 'store_name',
    'product_url', 'store_url', 'product_href', 'store_href',
    'whatsapp_url', 'price_rupiah',
    'image_base', 'image_width', 'image_height',
]);

/** Emit a value only when we can vouch for it; a doubtful field is null, never a guess. */
function safeOutbound(url) {
    return isSafeOutboundUrl(url) ? String(url).trim() : null;
}

/**
 * Build the thirteen public keys from a resolve row. NEVER `{ ...row, ... }`: the row is joined
 * against affiliate_partners, so a spread would ship the partner's price (what the OPERATOR
 * charges the shop — a different number from product_price_rupiah, which is what a visitor sees),
 * their contact note, the contract dates and the targeting to every anonymous visitor the moment
 * someone adds a column.
 *
 * The image trio is all-or-nothing and gated by the same filename allowlist the media route uses:
 * the frontend turns image_base into `/api/affiliate-media/<base>-320.webp`, so an unvalidated
 * base would be a path fragment we handed a browser. A base we do not recognise takes its
 * dimensions down with it — a width with no picture is worse than no picture.
 */
export function buildPublicPayload(row) {
    const storeUrl = safeOutbound(row.store_url);
    const hasImage = isSafeImageBase(row.image_base, AFFILIATE_IMAGE_OPTIONS);

    return {
        id: row.id,
        product_title: row.product_title,
        description: row.description || null,
        store_name: row.store_name,
        product_url: safeOutbound(row.product_url),
        store_url: storeUrl,
        product_href: `/api/public/affiliate/offers/${row.id}/go?l=p`,
        store_href: storeUrl ? `/api/public/affiliate/offers/${row.id}/go?l=s` : null,
        whatsapp_url: buildOfferWhatsAppUrl(row),
        price_rupiah: Number.isInteger(row.product_price_rupiah) ? row.product_price_rupiah : null,
        image_base: hasImage ? row.image_base : null,
        image_width: hasImage && Number.isInteger(row.image_width) ? row.image_width : null,
        image_height: hasImage && Number.isInteger(row.image_height) ? row.image_height : null,
    };
}

/**
 * Unlink every rendition of an offer photo. Bound to the affiliate options so a promo base handed
 * here fails the allowlist and removes nothing — the safe direction to fail in.
 *
 * @returns {number} files actually removed (0 is normal: replace and delete may race)
 */
export function deleteAffiliateImage(imageBase) {
    return deletePromoImage(imageBase, AFFILIATE_IMAGE_OPTIONS);
}

export default {
    MAX_WHATSAPP_MESSAGE_LEN,
    OFFER_EXTRA_FIELDS,
    PUBLIC_PAYLOAD_KEYS,
    toWhatsAppDigits,
    normalizeWhatsAppNumber,
    normalizeWhatsAppMessage,
    normalizeProductPrice,
    buildOfferWhatsAppUrl,
    buildPublicPayload,
    deleteAffiliateImage,
};
