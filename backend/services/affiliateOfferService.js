/*
Purpose: Own the affiliate feature's data rules — pick ONE partner offer for a viewing context,
         resolve the /go redirect target, count impressions/clicks, and serve admin CRUD.
Caller: affiliateController (public resolve + /go redirect, admin partner/offer CRUD + stats).
Deps: database/connectionPool (query/queryOne/execute/transaction), services/timeService
      (getLocalDate — WIB), utils/outboundUrlPolicy (https-only URL validation).
MainFuncs: resolveOfferForContext, resolveOfferForRedirect, recordImpression, recordClick,
           listPartners/getPartner/createPartner/updatePartner/deletePartner,
           listOffers/getOffer/createOffer/updateOffer/deleteOffer/setOfferTargets, getOfferStats.
SideEffects: Reads/writes affiliate_partners, affiliate_offers, affiliate_offer_targets,
             affiliate_offer_stats. Reads cameras.area_id (that column ONLY — see below).

WHY THE PUBLIC PAYLOAD IS HAND-BUILT AND NEVER A SPREAD ROW
-----------------------------------------------------------
buildPublicPayload names all six keys literally. It must never become `{ ...row, href }`: the
row it is handed is joined against affiliate_partners, so a spread would ship the partner's
price, contact note, schedule and raw store URL to every anonymous visitor the moment someone
adds a column. The resolve SELECT is a second, independent allow-list — it does not even read
product_url, store_url, price_rupiah, contact_note or partner_id — so a leak needs two
mistakes, not one.

WHY THE CAMERA NAME IS DELIBERATELY NOT READ
--------------------------------------------
The camera lookup selects `area_id` and nothing else. The neighbouring promo resolver
(promoBannerService.resolvePromoBannerForContext) carries a comment claiming "no camera field
is ever echoed back to the caller" while three lines later it keeps `camera.name` and
substitutes it into the public `cta_url` — on a query with no camera_class filter, so a
PRIVATE or SUBSCRIBER camera's name reaches an anonymous caller. That comment is false and
this file must not inherit it. Affiliate offers have no template substitution at all, so
there is no legitimate use for the name; not reading it is what makes the leak impossible
rather than merely unintended. If someone later adds `{kamera}` templating here, they must
also add the `camera_class = 'community'` gate — do not select the name "just in case".

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

WHY THE COUNTERS NEVER THROW
----------------------------
recordImpression/recordClick sit on the public request path. A counter is not worth a 500 to
a visitor, so their guard swallows everything; the failure is reported to stderr at most once
a minute (a broken DB would otherwise write a line per request — the exact "steady state,
logged per item" pattern the logging policy forbids). The UPSERT is guarded by
`WHERE EXISTS (SELECT 1 FROM affiliate_offers ...)` so a stale or forged id is a silent no-op
instead of a foreign-key exception.
*/

import { query, queryOne, execute, transaction } from '../database/connectionPool.js';
import { getLocalDate } from './timeService.js';
import { assertSafeOutboundUrl, isSafeOutboundUrl } from '../utils/outboundUrlPolicy.js';

export const AFFILIATE_PLACEMENTS = ['popup', 'area', 'landing', 'playback'];
export const AFFILIATE_TARGET_MODES = ['all', 'area', 'camera'];
export const AFFILIATE_BILLING_MODES = ['lifetime', 'term'];

/*
 * The ONLY two column names that may reach the stat UPSERT. Null-prototype and frozen on
 * purpose: on a plain object literal, `STAT_COLUMN_BY_LINK['constructor']` returns an
 * inherited function rather than undefined, and that value would be template-interpolated
 * into SQL by a `map[link] || 'impressions'` style lookup. SQLite cannot parameterize an
 * identifier, so interpolation is unavoidable — the defence is that the interpolated value
 * can only ever be one of these two literals.
 */
const STAT_COLUMN_BY_LINK = Object.freeze(Object.assign(Object.create(null), {
    p: 'product_clicks',
    s: 'store_clicks',
}));

const MAX_STATS_DAYS = 365;
const DEFAULT_STATS_DAYS = 30;
const STAT_ERROR_LOG_INTERVAL_MS = 60_000;
const TEXT_LIMITS = { store_name: 120, contact_note: 500, product_title: 160, description: 500 };

let lastStatErrorLoggedAt = 0;

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

/** Maps the public `?l=` value to a stat column, or throws. Never interpolate `link` itself. */
export function statColumnFor(link) {
    if (typeof link !== 'string' || !Object.hasOwn(STAT_COLUMN_BY_LINK, link)) {
        throw badRequest('Link tidak dikenal');
    }
    return STAT_COLUMN_BY_LINK[link];
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
 * The SELECT list IS the first allow-list: no product_url, no raw store_url, no price_rupiah,
 * no contact_note, no partner_id. `has_store_url` is computed in SQL so the partner's raw URL
 * never even enters this process on the resolve path — the public payload advertises our own
 * /go redirector, never the destination.
 */
const RESOLVE_SELECT = `
    SELECT o.id, o.product_title, o.description, o.placements,
           o.active AS offer_active,
           p.store_name,
           p.active AS partner_active, p.billing_mode, p.start_date, p.end_date,
           CASE WHEN p.store_url IS NOT NULL AND TRIM(p.store_url) <> '' THEN 1 ELSE 0 END AS has_store_url
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
    ORDER BY
        CASE o.target_mode WHEN 'camera' THEN 0 WHEN 'area' THEN 1 ELSE 2 END,
        o.priority ASC,
        o.id DESC
`;

/**
 * The six public keys, spelled out. Do not spread a row into this object — see the file header.
 */
export function buildPublicPayload(row) {
    return {
        id: row.id,
        product_title: row.product_title,
        description: row.description || null,
        store_name: row.store_name,
        product_href: `/api/public/affiliate/offers/${row.id}/go?l=p`,
        store_href: row.has_store_url ? `/api/public/affiliate/offers/${row.id}/go?l=s` : null,
    };
}

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
        (SELECT COALESCE(SUM(s.store_clicks), 0) FROM affiliate_offer_stats s WHERE s.offer_id = o.id) AS total_store_clicks
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

/* -------------------------------------------------------------------- stats writer */

function logStatFailure(context, error) {
    const now = Date.now();
    if (now - lastStatErrorLoggedAt < STAT_ERROR_LOG_INTERVAL_MS) return;
    lastStatErrorLoggedAt = now;
    console.error(`[Affiliate] stat write failed (${context}):`, error.message);
}

function bumpStat(offerId, column, amount = 1) {
    const id = toPositiveInt(offerId);
    if (!id) return;
    // Guarded UPSERT: one statement per event, and the EXISTS makes an unknown offer a silent
    // no-op rather than a foreign-key throw. UNIQUE(offer_id, stat_date) is the conflict target.
    execute(`
        INSERT INTO affiliate_offer_stats (offer_id, stat_date, ${column})
        SELECT ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM affiliate_offers WHERE id = ?)
        ON CONFLICT (offer_id, stat_date)
        DO UPDATE SET ${column} = ${column} + ?
    `, [id, getLocalDate(), amount, id, amount]);
}

/* ------------------------------------------------------------------------ service */

class AffiliateOfferService {
    /**
     * Pick the single best live offer for one viewing context.
     * Specificity beats priority: an offer aimed at this camera beats one aimed at its area,
     * which beats a catch-all; then the lower priority number, then the newest offer.
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

        const rows = query(RESOLVE_SELECT, [cameraKey, cameraKey, areaKey, areaKey]);
        const today = getLocalDate();
        const match = rows.find(
            (row) => isOfferRowLive(row, today) && parsePlacements(row.placements).includes(placement)
        );
        return match ? buildPublicPayload(match) : null;
    }

    /**
     * Resolve the destination for /go. Re-checks liveness on every read — see the file header.
     *
     * @param {number|string} offerId
     * @param {'p'|'s'} link
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

    /** Best-effort counter. Never throws — see "WHY THE COUNTERS NEVER THROW". */
    recordImpression(offerId) {
        try {
            bumpStat(offerId, 'impressions');
        } catch (error) {
            logStatFailure('impression', error);
        }
    }

    /** Best-effort counter. Never throws, including on an unknown `link`. */
    recordClick(offerId, link) {
        try {
            bumpStat(offerId, statColumnFor(link));
        } catch (error) {
            logStatFailure('click', error);
        }
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
        const offerIds = query('SELECT id FROM affiliate_offers WHERE partner_id = ?', [partner.id])
            .map((row) => row.id);

        const run = transaction(() => {
            for (const offerId of offerIds) {
                execute('DELETE FROM affiliate_offer_stats WHERE offer_id = ?', [offerId]);
                execute('DELETE FROM affiliate_offer_targets WHERE offer_id = ?', [offerId]);
            }
            execute('DELETE FROM affiliate_offers WHERE partner_id = ?', [partner.id]);
            execute('DELETE FROM affiliate_partners WHERE id = ?', [partner.id]);
        });
        run();
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

        const result = execute(`
            INSERT INTO affiliate_offers
                (partner_id, product_title, description, product_url,
                 target_mode, placements, priority, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            partnerId,
            normalizeText(data.product_title, 'product_title', { required: true }),
            normalizeText(data.description, 'description'),
            assertSafeOutboundUrl(data.product_url, 'URL produk'),
            normalizeTargetMode(data.target_mode ?? 'all'),
            JSON.stringify(normalizePlacements(data.placements ?? ['popup'])),
            normalizePriority(data.priority),
            toActiveFlag(data.active),
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

    deleteOffer(id) {
        const offer = this.requireOfferRow(id);
        const run = transaction(() => {
            execute('DELETE FROM affiliate_offer_stats WHERE offer_id = ?', [offer.id]);
            execute('DELETE FROM affiliate_offer_targets WHERE offer_id = ?', [offer.id]);
            execute('DELETE FROM affiliate_offers WHERE id = ?', [offer.id]);
        });
        run();
        return true;
    }

    /** Daily series for the admin panel, newest day first. */
    getOfferStats(id, days = DEFAULT_STATS_DAYS) {
        const offer = this.requireOfferRow(id);
        const num = typeof days === 'number' ? days : Number(String(days ?? '').trim());
        const window = Number.isInteger(num) && num > 0 && num <= MAX_STATS_DAYS ? num : DEFAULT_STATS_DAYS;
        return query(`
            SELECT stat_date, impressions, product_clicks, store_clicks
            FROM affiliate_offer_stats
            WHERE offer_id = ?
            ORDER BY stat_date DESC
            LIMIT ?
        `, [offer.id, window]);
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

export { AffiliateOfferService };
export default affiliateOfferService;
