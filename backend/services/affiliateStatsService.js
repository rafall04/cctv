/*
Purpose: Own the affiliate counters — WHICH SURFACE a count belongs to, which column an event lands
         in, the guarded per-surface daily UPSERT, and the rollup the admin panel reads.
Caller: services/affiliateOfferService.js (recordImpression/recordClick/getOfferStats delegate here
        and re-export the vocabulary), controllers/affiliateController.js (placementFromGoQuery).
Deps: database/connectionPool (query/execute), services/timeService (getLocalDate — WIB).
MainFuncs: AFFILIATE_PLACEMENTS, statColumnFor, statPlacementFor, placementFromGoQuery,
           recordOfferImpression, recordOfferClick, readOfferStats.
SideEffects: Writes affiliate_offer_stats; reads affiliate_offers (the EXISTS guard only).

WHY THIS IS ITS OWN MODULE
--------------------------
affiliateOfferService.js sits at 799 lines against the 800-line ratchet — one line of headroom —
and per-surface counting needs rather more than one line. The counters are also the natural cut:
they touch one table, no targeting, no schedule, no CRUD. The offer service re-exports everything
below, so the split is invisible to its callers and to tests — the same fs-cut-then-re-export shape
affiliateOfferExtras.js already used.

WHY THE PLACEMENT VOCABULARY LIVES HERE AND NOT BESIDE THE OFFERS
-----------------------------------------------------------------
This module is where the list is ENFORCED. An offer *configured* for a surface that does not exist
simply never resolves — a silent, harmless mismatch. A COUNT *filed* under a surface that does not
exist is a row that reaches an invoice and can never be reconciled against anything. The resolver
imports AFFILIATE_PLACEMENTS from here, so the two halves cannot drift apart.

WHY EVERY WRITE MUST NAME ITS SURFACE
-------------------------------------
One offer now appears under the live video, on the area page, on the landing page and on playback.
A visitor going landing -> area -> camera adds THREE impressions. Blended into one number, a rising
figure could mean "this product is interesting" or merely "we put it in more places", and those two
call for opposite decisions. So `placement` is part of the UNIQUE key, it is NOT NULL with no
default in the schema (database/migrations/zz_20260823_add_affiliate_stats_placement.js), and there
is no default here either: a caller that forgets writes NOTHING and says so on stderr, instead of
quietly piling four surfaces into the 'popup' bucket — which is the exact failure the split exists
to end.

WHY TWO FROZEN NULL-PROTOTYPE MAPS
----------------------------------
SQLite cannot parameterize an IDENTIFIER, so the counter column is interpolated into the statement
and STAT_COLUMN_BY_LINK is the only thing standing between a query-string letter and a column name.
`placement` is a VALUE, bound with `?`, so it carries no injection risk — it gets the same
treatment for the other reason: an unrecognised surface must fail loudly rather than mint a bucket
nobody asked for. Both maps are null-prototype and frozen because on a plain object literal
`map['constructor']` returns an inherited function rather than undefined, and that value would be
the one interpolated.

WHY THE COUNTERS NEVER THROW
----------------------------
recordOfferImpression/recordOfferClick sit on the public request path. A counter is not worth a 500
to a visitor, so their guard swallows everything; the failure reaches stderr at most once a minute
(a broken DB — or a frontend that forgot the placement — would otherwise write a line per request,
the exact "steady state, logged per item" pattern the logging policy forbids). The UPSERT is
guarded by `WHERE EXISTS (SELECT 1 FROM affiliate_offers ...)` so a stale or forged id is a silent
no-op instead of a foreign-key exception.

WHY THE ROLLUP IS A DATE WINDOW AND NO LONGER `LIMIT <days>`
------------------------------------------------------------
One day used to be one row, so "the last 30 days" was `ORDER BY stat_date DESC LIMIT 30`. One day
is now up to four rows (one per surface), and that same LIMIT would cut a day in half — showing
popup and area for the oldest day in view and silently dropping landing and playback. The window is
therefore a date range computed from the WIB local date, with LIMIT kept only as a bound on how
much a single response can carry.
*/

import { query, execute } from '../database/connectionPool.js';
import { getLocalDate } from './timeService.js';

/** Every surface an offer may appear on, and therefore every bucket a count may land in. */
export const AFFILIATE_PLACEMENTS = ['popup', 'area', 'landing', 'playback'];

/**
 * The ONLY three column names that may reach the stat UPSERT. See "WHY TWO FROZEN NULL-PROTOTYPE
 * MAPS" above.
 *
 * 'w' (a WhatsApp tap) gets its own counter rather than being folded into product_clicks: it is a
 * different intent — starting a conversation, not browsing — and two intents in one number is a
 * number nobody can read.
 */
const STAT_COLUMN_BY_LINK = Object.freeze(Object.assign(Object.create(null), {
    p: 'product_clicks',
    s: 'store_clicks',
    w: 'whatsapp_clicks',
}));

/**
 * The ONLY four values that may reach the `placement` column. Derived from AFFILIATE_PLACEMENTS so
 * a fifth surface is added in exactly one place and the two can never disagree; rebuilt as a frozen
 * null-prototype map so a lookup can only ever answer with one of those four literals.
 */
const STAT_PLACEMENT_BY_KEY = Object.freeze(Object.assign(
    Object.create(null),
    Object.fromEntries(AFFILIATE_PLACEMENTS.map((placement) => [placement, placement])),
));

/**
 * What a /go link that predates per-surface counting is filed under.
 *
 * BACKWARD COMPATIBILITY ONLY, NOT CONVENIENCE. Until this change the under-video popup was the
 * only wired surface, so every /go URL already minted, bookmarked, or pasted into WhatsApp says
 * nothing about where it came from — and 'popup' is the truth for all of them, the same reasoning
 * the migration used to stamp every existing row. Nobody may widen this into a default for NEW
 * links: a writer that forgets its surface must lose the count, not inherit somebody else's.
 */
export const GO_LEGACY_PLACEMENT = 'popup';

const STAT_COUNTERS = ['impressions', 'product_clicks', 'store_clicks', 'whatsapp_clicks'];

const MAX_STATS_DAYS = 365;
export const DEFAULT_STATS_DAYS = 30;
const STAT_ERROR_LOG_INTERVAL_MS = 60_000;

let lastStatErrorLoggedAt = 0;

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

/** Strict id coercion: '12' -> 12, but '12abc'/''/0/-1/null -> null (parseInt would accept '12abc'). */
function toPositiveInt(value) {
    const num = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    return Number.isInteger(num) && num > 0 ? num : null;
}

/**
 * Which counter column does this link letter move?
 *
 * @param {'p'|'s'|'w'} link
 * @returns {string} one of three hard-coded column names, never a caller-supplied string
 * @throws {Error} 400 on anything else
 */
export function statColumnFor(link) {
    if (typeof link !== 'string' || !Object.hasOwn(STAT_COLUMN_BY_LINK, link)) {
        throw badRequest('Link tidak dikenal');
    }
    return STAT_COLUMN_BY_LINK[link];
}

/**
 * Which surface does this count belong to?
 *
 * There is deliberately no default parameter and no fallback: `undefined` throws, which is how a
 * caller that forgot to say where the event happened loses its count instead of contaminating
 * another surface's number.
 *
 * @param {'popup'|'area'|'landing'|'playback'} placement
 * @returns {string} one of four hard-coded literals
 * @throws {Error} 400 on anything else, `undefined` included
 */
export function statPlacementFor(placement) {
    if (typeof placement !== 'string' || !Object.hasOwn(STAT_PLACEMENT_BY_KEY, placement)) {
        throw badRequest('Penempatan tidak dikenal');
    }
    return STAT_PLACEMENT_BY_KEY[placement];
}

/**
 * Read the surface out of a /go query string.
 *
 * Absent (or blank, which is what an old link rewritten by a proxy looks like) means a link minted
 * before per-surface counting existed -> GO_LEGACY_PLACEMENT, for the backward-compatibility reason
 * documented on that constant.
 *
 * PRESENT BUT UNRECOGNISED IS NOT DEFAULTED. It returns null, which statPlacementFor then refuses,
 * so the tap goes uncounted rather than being filed under a surface it did not happen on. The
 * visitor still gets their redirect — a counter is never allowed to cost someone their destination
 * (see "WHY THE COUNTERS NEVER THROW") — so the cost of a bad tag is one lost row plus a throttled
 * stderr line, not a broken link.
 *
 * @param {unknown} raw `request.query.placement`
 * @returns {string|null} a placement to file under, or null meaning "do not count this"
 */
export function placementFromGoQuery(raw) {
    if (raw === undefined || raw === null) return GO_LEGACY_PLACEMENT;
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    if (!text) return GO_LEGACY_PLACEMENT;
    return Object.hasOwn(STAT_PLACEMENT_BY_KEY, text) ? STAT_PLACEMENT_BY_KEY[text] : null;
}

function logStatFailure(context, error) {
    const now = Date.now();
    if (now - lastStatErrorLoggedAt < STAT_ERROR_LOG_INTERVAL_MS) return;
    lastStatErrorLoggedAt = now;
    console.error(`[Affiliate] stat write failed (${context}):`, error.message);
}

/**
 * One event, one statement. The conflict target is the widened key: a surface now gets its own row
 * per day, and the EXISTS makes an unknown offer a silent no-op rather than a foreign-key throw.
 *
 * `column` is interpolated (SQLite cannot parameterize an identifier) but can only ever be one of
 * the three literals in STAT_COLUMN_BY_LINK; `place` is BOUND, and has already been narrowed to one
 * of four literals by statPlacementFor.
 */
function bumpStat(offerId, column, place, amount = 1) {
    const id = toPositiveInt(offerId);
    if (!id) return;
    execute(`
        INSERT INTO affiliate_offer_stats (offer_id, stat_date, placement, ${column})
        SELECT ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM affiliate_offers WHERE id = ?)
        ON CONFLICT (offer_id, stat_date, placement)
        DO UPDATE SET ${column} = ${column} + ?
    `, [id, getLocalDate(), place, amount, id, amount]);
}

/**
 * Best-effort impression counter. Never throws — see "WHY THE COUNTERS NEVER THROW".
 *
 * @param {number|string} offerId
 * @param {'popup'|'area'|'landing'|'playback'} placement REQUIRED; omitting it counts nothing
 */
export function recordOfferImpression(offerId, placement) {
    try {
        bumpStat(offerId, 'impressions', statPlacementFor(placement));
    } catch (error) {
        logStatFailure('impression', error);
    }
}

/**
 * Best-effort click counter for 'p' | 's' | 'w' (product / store / WhatsApp). Never throws — an
 * unknown link or an unknown/missing placement included: the frozen maps let the query string pick
 * WHICH counter and WHICH bucket, never the identifier or the value that reaches SQL.
 *
 * @param {number|string} offerId
 * @param {'p'|'s'|'w'} link
 * @param {'popup'|'area'|'landing'|'playback'} placement REQUIRED; omitting it counts nothing
 */
export function recordOfferClick(offerId, link, placement) {
    try {
        bumpStat(offerId, statColumnFor(link), statPlacementFor(placement));
    } catch (error) {
        logStatFailure('click', error);
    }
}

function clampDays(days) {
    const num = typeof days === 'number' ? days : Number(String(days ?? '').trim());
    return Number.isInteger(num) && num > 0 && num <= MAX_STATS_DAYS ? num : DEFAULT_STATS_DAYS;
}

/**
 * First day of an N-day window that ENDS on `today` (so days=1 is today alone).
 *
 * Pure string arithmetic anchored at UTC midnight on a date the WIB helper produced: the anchor
 * only has to be consistent, and doing the subtraction in local time would shift the boundary for
 * anyone whose machine is not on WIB.
 */
function windowStartDate(today, days) {
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return start.toISOString().slice(0, 10);
}

function emptyCounters(extra = {}) {
    return { ...extra, impressions: 0, product_clicks: 0, store_clicks: 0, whatsapp_clicks: 0 };
}

/**
 * The admin rollup for ONE offer: the daily rows, a per-surface breakdown, and a total.
 *
 * Both aggregates are returned because they answer different questions and the panel needs both:
 * the total answers "is this offer working at all", the breakdown answers "which surface is worth
 * selling". Deriving one from the other in the UI is how a panel ends up disagreeing with itself.
 *
 * `by_placement` reports only surfaces that actually have a row in the window — what HAPPENED, not
 * what was configured. A surface an offer was never published to would otherwise show a fabricated
 * "0 impressions" that reads like a failed placement.
 *
 * @param {number} offerId already validated by the caller (the offer row was fetched)
 * @param {number|string} [days]
 * @returns {{days: number, rows: object[], by_placement: object[], totals: object}}
 */
export function readOfferStats(offerId, days) {
    const window = clampDays(days);
    const rows = query(`
        SELECT stat_date, placement, impressions, product_clicks, store_clicks, whatsapp_clicks
        FROM affiliate_offer_stats
        WHERE offer_id = ? AND stat_date >= ?
        ORDER BY stat_date DESC, placement ASC
        LIMIT ?
    `, [offerId, windowStartDate(getLocalDate(), window), window * AFFILIATE_PLACEMENTS.length]);

    const totals = emptyCounters();
    const byPlacement = new Map();
    for (const row of rows) {
        const bucket = byPlacement.get(row.placement) || emptyCounters({ placement: row.placement });
        for (const counter of STAT_COUNTERS) {
            const value = Number(row[counter]) || 0;
            totals[counter] += value;
            bucket[counter] += value;
        }
        byPlacement.set(row.placement, bucket);
    }

    const by_placement = [...byPlacement.values()]
        .sort((a, b) => b.impressions - a.impressions || a.placement.localeCompare(b.placement));

    return { days: window, rows, by_placement, totals };
}

export default {
    AFFILIATE_PLACEMENTS,
    DEFAULT_STATS_DAYS,
    GO_LEGACY_PLACEMENT,
    statColumnFor,
    statPlacementFor,
    placementFromGoQuery,
    recordOfferImpression,
    recordOfferClick,
    readOfferStats,
};
