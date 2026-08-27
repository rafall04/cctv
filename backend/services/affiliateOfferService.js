/*
Purpose: Own the affiliate feature's data rules — pick ONE partner offer for a viewing context,
         resolve the /go target, count impressions/clicks/WhatsApp taps, and serve admin CRUD.
Caller: affiliateController (public resolve + /go redirect, admin partner/offer CRUD + stats + photo).
Deps: database/connectionPool (query/queryOne/execute/transaction), services/timeService
      (getLocalDate — WIB), utils/outboundUrlPolicy (https-only URL validation),
      services/affiliateOfferExtras (WhatsApp/price/photo rules + the public payload shape),
      services/affiliateStatsService (placement vocabulary + the per-surface counters).
MainFuncs: resolveOfferForContext, resolveOfferForRedirect, recordImpression, recordClick,
           listPartners/getPartner/createPartner/updatePartner/deletePartner, listOffers/getOffer/
           createOffer/updateOffer/deleteOffer/setOfferTargets/setOfferImage, getOfferStats.
SideEffects: Reads/writes affiliate_partners, affiliate_offers, affiliate_offer_targets,
             affiliate_offer_stats; unlinks offer photos. Reads cameras.area_id (ONLY — see below).

WHY THE PUBLIC PAYLOAD IS HAND-BUILT AND NEVER A SPREAD ROW
-----------------------------------------------------------
buildPublicPayload (services/affiliateOfferExtras.js) names all thirteen keys literally and must
never become `{ ...row, href }`: the row it is handed is joined against affiliate_partners, so a
spread would ship the partner's price, contact note, schedule and targeting to every anonymous
visitor the moment someone adds a column. RESOLVE_SELECT below is a second, independent
allow-list, so a leak needs two mistakes rather than one. Both destination URLs ARE public now —
that file's header carries why phase 1 reversed, and why they are still re-validated on the way out.

WHY THE CAMERA NAME IS DELIBERATELY NOT READ (even now that a template exists)
------------------------------------------------------------------------------
The camera lookup selects `area_id` and nothing else. The neighbouring promo resolver
(promoBannerService.resolvePromoBannerForContext) carried a comment claiming "no camera field is
ever echoed back to the caller" while three lines later it kept `camera.name` and substituted it
into the public `cta_url` — on a query with no camera_class filter, so a PRIVATE or SUBSCRIBER
camera's name reached an anonymous caller. That comment was false and this file must not inherit
it. The WhatsApp template added here substitutes {barang} and {toko} — the offer's own product and
shop, both already public on the card carrying the button — and NOTHING else. {kamera} would mean
reading a name, and not reading it is what makes the leak impossible rather than merely
unintended; anyone adding it must add the `camera_class = 'community'` gate too. Do not select the
name "just in case".

WHY LIVENESS IS ONE JS PREDICATE, NOT A SQL WHERE CLAUSE
--------------------------------------------------------
"Is this offer live?" is asked from two places — the public resolve and the /go redirect —
and the two must never drift, because a rule enforced in only one of them is not a rule.
Expressing it as a shared SQL fragment would still leave the admin panel's "Tayang" badge
computing it a third way. So the schedule window lives in exactly one function,
partnerScheduleState(), which resolve, redirect and the admin projection all call. The SQL
does targeting and ORDER BY (which it must, to pick a winner); liveness is filtered in JS on
the way out, the same shape as the promo resolver's placements pass. The cost is fetching a
few extra rows from a table holding a handful of shops — nil against the risk of two
divergent definitions.

WHY THE REDIRECT RE-CHECKS LIVENESS INSTEAD OF TRUSTING THE ID
---------------------------------------------------------------
`/api/public/affiliate/offers/12/go?l=p` is a stable, guessable, cacheable URL on OUR domain,
and once it exists people bookmark it, paste it into WhatsApp, and third parties embed it. If
the redirect only checked that the row exists, then deactivating a partner — or letting their
term expire — would leave a working redirector on a public-institution-adjacent domain
pointing at a shop we no longer have a contract with, forever, with no page to take down.
Liveness is therefore a property of the READ, not of the write: offer.active AND
partner.active AND the schedule window. Failing that is a 404, never a redirect. The stored
URL is re-validated through isSafeOutboundUrl on the same path, because a row can be older
than the policy or edited by hand in sqlite3.

WHY DATES ARE LOCAL (WIB) BUT updated_at IS UTC
-----------------------------------------------
Anything an operator reasons about as "a day" — the contract window and the stats rollup —
uses getLocalDate(). SQLite's date('now') is UTC, which is a different day for the first 7
hours of every WIB day: a contract would expire, and a click would land on yesterday's row,
while it is still today in Bojonegoro. Row timestamps (created_at/updated_at) stay UTC to
match the CURRENT_TIMESTAMP default the migration gives created_at; mixing the two zones in
one column pair is what makes such a column unreadable later.

WHERE THE COUNTERS LIVE (AND WHY THEY MOVED)
--------------------------------------------
Every count now has to say WHICH SURFACE it happened on, and this file had one line of headroom
against the 800-line ratchet. services/affiliateStatsService.js therefore owns the placement
vocabulary, the two frozen lookup maps, the guarded UPSERT and the admin rollup; the methods below
are thin delegates and the module is re-exported at the bottom, so every existing import path still
resolves. Its header carries the reasoning the counters used to argue for here.
*/

import { query, queryOne, execute, transaction } from '../database/connectionPool.js';
import { getLocalDate } from './timeService.js';
import { assertSafeOutboundUrl, isSafeOutboundUrl } from '../utils/outboundUrlPolicy.js';
import {
    OFFER_EXTRA_FIELDS, buildPublicPayload, buildOfferWhatsAppUrl, deleteAffiliateImage,
    normalizeWhatsAppNumber, normalizeWhatsAppMessage, normalizeProductPrice,
} from './affiliateOfferExtras.js';
import {
    AFFILIATE_PLACEMENTS, readOfferStats, recordOfferClick, recordOfferImpression,
} from './affiliateStatsService.js';

export const AFFILIATE_TARGET_MODES = ['all', 'area', 'camera'];
export const AFFILIATE_BILLING_MODES = ['lifetime', 'term'];

const TEXT_LIMITS = { store_name: 120, contact_note: 500, product_title: 160, description: 500 };

/* ------------------------------------------------------------------ small helpers */

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

function notFound(message) {
    const err = new Error(message);
    err.statusCode = 404;
    return err;
}

/** Strict id coercion: '12' -> 12, but '12abc'/''/0/-1/null -> null (parseInt would accept '12abc'). */
function toPositiveInt(value) {
    const num = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    return Number.isInteger(num) && num > 0 ? num : null;
}

function toActiveFlag(value, fallback = 1) {
    if (value === undefined || value === null) return fallback;
    if (value === false || value === 0 || value === '0' || value === 'false') return 0;
    return 1;
}

function nowSql() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function normalizeText(value, key, { required = false } = {}) {
    const label = {
        store_name: 'Nama toko', contact_note: 'Catatan kontak',
        product_title: 'Judul produk', description: 'Deskripsi',
    }[key];
    const text = String(value ?? '').trim();
    if (!text) {
        if (required) throw badRequest(`${label} wajib diisi`);
        return null;
    }
    if (text.length > TEXT_LIMITS[key]) {
        throw badRequest(`${label} maksimal ${TEXT_LIMITS[key]} karakter`);
    }
    return text;
}

/**
 * Money rule: INTEGER rupiah, never float. ZERO IS LEGITIMATE and deliberate — the operator
 * runs their own shop through this same machinery for free. Never add a "paid plans cannot be
 * zero" rule here.
 */
function normalizeRupiah(value) {
    const num = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isInteger(num) || num < 0) {
        throw badRequest('Harga harus bilangan bulat rupiah (0 atau lebih)');
    }
    return num;
}

function normalizePriority(value) {
    if (value === undefined || value === null || value === '') return 100;
    const num = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(num)) throw badRequest('Prioritas harus bilangan bulat');
    return num;
}

/** Calendar-day strings only ('YYYY-MM-DD'); the schedule compares them lexically. */
function normalizeDate(value, label) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const text = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw badRequest(`${label} harus berformat YYYY-MM-DD`);
    }
    return text;
}

function normalizeOptionalUrl(value, label) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    return assertSafeOutboundUrl(value, label);
}

/** A malformed placements blob must mean "matches nothing", not take the public route down. */
export function parsePlacements(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.filter((p) => AFFILIATE_PLACEMENTS.includes(p)) : [];
    } catch {
        return [];
    }
}

export function normalizePlacements(input) {
    const list = Array.isArray(input) ? input : [];
    const cleaned = [...new Set(list.filter((p) => AFFILIATE_PLACEMENTS.includes(p)))];
    if (cleaned.length === 0) throw badRequest('Pilih minimal satu lokasi tampil');
    return cleaned;
}

export function normalizeTargetMode(mode) {
    if (!AFFILIATE_TARGET_MODES.includes(mode)) {
        throw badRequest(`target_mode harus salah satu dari: ${AFFILIATE_TARGET_MODES.join(', ')}`);
    }
    return mode;
}

export function normalizeBillingMode(mode) {
    if (!AFFILIATE_BILLING_MODES.includes(mode)) {
        throw badRequest(`billing_mode harus salah satu dari: ${AFFILIATE_BILLING_MODES.join(', ')}`);
    }
    return mode;
}

/* ------------------------------------------------------- liveness (single source) */

/**
 * THE schedule evaluator. Resolve, redirect and the admin badge all come through here so the
 * three can never disagree.
 *
 * 'lifetime' skips the end_date check by definition (the migration's contract: a lifetime deal
 * has no end date). start_date still applies to both modes — a deal signed today to begin next
 * month has not begun, whichever way it is billed.
 *
 * @returns {'missing'|'inactive'|'not_started'|'expired'|'live'}
 */
export function partnerScheduleState(partner, today = getLocalDate()) {
    if (!partner) return 'missing';
    if (!Number(partner.active)) return 'inactive';
    if (partner.start_date && partner.start_date > today) return 'not_started';
    if (partner.billing_mode !== 'lifetime' && partner.end_date && partner.end_date < today) {
        return 'expired';
    }
    return 'live';
}

/** Offer-level AND partner-level predicate, over a row joined by RESOLVE_SELECT/REDIRECT_SELECT. */
function isOfferRowLive(row, today = getLocalDate()) {
    if (!row || !Number(row.offer_active)) return false;
    return partnerScheduleState({
        active: row.partner_active,
        billing_mode: row.billing_mode,
        start_date: row.start_date,
        end_date: row.end_date,
    }, today) === 'live';
}

/* --------------------------------------------------------------- public resolution */

/**
 * The SELECT list IS the first allow-list, and it remains one even now that both destination URLs
 * are public: it still never reads the partner's price_rupiah (what the operator charges the
 * shop), their contact_note, or partner_id, and it reads nothing about the contract beyond the
 * four columns liveness needs. Add a column here only once buildPublicPayload actually emits it.
 */
const RESOLVE_SELECT = `
    SELECT o.id, o.product_title, o.description, o.placements, o.product_url,
           o.whatsapp_number, o.whatsapp_message, o.product_price_rupiah,
           o.image_base, o.image_width, o.image_height, o.active AS offer_active,
           p.store_name, p.store_url,
           p.active AS partner_active, p.billing_mode, p.start_date, p.end_date,
           /*
            * Satu skalar urutan, dan HANYA itu: spesifisitas dulu, lalu prioritas. Ia ada
            * supaya sisi JS bisa mengenali baris-baris yang benar-benar SERI tanpa membaca
            * target_mode maupun priority satu per satu - dan tanpa melanggar daftar izin di
            * atas, karena angka ini tidak mengandung apa pun tentang mitra, harga, atau
            * kontrak, dan buildPublicPayload tetap menyusun muatannya kunci demi kunci.
            */
           (CASE o.target_mode WHEN 'camera' THEN 0 WHEN 'area' THEN 1 ELSE 2 END) * 1000000
               + o.priority AS rank_slot
    FROM affiliate_offers o
    JOIN affiliate_partners p ON p.id = o.partner_id
    WHERE (
            o.target_mode = 'all'
         OR (o.target_mode = 'camera' AND ? IS NOT NULL AND EXISTS (
                SELECT 1 FROM affiliate_offer_targets t
                WHERE t.offer_id = o.id AND t.target_type = 'camera' AND t.target_id = ?
            ))
         OR (o.target_mode = 'area' AND ? IS NOT NULL AND EXISTS (
                SELECT 1 FROM affiliate_offer_targets t
                WHERE t.offer_id = o.id AND t.target_type = 'area' AND t.target_id = ?
            ))
    )
    ORDER BY rank_slot ASC, o.id ASC
`;

const REDIRECT_SELECT = `
    SELECT o.id, o.active AS offer_active, o.product_url,
           p.store_url, p.active AS partner_active, p.billing_mode, p.start_date, p.end_date
    FROM affiliate_offers o
    JOIN affiliate_partners p ON p.id = o.partner_id
    WHERE o.id = ?
`;

/* ---------------------------------------------------------------------- admin SQL */

const PARTNER_SELECT = `
    SELECT p.*,
        (SELECT COUNT(*) FROM affiliate_offers o WHERE o.partner_id = p.id) AS offer_count,
        (SELECT COUNT(*) FROM affiliate_offers o WHERE o.partner_id = p.id AND o.active = 1) AS active_offer_count
    FROM affiliate_partners p
`;

const OFFER_SELECT = `
    SELECT o.*,
        p.store_name, p.active AS partner_active, p.billing_mode, p.start_date, p.end_date,
        (SELECT COALESCE(SUM(s.impressions), 0) FROM affiliate_offer_stats s WHERE s.offer_id = o.id) AS total_impressions,
        (SELECT COALESCE(SUM(s.product_clicks), 0) FROM affiliate_offer_stats s WHERE s.offer_id = o.id) AS total_product_clicks,
        (SELECT COALESCE(SUM(s.store_clicks), 0) FROM affiliate_offer_stats s WHERE s.offer_id = o.id) AS total_store_clicks,
        (SELECT COALESCE(SUM(s.whatsapp_clicks), 0) FROM affiliate_offer_stats s WHERE s.offer_id = o.id) AS total_whatsapp_clicks
    FROM affiliate_offers o
    JOIN affiliate_partners p ON p.id = o.partner_id
`;

function decoratePartner(row) {
    if (!row) return null;
    const state = partnerScheduleState(row);
    return { ...row, schedule_state: state, is_live: state === 'live' ? 1 : 0 };
}

function decorateOffer(row) {
    if (!row) return null;
    const targets = query(
        'SELECT target_type, target_id FROM affiliate_offer_targets WHERE offer_id = ? ORDER BY target_id',
        [row.id]
    );
    const live = isOfferRowLive({ ...row, offer_active: row.active });
    return {
        ...row,
        placements: parsePlacements(row.placements),
        area_ids: targets.filter((t) => t.target_type === 'area').map((t) => t.target_id),
        camera_ids: targets.filter((t) => t.target_type === 'camera').map((t) => t.target_id),
        partner_schedule_state: partnerScheduleState({
            active: row.partner_active,
            billing_mode: row.billing_mode,
            start_date: row.start_date,
            end_date: row.end_date,
        }),
        is_live: live ? 1 : 0,
    };
}

/*
 * Benih rotasi harian, dihitung dari string 'YYYY-MM-DD' dan BUKAN dari jam mesin, supaya
 * dua panggilan pada hari yang sama selalu memilih pemenang yang sama - termasuk di dalam tes.
 *
 * KENAPA ROTASI ITU PERLU
 * Sebelum ini ikatan diputus `o.id DESC`, jadi ketika dua tawaran mengincar kamera yang sama
 * dengan prioritas yang sama, yang lebih TUA padam selamanya - tidak pernah satu impresi pun,
 * sementara mitranya tetap ditagih. Tidak ada galat, tidak ada peringatan; hanya satu mitra
 * yang perlahan menyimpulkan bahwa permukaan ini tidak menghasilkan apa-apa.
 *
 * Ini GILIRAN sungguhan, bukan pengocokan: di antara tawaran yang seri, hari ke-n memilih
 * indeks n % jumlah. Dua tawaran seri berbagi hari persis 50/50, tiga berbagi 1/3.
 *
 * Percobaan pertama memakai `(o.id + hari) % 997` sebagai pemutus ikatan di dalam SQL, dan itu
 * CACAT: untuk id yang berdampingan - 31 dan 32, bentuk yang paling wajar terjadi ketika dua
 * tawaran dibuat berurutan - selisihnya selalu tetap 1, jadi pemenangnya tidak pernah berganti
 * kecuali pada satu hari dalam 997 saat nilainya membelit. Praktis sama saja dengan id ASC.
 * Terbukti merah oleh tes di bawah, bukan oleh pembacaan ulang.
 */
function dayRotationSeed(today) {
    const [tahun, bulan, hari] = String(today).split('-').map(Number);
    if (!tahun || !bulan || !hari) return 0;
    return Math.floor(Date.UTC(tahun, bulan - 1, hari) / 86400000);
}

/* ------------------------------------------------------------------------ service */

class AffiliateOfferService {
    /**
     * Pick the single best live offer for one viewing context.
     * Specificity beats priority: an offer aimed at this camera beats one aimed at its area,
     * which beats a catch-all; then the lower priority number. Offers still tied after that
     * ROTATE by calendar day - see dayRotationSeed above for why, and for what it does and
     * does not promise.
     *
     * @param {{placement: string, cameraId?: number|string, areaId?: number|string}} context
     * @returns {object|null} the six-key public payload, or null when nothing matches
     */
    resolveOfferForContext({ placement, cameraId = null, areaId = null } = {}) {
        if (!AFFILIATE_PLACEMENTS.includes(placement)) return null;

        let cameraKey = toPositiveInt(cameraId);
        let areaKey = toPositiveInt(areaId);

        if (cameraKey) {
            // area_id and NOTHING else. See "WHY THE CAMERA NAME IS DELIBERATELY NOT READ".
            const camera = queryOne('SELECT area_id FROM cameras WHERE id = ?', [cameraKey]);
            if (camera) {
                areaKey = toPositiveInt(camera.area_id) ?? areaKey;
            } else {
                // Unknown camera: drop the context rather than match a stale target row that
                // still names a deleted camera's id.
                cameraKey = null;
            }
        }

        const today = getLocalDate();
        const rows = query(RESOLVE_SELECT, [cameraKey, cameraKey, areaKey, areaKey]);
        const eligible = rows.filter(
            (row) => isOfferRowLive(row, today) && parsePlacements(row.placements).includes(placement)
        );
        if (eligible.length === 0) return null;

        /*
         * Hanya baris yang berbagi peringkat TERATAS yang ikut giliran. Peringkat lebih rendah
         * tidak pernah mendapat hari: tawaran yang mengincar kamera ini secara khusus tidak
         * boleh kalah bergilir dari tawaran umum, karena kecocokannya itulah yang membuat
         * permukaan ini bekerja.
         */
        const teratas = eligible[0].rank_slot;
        const seri = eligible.filter((row) => row.rank_slot === teratas);
        const match = seri[dayRotationSeed(today) % seri.length];
        return buildPublicPayload(match);
    }

    /**
     * Resolve the destination for /go. Re-checks liveness on every read — see the file header.
     *
     * 'w' counts but has no destination: the WhatsApp anchor points straight at wa.me, so /go?l=w
     * exists only as a beacon. Null (a 404) rather than falling through to the product URL, which
     * would file one intent as another and land the visitor somewhere else.
     *
     * @param {number|string} offerId
     * @param {'p'|'s'|'w'} link
     * @returns {{url: string}|null} null means 404; the caller must never redirect on null
     */
    resolveOfferForRedirect(offerId, link) {
        const id = toPositiveInt(offerId);
        if (!id || (link !== 'p' && link !== 's')) return null;

        const row = queryOne(REDIRECT_SELECT, [id]);
        if (!isOfferRowLive(row)) return null;

        // Chosen by branch, not by interpolating `link` into the SELECT.
        const url = link === 'p' ? row.product_url : row.store_url;

        // Re-validate what the row actually holds: it may predate this policy, or have been
        // edited straight in sqlite3. A row we cannot vouch for is a 404, not a redirect.
        if (!isSafeOutboundUrl(url)) return null;

        return { url: String(url).trim() };
    }

    /**
     * Best-effort counter. Never throws — see affiliateStatsService.
     *
     * @param {number|string} offerId
     * @param {'popup'|'area'|'landing'|'playback'} placement WHERE it was shown. No default: a
     *        caller that omits it counts nothing, rather than inflating another surface's number.
     */
    recordImpression(offerId, placement) {
        recordOfferImpression(offerId, placement);
    }

    /**
     * Best-effort counter for 'p' | 's' | 'w' (product / store / WhatsApp) on ONE surface. Never
     * throws — an unknown link or an unknown/missing placement included.
     *
     * @param {number|string} offerId
     * @param {'p'|'s'|'w'} link
     * @param {'popup'|'area'|'landing'|'playback'} placement REQUIRED, as above.
     */
    recordClick(offerId, link, placement) {
        recordOfferClick(offerId, link, placement);
    }

    /* ------------------------------------------------------------ partners (admin) */

    listPartners() {
        return query(`${PARTNER_SELECT} ORDER BY p.active DESC, p.store_name COLLATE NOCASE ASC`)
            .map(decoratePartner);
    }

    getPartner(id) {
        return decoratePartner(queryOne(`${PARTNER_SELECT} WHERE p.id = ?`, [toPositiveInt(id)]));
    }

    requirePartnerRow(id) {
        const partner = queryOne('SELECT * FROM affiliate_partners WHERE id = ?', [toPositiveInt(id)]);
        if (!partner) throw notFound('Partner tidak ditemukan');
        return partner;
    }

    createPartner(data = {}) {
        const storeName = normalizeText(data.store_name, 'store_name', { required: true });
        const billingMode = normalizeBillingMode(data.billing_mode ?? 'term');
        const startDate = normalizeDate(data.start_date, 'Tanggal mulai');
        // A lifetime contract has no end date by definition (see the migration's header).
        const endDate = billingMode === 'lifetime'
            ? null
            : normalizeDate(data.end_date, 'Tanggal berakhir');
        if (startDate && endDate && endDate < startDate) {
            throw badRequest('Tanggal berakhir tidak boleh sebelum tanggal mulai');
        }

        const result = execute(`
            INSERT INTO affiliate_partners
                (store_name, store_url, contact_note, billing_mode, price_rupiah,
                 start_date, end_date, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            storeName,
            normalizeOptionalUrl(data.store_url, 'URL toko'),
            normalizeText(data.contact_note, 'contact_note'),
            billingMode,
            normalizeRupiah(data.price_rupiah ?? 0),
            startDate,
            endDate,
            toActiveFlag(data.active),
        ]);
        return this.getPartner(result.lastInsertRowid);
    }

    updatePartner(id, data = {}) {
        const existing = this.requirePartnerRow(id);
        const fields = [];
        const values = [];
        const assign = (column, value) => { fields.push(`${column} = ?`); values.push(value); };

        if (data.store_name !== undefined) {
            assign('store_name', normalizeText(data.store_name, 'store_name', { required: true }));
        }
        if (data.store_url !== undefined) {
            assign('store_url', normalizeOptionalUrl(data.store_url, 'URL toko'));
        }
        if (data.contact_note !== undefined) {
            assign('contact_note', normalizeText(data.contact_note, 'contact_note'));
        }
        if (data.price_rupiah !== undefined) assign('price_rupiah', normalizeRupiah(data.price_rupiah));
        if (data.active !== undefined) assign('active', toActiveFlag(data.active));

        const billingMode = data.billing_mode !== undefined
            ? normalizeBillingMode(data.billing_mode)
            : existing.billing_mode;
        if (data.billing_mode !== undefined) assign('billing_mode', billingMode);

        const startDate = data.start_date !== undefined
            ? normalizeDate(data.start_date, 'Tanggal mulai')
            : (existing.start_date || null);
        if (data.start_date !== undefined) assign('start_date', startDate);

        // Switching to lifetime clears any leftover end date, so the stored row cannot say
        // "lifetime" and "expires in March" at the same time.
        let endDate = data.end_date !== undefined
            ? normalizeDate(data.end_date, 'Tanggal berakhir')
            : (existing.end_date || null);
        if (billingMode === 'lifetime') {
            if (endDate !== null || data.end_date !== undefined) assign('end_date', null);
            endDate = null;
        } else if (data.end_date !== undefined) {
            assign('end_date', endDate);
        }
        if (startDate && endDate && endDate < startDate) {
            throw badRequest('Tanggal berakhir tidak boleh sebelum tanggal mulai');
        }

        if (fields.length > 0) {
            assign('updated_at', nowSql());
            execute(`UPDATE affiliate_partners SET ${fields.join(', ')} WHERE id = ?`, [...values, toPositiveInt(id)]);
        }
        return this.getPartner(id);
    }

    /**
     * Children are deleted explicitly rather than left to ON DELETE CASCADE: the cascade only
     * fires while `foreign_keys = ON`, which is a per-connection pragma, so an explicit
     * transaction is the version that cannot leave orphan stats behind.
     */
    deletePartner(id) {
        const partner = this.requirePartnerRow(id);
        const offers = query('SELECT id, image_base FROM affiliate_offers WHERE partner_id = ?', [partner.id]);
        const offerIds = offers.map((row) => row.id);

        const run = transaction(() => {
            for (const offerId of offerIds) {
                execute('DELETE FROM affiliate_offer_stats WHERE offer_id = ?', [offerId]);
                execute('DELETE FROM affiliate_offer_targets WHERE offer_id = ?', [offerId]);
            }
            execute('DELETE FROM affiliate_offers WHERE partner_id = ?', [partner.id]);
            execute('DELETE FROM affiliate_partners WHERE id = ?', [partner.id]);
        });
        run();
        // Photos after the rows, same ordering rule as deleteOffer.
        for (const row of offers) {
            if (row.image_base) deleteAffiliateImage(row.image_base);
        }
        return true;
    }

    /* -------------------------------------------------------------- offers (admin) */

    listOffers() {
        return query(`${OFFER_SELECT} ORDER BY o.active DESC, o.priority ASC, o.id DESC`)
            .map(decorateOffer);
    }

    getOffer(id) {
        return decorateOffer(queryOne(`${OFFER_SELECT} WHERE o.id = ?`, [toPositiveInt(id)]));
    }

    requireOfferRow(id) {
        const offer = queryOne('SELECT * FROM affiliate_offers WHERE id = ?', [toPositiveInt(id)]);
        if (!offer) throw notFound('Penawaran tidak ditemukan');
        return offer;
    }

    /**
     * Replace an offer's targeting rows wholesale, in one transaction so the offer is never
     * briefly untargeted (which for a camera/area offer means matching nothing at all).
     * INSERT OR IGNORE, never the REPLACE variant: that one silently DELETEs the conflicting
     * row before inserting, which is the pattern that once cost this project a real customer.
     */
    setOfferTargets(offerId, { area_ids = [], camera_ids = [] } = {}) {
        const id = toPositiveInt(offerId);
        if (!id) throw badRequest('Penawaran tidak valid');
        const areaIds = [...new Set((area_ids || []).map(toPositiveInt).filter(Boolean))];
        const cameraIds = [...new Set((camera_ids || []).map(toPositiveInt).filter(Boolean))];

        const run = transaction(() => {
            execute('DELETE FROM affiliate_offer_targets WHERE offer_id = ?', [id]);
            for (const areaId of areaIds) {
                execute(
                    'INSERT OR IGNORE INTO affiliate_offer_targets (offer_id, target_type, target_id) VALUES (?, ?, ?)',
                    [id, 'area', areaId]
                );
            }
            for (const cameraId of cameraIds) {
                execute(
                    'INSERT OR IGNORE INTO affiliate_offer_targets (offer_id, target_type, target_id) VALUES (?, ?, ?)',
                    [id, 'camera', cameraId]
                );
            }
        });
        run();
        return { areaIds, cameraIds };
    }

    createOffer(data = {}) {
        const partnerId = toPositiveInt(data.partner_id);
        if (!partnerId) throw badRequest('Partner wajib dipilih');
        if (!queryOne('SELECT id FROM affiliate_partners WHERE id = ?', [partnerId])) {
            throw notFound('Partner tidak ditemukan');
        }

        // No photo columns here: setOfferImage writes those, once ffmpeg has made the renditions.
        const result = execute(`
            INSERT INTO affiliate_offers
                (partner_id, product_title, description, product_url,
                 target_mode, placements, priority, active,
                 whatsapp_number, whatsapp_message, product_price_rupiah)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            partnerId,
            normalizeText(data.product_title, 'product_title', { required: true }),
            normalizeText(data.description, 'description'),
            assertSafeOutboundUrl(data.product_url, 'URL produk'),
            normalizeTargetMode(data.target_mode ?? 'all'),
            JSON.stringify(normalizePlacements(data.placements ?? ['popup'])),
            normalizePriority(data.priority),
            toActiveFlag(data.active),
            normalizeWhatsAppNumber(data.whatsapp_number),
            normalizeWhatsAppMessage(data.whatsapp_message),
            normalizeProductPrice(data.product_price_rupiah),
        ]);

        this.setOfferTargets(result.lastInsertRowid, data);
        return this.getOffer(result.lastInsertRowid);
    }

    updateOffer(id, data = {}) {
        const existing = this.requireOfferRow(id);
        const fields = [];
        const values = [];
        const assign = (column, value) => { fields.push(`${column} = ?`); values.push(value); };

        if (data.partner_id !== undefined) {
            const partnerId = toPositiveInt(data.partner_id);
            if (!partnerId) throw badRequest('Partner wajib dipilih');
            if (!queryOne('SELECT id FROM affiliate_partners WHERE id = ?', [partnerId])) {
                throw notFound('Partner tidak ditemukan');
            }
            assign('partner_id', partnerId);
        }
        if (data.product_title !== undefined) {
            assign('product_title', normalizeText(data.product_title, 'product_title', { required: true }));
        }
        if (data.description !== undefined) {
            assign('description', normalizeText(data.description, 'description'));
        }
        if (data.product_url !== undefined) {
            assign('product_url', assertSafeOutboundUrl(data.product_url, 'URL produk'));
        }
        if (data.target_mode !== undefined) assign('target_mode', normalizeTargetMode(data.target_mode));
        if (data.placements !== undefined) {
            assign('placements', JSON.stringify(normalizePlacements(data.placements)));
        }
        if (data.priority !== undefined) assign('priority', normalizePriority(data.priority));
        if (data.active !== undefined) assign('active', toActiveFlag(data.active));

        // The three optional extras, through the SAME normalisers createOffer used, so a PUT can
        // never store what a POST would refuse. `undefined` = not sent; '' = cleared, i.e. NULL.
        for (const [column, normalize] of Object.entries(OFFER_EXTRA_FIELDS)) {
            if (data[column] !== undefined) assign(column, normalize(data[column]));
        }

        if (fields.length > 0) {
            assign('updated_at', nowSql());
            execute(`UPDATE affiliate_offers SET ${fields.join(', ')} WHERE id = ?`, [...values, existing.id]);
        }

        if (data.area_ids !== undefined || data.camera_ids !== undefined) {
            const current = this.getOffer(existing.id);
            this.setOfferTargets(existing.id, {
                area_ids: data.area_ids !== undefined ? data.area_ids : current.area_ids,
                camera_ids: data.camera_ids !== undefined ? data.camera_ids : current.camera_ids,
            });
        }
        return this.getOffer(existing.id);
    }

    /**
     * Point an offer at a freshly encoded photo — or, with `image = null`, forget the photo:
     * clearing image_base IS how "no photo" is expressed, since presence is the switch and there
     * is no show_image flag to unset. The row is updated BEFORE the old renditions are unlinked,
     * so a crash in between leaves an orphan file rather than a live card whose <img> 404s.
     *
     * @param {number|string} offerId
     * @param {{imageBase: string, width: number, height: number, bytes: number}|null} image
     */
    setOfferImage(offerId, image = null) {
        const existing = this.requireOfferRow(offerId);
        const next = image ? image.imageBase : null;
        execute(`
            UPDATE affiliate_offers
            SET image_base = ?, image_width = ?, image_height = ?, image_bytes = ?, updated_at = ?
            WHERE id = ?
        `, [next, image?.width ?? null, image?.height ?? null, image?.bytes ?? null, nowSql(), existing.id]);

        if (existing.image_base && existing.image_base !== next) {
            deleteAffiliateImage(existing.image_base);
        }
        return this.getOffer(existing.id);
    }

    /** Remove the photo. Sugar for setOfferImage(id, null) — the ordering rule lives there. */
    clearOfferImage(offerId) {
        return this.setOfferImage(offerId, null);
    }

    deleteOffer(id) {
        const offer = this.requireOfferRow(id);
        const run = transaction(() => {
            execute('DELETE FROM affiliate_offer_stats WHERE offer_id = ?', [offer.id]);
            execute('DELETE FROM affiliate_offer_targets WHERE offer_id = ?', [offer.id]);
            execute('DELETE FROM affiliate_offers WHERE id = ?', [offer.id]);
        });
        run();
        // Files after the rows (see setOfferImage): an orphan file is recoverable, a row pointing
        // at a deleted file is a broken card.
        if (offer.image_base) deleteAffiliateImage(offer.image_base);
        return true;
    }

    /**
     * Admin rollup for one offer: `{ days, rows, by_placement, totals }` — the daily series
     * (newest day first, one row per surface per day), the per-surface breakdown, and the total.
     * requireOfferRow first, so an unknown id is a 404 rather than an empty series. The window
     * clamp and the shape live in affiliateStatsService.
     */
    getOfferStats(id, days) {
        return readOfferStats(this.requireOfferRow(id).id, days);
    }
}

const affiliateOfferService = new AffiliateOfferService();

/*
 * Named bindings mirror connectionPool's export style, so a caller (or a test) may import
 * either the instance or a single function without reaching through the default export.
 */
export const resolveOfferForContext = affiliateOfferService.resolveOfferForContext.bind(affiliateOfferService);
export const resolveOfferForRedirect = affiliateOfferService.resolveOfferForRedirect.bind(affiliateOfferService);
export const recordImpression = affiliateOfferService.recordImpression.bind(affiliateOfferService);
export const recordClick = affiliateOfferService.recordClick.bind(affiliateOfferService);
export const setOfferImage = affiliateOfferService.setOfferImage.bind(affiliateOfferService);
export const clearOfferImage = affiliateOfferService.clearOfferImage.bind(affiliateOfferService);

// Re-exported from affiliateOfferExtras so the split is invisible to callers and tests that
// already import them from here. One implementation, two import paths.
export { buildPublicPayload, buildOfferWhatsAppUrl };

// Same deal for the counters' module: the vocabulary and the two validators keep resolving through
// this file, so nothing outside had to learn where they moved.
export { AFFILIATE_PLACEMENTS };
export { statColumnFor, statPlacementFor, placementFromGoQuery } from './affiliateStatsService.js';

export { AffiliateOfferService };
export default affiliateOfferService;
