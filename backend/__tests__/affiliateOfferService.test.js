/**
 * Purpose: Prove the affiliate feature's data rules - the six-key public payload (anti-leak),
 *          targeting precedence, the liveness re-check the /go redirect performs on every read,
 *          the guarded daily stat UPSERT, and the bounded count throttle.
 * Caller: Backend test gate (vitest, node env).
 * Deps: vitest, better-sqlite3 (in-memory, real schema), mocked connectionPool + pinned timeService.
 * MainFuncs: resolveOfferForContext / resolveOfferForRedirect / recordImpression / recordClick /
 *            partner + offer CRUD / getOfferStats / allowCount.
 * SideEffects: In-memory database only. Never touches backend/data/cctv.db.
 *
 * WHY A REAL SQLITE AND NOT A STUBBED query()
 * -------------------------------------------
 * Most of what is being asserted here IS the SQL: the specificity ORDER BY that decides which one
 * offer a viewer sees, the EXISTS targeting sub-selects, and above all the stat UPSERT, whose two
 * defences (`WHERE EXISTS` and the `ON CONFLICT (offer_id, stat_date)` target) only exist inside the
 * database. A mocked execute() can never raise a constraint error and never resolves a conflict
 * target, so it would report green against a broken statement - the exact failure mode the repo's
 * "a mock cannot prove a constraint" guardrail was written for.
 *
 * The throttle lives in utils/affiliateCountThrottle.js and is exercised at the bottom of this file
 * rather than in one of its own, because the module-ownership contract for this change allots this
 * agent exactly two test files. It is tested with an injected clock, so it costs no wall time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await vi.hoisted(async () => {
    const { default: Database } = await import('better-sqlite3');
    return { db: new Database(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (callback) => db.transaction(callback),
}));

/*
 * "Today" is pinned so the schedule-window assertions do not drift with the clock - and, just as
 * importantly, so a regression that swapped getLocalDate() (WIB) for SQLite's date('now') (UTC)
 * shows up: the stat rows below would then carry the real UTC date instead of this literal.
 * The literal is inlined in the factory because vi.mock is hoisted above every const in this file.
 */
vi.mock('../services/timeService.js', () => ({
    getLocalDate: () => '2026-08-12',
}));

const TODAY = '2026-08-12';
const YESTERDAY = '2026-08-11';
const NEXT_MONTH = '2026-09-01';

import affiliateOfferService, {
    buildPublicPayload,
    normalizeBillingMode,
    normalizePlacements,
    normalizeTargetMode,
    parsePlacements,
    partnerScheduleState,
    recordClick,
    recordImpression,
    resolveOfferForContext,
    resolveOfferForRedirect,
    statColumnFor,
} from '../services/affiliateOfferService.js';
import {
    COUNT_WINDOW_MS,
    MAX_THROTTLE_KEYS,
    SWEEP_INTERVAL_MS,
    _resetThrottleForTests,
    allowCount,
    throttleSize,
} from '../utils/affiliateCountThrottle.js';

/** The exact schema from database/migrations/zz_20260820_add_affiliate_offers.js. */
function resetSchema() {
    db.exec(`
        DROP TABLE IF EXISTS affiliate_offer_stats;
        DROP TABLE IF EXISTS affiliate_offer_targets;
        DROP TABLE IF EXISTS affiliate_offers;
        DROP TABLE IF EXISTS affiliate_partners;
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS areas;

        CREATE TABLE areas (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE cameras (
            id INTEGER PRIMARY KEY,
            name TEXT,
            area_id INTEGER,
            camera_class TEXT NOT NULL DEFAULT 'community'
        );

        CREATE TABLE affiliate_partners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_name TEXT NOT NULL,
            store_url TEXT,
            contact_note TEXT,
            billing_mode TEXT NOT NULL DEFAULT 'term',
            price_rupiah INTEGER NOT NULL DEFAULT 0,
            start_date TEXT,
            end_date TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE affiliate_offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            partner_id INTEGER NOT NULL,
            product_title TEXT NOT NULL,
            description TEXT,
            product_url TEXT NOT NULL,
            target_mode TEXT NOT NULL DEFAULT 'all',
            placements TEXT NOT NULL DEFAULT '["popup"]',
            priority INTEGER NOT NULL DEFAULT 100,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (partner_id) REFERENCES affiliate_partners(id) ON DELETE CASCADE
        );
        CREATE TABLE affiliate_offer_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id INTEGER NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER NOT NULL,
            UNIQUE (offer_id, target_type, target_id),
            FOREIGN KEY (offer_id) REFERENCES affiliate_offers(id) ON DELETE CASCADE
        );
        CREATE TABLE affiliate_offer_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id INTEGER NOT NULL,
            stat_date TEXT NOT NULL,
            impressions INTEGER NOT NULL DEFAULT 0,
            product_clicks INTEGER NOT NULL DEFAULT 0,
            store_clicks INTEGER NOT NULL DEFAULT 0,
            UNIQUE (offer_id, stat_date),
            FOREIGN KEY (offer_id) REFERENCES affiliate_offers(id) ON DELETE CASCADE
        );

        INSERT INTO areas (id, name) VALUES (2, 'DANDER'), (3, 'TANJUNGHARJO'), (9, 'SURABAYA');
        INSERT INTO cameras (id, name, area_id, camera_class) VALUES
            (11, 'CCTV LAPANGAN DANDER', 2, 'community'),
            (12, 'CCTV BALAI TANJUNGHARJO', 3, 'community'),
            (99, 'CCTV SURABAYA', 9, 'community'),
            (77, 'CCTV RUMAH PAK RT', 2, 'owner_private');
    `);
}

/** A live, lifetime partner unless the test says otherwise. */
function makePartner(overrides = {}) {
    return affiliateOfferService.createPartner({
        store_name: 'Toko Sinar',
        store_url: 'https://toko-sinar.example',
        contact_note: 'WA 081234567890 (Pak Budi)',
        billing_mode: 'lifetime',
        price_rupiah: 250000,
        ...overrides,
    });
}

function makeOffer(partnerId, overrides = {}) {
    return affiliateOfferService.createOffer({
        partner_id: partnerId,
        product_title: 'Kamera Indoor 2MP',
        product_url: 'https://toko-sinar.example/produk/kamera-indoor',
        placements: ['popup'],
        ...overrides,
    });
}

const statRows = () => db.prepare('SELECT * FROM affiliate_offer_stats ORDER BY id').all();

beforeEach(() => {
    resetSchema();
    _resetThrottleForTests();
});

describe('public payload - the anti-leak contract', () => {
    /*
     * THE ANTI-LEAK TEST. The most important one in this file.
     *
     * The public slot renders on an anonymous, unauthenticated surface, and the row this payload is
     * built from is a JOIN across affiliate_offers and affiliate_partners - it can carry the
     * partner's price, contact note, schedule and raw shop URL. `{ ...row, href }` would ship all of
     * that, and so would any column a future migration adds to either table. Asserting on
     * Object.keys, rather than on a handful of toHaveProperty checks, is what makes a carelessly
     * added field fail HERE instead of on the public site.
     *
     * This is not hypothetical. The neighbouring promo resolver
     * (services/promoBannerService.js -> resolvePromoBannerForContext) carries a comment claiming no
     * camera field is ever echoed back to the caller, and that comment is FALSE: it keeps
     * `camera.name` and substitutes it into the public cta_url, on a query with no camera_class
     * filter, so a private or subscriber camera's name can reach an anonymous caller. A comment
     * enforces nothing. This test does.
     */
    it('contains EXACTLY the six contracted keys and nothing else', () => {
        const partner = makePartner();
        makeOffer(partner.id, { description: 'Garansi resmi 1 tahun' });

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });

        expect(Object.keys(payload).sort()).toEqual([
            'description',
            'id',
            'product_href',
            'product_title',
            'store_href',
            'store_name',
        ]);
    });

    it('never carries a camera name, an area name, the partner id, the price, the contact note or a raw partner URL', () => {
        const partner = makePartner();
        makeOffer(partner.id, { description: 'Garansi resmi 1 tahun' });

        const serialized = JSON.stringify(resolveOfferForContext({ placement: 'popup', cameraId: 11 }));

        // Camera / area identity: the slot must not double as a way to enumerate cameras, and a
        // non-community camera's name must never appear on a public surface at all.
        expect(serialized).not.toContain('LAPANGAN');
        expect(serialized).not.toContain('DANDER');
        expect(serialized).not.toContain('RUMAH PAK RT');
        // Commercial terms and the counterparty's contact details.
        expect(serialized).not.toContain('250000');
        expect(serialized).not.toContain('081234567890');
        expect(serialized).not.toContain('partner_id');
        // The schedule, the targeting and the active flags are internal bookkeeping.
        for (const internal of ['billing_mode', 'start_date', 'end_date', 'active', 'target_mode', 'placements', 'priority']) {
            expect(serialized, internal).not.toContain(internal);
        }
        // The destination itself: the payload advertises our own redirector, never the shop URL.
        expect(serialized).not.toContain('toko-sinar.example');
    });

    it('advertises only the /go redirector, keyed p for product and s for store', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
        expect(payload.product_href).toBe(`/api/public/affiliate/offers/${offer.id}/go?l=p`);
        expect(payload.store_href).toBe(`/api/public/affiliate/offers/${offer.id}/go?l=s`);
    });

    it('offers no store link at all when the partner has no shop URL', () => {
        const partner = makePartner({ store_url: null });
        makeOffer(partner.id);

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
        expect(payload.store_href).toBeNull();
        // Still exactly six keys - the key is present and null, never dropped, so the frontend can
        // branch on a value instead of on the shape.
        expect(Object.keys(payload)).toHaveLength(6);
    });

    it('builds the same six keys directly from a row, with a missing description as null', () => {
        expect(buildPublicPayload({
            id: 7,
            product_title: 'Kamera',
            description: '',
            store_name: 'Toko',
            has_store_url: 0,
        })).toEqual({
            id: 7,
            product_title: 'Kamera',
            description: null,
            store_name: 'Toko',
            product_href: '/api/public/affiliate/offers/7/go?l=p',
            store_href: null,
        });
    });
});

describe('resolveOfferForContext - targeting precedence', () => {
    it('prefers camera over area over all, and specificity outranks priority', () => {
        const partner = makePartner();
        makeOffer(partner.id, { product_title: 'Semua', target_mode: 'all', priority: 1 });
        makeOffer(partner.id, { product_title: 'Area', target_mode: 'area', area_ids: [2, 3], priority: 1 });
        // Deliberately the WORST priority number, to prove specificity is the outer sort.
        makeOffer(partner.id, { product_title: 'Kamera', target_mode: 'camera', camera_ids: [11], priority: 500 });

        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).product_title).toBe('Kamera');
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 12 }).product_title).toBe('Area');
        // Camera 99 sits in area 9, outside both targeted areas, so only the catch-all remains.
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 99 }).product_title).toBe('Semua');
    });

    it('breaks a tie within one specificity on priority, lower number first', () => {
        const partner = makePartner();
        makeOffer(partner.id, { product_title: 'Kedua', target_mode: 'all', priority: 50 });
        makeOffer(partner.id, { product_title: 'Pertama', target_mode: 'all', priority: 10 });

        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).product_title).toBe('Pertama');
    });

    it('resolves an area offer through the camera it was asked about', () => {
        const partner = makePartner();
        makeOffer(partner.id, { product_title: 'Area 2', target_mode: 'area', area_ids: [2] });

        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 })).not.toBeNull();
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 12 })).toBeNull();
    });

    it('resolves by areaId alone when there is no camera in context', () => {
        const partner = makePartner();
        makeOffer(partner.id, { product_title: 'Area 2', target_mode: 'area', area_ids: [2], placements: ['area'] });

        expect(resolveOfferForContext({ placement: 'area', areaId: 2 })).not.toBeNull();
        expect(resolveOfferForContext({ placement: 'area', areaId: 9 })).toBeNull();
    });

    it('answers the same way for an unknown camera id as for a camera with no offer', () => {
        // Otherwise the public slot becomes a probe for which camera ids exist.
        const partner = makePartner();
        makeOffer(partner.id, { target_mode: 'all' });

        expect(resolveOfferForContext({ placement: 'popup', cameraId: 424242 })).not.toBeNull();
    });

    it('serves only the requested placement', () => {
        const partner = makePartner();
        makeOffer(partner.id, { placements: ['landing', 'playback'] });

        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 })).toBeNull();
        expect(resolveOfferForContext({ placement: 'landing', cameraId: 11 })).not.toBeNull();
        expect(resolveOfferForContext({ placement: 'playback', cameraId: 11 })).not.toBeNull();
    });

    it('refuses an unknown or empty placement outright', () => {
        const partner = makePartner();
        makeOffer(partner.id);

        expect(resolveOfferForContext({ placement: 'nonsense', cameraId: 11 })).toBeNull();
        expect(resolveOfferForContext({ placement: '', cameraId: 11 })).toBeNull();
        expect(resolveOfferForContext({})).toBeNull();
    });
});

describe('resolveOfferForContext - liveness filtering', () => {
    it('skips an offer whose PARTNER is inactive and serves the next live one instead', () => {
        // Also proves liveness is applied after the ordering: the dead partner's offer sorts first.
        const dead = makePartner({ store_name: 'Toko Tutup', active: false });
        const live = makePartner({ store_name: 'Toko Buka' });
        makeOffer(dead.id, { product_title: 'Dari toko tutup', priority: 1 });
        makeOffer(live.id, { product_title: 'Dari toko buka', priority: 900 });

        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).product_title)
            .toBe('Dari toko buka');
    });

    it('skips a deactivated offer', () => {
        const partner = makePartner();
        makeOffer(partner.id, { active: false });

        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 })).toBeNull();
    });

    it('honours a term partner window on both ends and treats the last day as still live', () => {
        const notStarted = makePartner({ billing_mode: 'term', start_date: NEXT_MONTH });
        makeOffer(notStarted.id);
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 })).toBeNull();

        resetSchema();
        const expired = makePartner({ billing_mode: 'term', start_date: '2026-01-01', end_date: YESTERDAY });
        makeOffer(expired.id);
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 })).toBeNull();

        resetSchema();
        const lastDay = makePartner({ billing_mode: 'term', start_date: TODAY, end_date: TODAY });
        makeOffer(lastDay.id);
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 })).not.toBeNull();
    });
});

describe('resolveOfferForRedirect - liveness is re-checked on every read', () => {
    /*
     * /api/public/affiliate/offers/12/go?l=p is a stable, guessable, shareable URL on OUR domain.
     * If the redirect only checked that the row exists, deactivating a partner - or letting their
     * term lapse - would leave a working redirector on a public-institution-adjacent domain pointing
     * at a shop we no longer have a contract with, with no page to take down. So all four of these
     * must refuse, and refusing means null (the controller turns that into a 404, never a redirect).
     */
    it('resolves a live lifetime partner whose end_date is NULL', () => {
        const partner = makePartner({ billing_mode: 'lifetime' });
        const offer = makeOffer(partner.id);

        expect(db.prepare('SELECT end_date FROM affiliate_partners WHERE id = ?').get(partner.id).end_date)
            .toBeNull();
        expect(resolveOfferForRedirect(offer.id, 'p'))
            .toEqual({ url: 'https://toko-sinar.example/produk/kamera-indoor' });
    });

    it('keeps a lifetime partner live even if a stale end_date sits in the row', () => {
        // A lifetime deal has no end date by definition; end_date must not be consulted for it.
        const partner = makePartner({ billing_mode: 'lifetime' });
        const offer = makeOffer(partner.id);
        db.prepare('UPDATE affiliate_partners SET end_date = ? WHERE id = ?').run('2020-01-01', partner.id);

        expect(resolveOfferForRedirect(offer.id, 'p')).not.toBeNull();
    });

    it('refuses when the OFFER has been deactivated', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);
        affiliateOfferService.updateOffer(offer.id, { active: false });

        expect(resolveOfferForRedirect(offer.id, 'p')).toBeNull();
    });

    it('refuses when the PARTNER has been deactivated', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);
        affiliateOfferService.updatePartner(partner.id, { active: false });

        expect(resolveOfferForRedirect(offer.id, 'p')).toBeNull();
        expect(resolveOfferForRedirect(offer.id, 's')).toBeNull();
    });

    it('refuses when a term partner window has passed', () => {
        const partner = makePartner({ billing_mode: 'term', start_date: '2026-01-01', end_date: YESTERDAY });
        const offer = makeOffer(partner.id);

        expect(resolveOfferForRedirect(offer.id, 'p')).toBeNull();
    });

    it('refuses before a term partner window has started', () => {
        const partner = makePartner({ billing_mode: 'term', start_date: NEXT_MONTH });
        const offer = makeOffer(partner.id);

        expect(resolveOfferForRedirect(offer.id, 'p')).toBeNull();
    });

    it('sends l=p to the product page and l=s to the shop', () => {
        const partner = makePartner({ store_url: 'https://toko-sinar.example/etalase' });
        const offer = makeOffer(partner.id, { product_url: 'https://toko-sinar.example/produk/9' });

        expect(resolveOfferForRedirect(offer.id, 'p').url).toBe('https://toko-sinar.example/produk/9');
        expect(resolveOfferForRedirect(offer.id, 's').url).toBe('https://toko-sinar.example/etalase');
    });

    it('refuses l=s when the partner has no shop URL', () => {
        const partner = makePartner({ store_url: null });
        const offer = makeOffer(partner.id);

        expect(resolveOfferForRedirect(offer.id, 's')).toBeNull();
        expect(resolveOfferForRedirect(offer.id, 'p')).not.toBeNull();
    });

    it('re-validates the stored URL, so a row edited outside the app cannot redirect', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);
        db.prepare('UPDATE affiliate_offers SET product_url = ? WHERE id = ?')
            .run('http://toko-lama.example/produk', offer.id);

        expect(resolveOfferForRedirect(offer.id, 'p')).toBeNull();
    });

    it('refuses an unknown offer id and an unknown link kind', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);

        expect(resolveOfferForRedirect(424242, 'p')).toBeNull();
        expect(resolveOfferForRedirect(offer.id, 'x')).toBeNull();
        expect(resolveOfferForRedirect(offer.id, '')).toBeNull();
        expect(resolveOfferForRedirect('1; DROP TABLE affiliate_offers', 'p')).toBeNull();
    });
});

describe('partnerScheduleState - one definition shared by resolve, redirect and the admin badge', () => {
    it.each([
        ['live', { active: 1, billing_mode: 'lifetime', start_date: null, end_date: null }],
        ['inactive', { active: 0, billing_mode: 'lifetime', start_date: null, end_date: null }],
        ['not_started', { active: 1, billing_mode: 'term', start_date: NEXT_MONTH, end_date: null }],
        ['expired', { active: 1, billing_mode: 'term', start_date: '2026-01-01', end_date: YESTERDAY }],
        ['live', { active: 1, billing_mode: 'lifetime', start_date: '2026-01-01', end_date: YESTERDAY }],
        ['missing', null],
    ])('reports %s', (expected, partner) => {
        expect(partnerScheduleState(partner, TODAY)).toBe(expected);
    });

    it('agrees with what the public resolver actually serves', () => {
        // The admin chip and the visitor must never disagree about whether a deal is running.
        const cases = [
            {},
            { active: false },
            { billing_mode: 'term', start_date: NEXT_MONTH },
            { billing_mode: 'term', start_date: '2026-01-01', end_date: YESTERDAY },
        ];
        for (const overrides of cases) {
            resetSchema();
            const partner = makePartner(overrides);
            makeOffer(partner.id);
            const served = resolveOfferForContext({ placement: 'popup', cameraId: 11 }) !== null;
            const badge = affiliateOfferService.getPartner(partner.id).is_live === 1;
            expect(badge, JSON.stringify(overrides)).toBe(served);
        }
    });
});

describe('stat writes - the guarded daily UPSERT', () => {
    it('accumulates into ONE row per offer per day instead of one row per event', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);

        recordImpression(offer.id);
        recordImpression(offer.id);
        recordClick(offer.id, 'p');
        recordClick(offer.id, 's');
        recordClick(offer.id, 's');

        const rows = statRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            offer_id: offer.id,
            stat_date: TODAY,
            impressions: 2,
            product_clicks: 1,
            store_clicks: 2,
        });
    });

    it('files the count under the WIB local date, not the UTC date', () => {
        // getLocalDate() is pinned above. A regression to SQLite's date('now') would write the real
        // UTC day here, which for the first 7 hours of every WIB day is yesterday in Bojonegoro.
        const partner = makePartner();
        const offer = makeOffer(partner.id);
        recordImpression(offer.id);

        expect(statRows()[0].stat_date).toBe(TODAY);
    });

    it('increments the product column for l=p and the store column for l=s, never the other', () => {
        const partner = makePartner();
        const a = makeOffer(partner.id, { product_title: 'A' });
        const b = makeOffer(partner.id, { product_title: 'B' });

        recordClick(a.id, 'p');
        recordClick(b.id, 's');

        const byOffer = Object.fromEntries(statRows().map((r) => [r.offer_id, r]));
        expect(byOffer[a.id]).toMatchObject({ product_clicks: 1, store_clicks: 0, impressions: 0 });
        expect(byOffer[b.id]).toMatchObject({ product_clicks: 0, store_clicks: 1, impressions: 0 });
    });

    it('cannot create a stat row for an offer id that does not exist', () => {
        // The id comes straight out of a public URL. Without the WHERE EXISTS guard a forged or
        // stale id would either mint orphan rows or raise a foreign-key error on a visitor request.
        const partner = makePartner();
        makeOffer(partner.id);

        expect(() => recordImpression(999999)).not.toThrow();
        expect(() => recordClick(999999, 'p')).not.toThrow();
        expect(statRows()).toEqual([]);
    });

    it('ignores a non-integer id without throwing', () => {
        expect(() => recordImpression(null)).not.toThrow();
        expect(() => recordClick('1; DROP TABLE affiliate_offers', 'p')).not.toThrow();
        expect(statRows()).toEqual([]);
        expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'affiliate_offers'").get()).toBeTruthy();
    });

    it('never throws on an unknown link kind, and writes nothing for it', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);

        expect(() => recordClick(offer.id, 'impressions')).not.toThrow();
        expect(() => recordClick(offer.id, undefined)).not.toThrow();
        expect(statRows()).toEqual([]);
    });

    it('maps only p and s to a stat column and throws on anything else', () => {
        // SQLite cannot parameterize an identifier, so this map is the only thing standing between
        // a query-string value and an interpolated column name.
        expect(statColumnFor('p')).toBe('product_clicks');
        expect(statColumnFor('s')).toBe('store_clicks');

        for (const bogus of ['impressions', 'P', '', 'id', 'constructor', '__proto__', 'toString', 'store_clicks']) {
            expect(() => statColumnFor(bogus), bogus).toThrow();
        }
        expect(() => statColumnFor(null)).toThrow();

        let thrown = null;
        try {
            statColumnFor('constructor');
        } catch (error) {
            thrown = error;
        }
        expect(thrown.statusCode).toBe(400);
    });

    it('serves the daily series back to the admin panel', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);
        recordImpression(offer.id);
        recordClick(offer.id, 'p');

        expect(affiliateOfferService.getOfferStats(offer.id, 30)).toEqual([
            { stat_date: TODAY, impressions: 1, product_clicks: 1, store_clicks: 0 },
        ]);
    });
});

describe('write-path rules', () => {
    it('accepts price_rupiah = 0 as a legitimate deal', () => {
        // The operator promotes their own shop through the same machinery for free. There must
        // never be a "paid plans cannot be zero" rule on this column.
        const partner = makePartner({ price_rupiah: 0 });
        expect(partner.price_rupiah).toBe(0);
        expect(partner.is_live).toBe(1);
    });

    it('refuses a float or a negative price (money is INTEGER rupiah)', () => {
        expect(() => makePartner({ price_rupiah: 150000.5 })).toThrow(/bulat/i);
        expect(() => makePartner({ price_rupiah: -1 })).toThrow(/bulat/i);
    });

    it('refuses an unsafe outbound URL on both the partner and the offer', () => {
        expect(() => makePartner({ store_url: 'http://toko-sinar.example' })).toThrow(/URL toko/);
        const partner = makePartner();
        expect(() => makeOffer(partner.id, { product_url: 'javascript:alert(1)' })).toThrow(/URL produk/);
        expect(() => makeOffer(partner.id, { product_url: 'https://user:pw@evil.test' })).toThrow(/URL produk/);
    });

    it('clears a leftover end_date when a partner is switched to lifetime', () => {
        const partner = makePartner({ billing_mode: 'term', start_date: '2026-01-01', end_date: '2026-12-31' });
        const updated = affiliateOfferService.updatePartner(partner.id, { billing_mode: 'lifetime' });

        expect(updated.billing_mode).toBe('lifetime');
        expect(updated.end_date).toBeNull();
    });

    it('replaces offer targets wholesale rather than accumulating them', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id, { target_mode: 'area', area_ids: [2, 3] });

        affiliateOfferService.updateOffer(offer.id, { area_ids: [9] });

        const stored = affiliateOfferService.getOffer(offer.id);
        expect(stored.area_ids).toEqual([9]);
        expect(db.prepare('SELECT COUNT(*) AS n FROM affiliate_offer_targets').get().n).toBe(1);
    });

    it('removes an offer with its targets and its stats', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id, { target_mode: 'camera', camera_ids: [11] });
        recordImpression(offer.id);

        affiliateOfferService.deleteOffer(offer.id);

        expect(db.prepare('SELECT COUNT(*) AS n FROM affiliate_offer_targets').get().n).toBe(0);
        expect(statRows()).toEqual([]);
        expect(affiliateOfferService.listOffers()).toEqual([]);
    });

    it('removes a partner together with every offer, target and stat row under it', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id, { target_mode: 'area', area_ids: [2] });
        recordClick(offer.id, 'p');

        affiliateOfferService.deletePartner(partner.id);

        expect(affiliateOfferService.listOffers()).toEqual([]);
        expect(affiliateOfferService.listPartners()).toEqual([]);
        expect(db.prepare('SELECT COUNT(*) AS n FROM affiliate_offer_targets').get().n).toBe(0);
        expect(statRows()).toEqual([]);
    });

    it('refuses an offer for a partner that does not exist', () => {
        expect(() => makeOffer(424242)).toThrow(/Partner/i);
    });

    it('validates placements, target mode and billing mode', () => {
        expect(() => normalizePlacements([])).toThrow(/minimal satu/i);
        expect(() => normalizePlacements(['bogus'])).toThrow(/minimal satu/i);
        expect(normalizePlacements(['popup', 'popup', 'bogus', 'landing'])).toEqual(['popup', 'landing']);

        expect(() => normalizeTargetMode('everyone')).toThrow(/target_mode/);
        expect(normalizeTargetMode('camera')).toBe('camera');

        expect(() => normalizeBillingMode('gratis')).toThrow(/billing_mode/);
        expect(normalizeBillingMode('lifetime')).toBe('lifetime');
    });

    it('treats a corrupt placements blob as matching nothing instead of throwing', () => {
        expect(parsePlacements('not json')).toEqual([]);
        expect(parsePlacements(null)).toEqual([]);
        expect(parsePlacements('["popup","bogus"]')).toEqual(['popup']);

        const partner = makePartner();
        const offer = makeOffer(partner.id);
        db.prepare('UPDATE affiliate_offers SET placements = ? WHERE id = ?').run('{oops', offer.id);
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 })).toBeNull();
    });
});

describe('count throttle - bounded, swept, and applied to impressions as well as clicks', () => {
    /*
     * frontend/src/services/apiClient.js replays a failed GET twice (400ms, then 1200ms), so one
     * viewer on a flaky mobile link produces up to three resolve requests for a single rendered
     * card. Without this, a partner would be invoiced against impressions nobody can reconcile.
     * The window is deliberately longer than that 1.6s retry ladder.
     */
    it('counts the first event and collapses a repeat inside the window', () => {
        expect(allowCount('1.2.3.4:i:7', 1000)).toBe(true);
        expect(allowCount('1.2.3.4:i:7', 1400)).toBe(false); // apiClient retry #1
        expect(allowCount('1.2.3.4:i:7', 2600)).toBe(false); // apiClient retry #2
    });

    it('counts again once the window has passed', () => {
        expect(allowCount('1.2.3.4:i:7', 1000)).toBe(true);
        expect(allowCount('1.2.3.4:i:7', 1000 + COUNT_WINDOW_MS - 1)).toBe(false);
        expect(allowCount('1.2.3.4:i:7', 1000 + COUNT_WINDOW_MS)).toBe(true);
    });

    it('does not let a blocked repeat extend the window (fixed window, not sliding)', () => {
        // Otherwise a retry storm could keep a legitimate later view from ever being counted.
        expect(allowCount('k', 1000)).toBe(true);
        for (let t = 1100; t < 1000 + COUNT_WINDOW_MS; t += 500) {
            expect(allowCount('k', t)).toBe(false);
        }
        expect(allowCount('k', 1000 + COUNT_WINDOW_MS)).toBe(true);
    });

    it('keeps separate identities, offers and link kinds apart', () => {
        expect(allowCount('1.2.3.4:c:7:p', 1000)).toBe(true);
        expect(allowCount('1.2.3.4:c:7:s', 1000)).toBe(true);
        expect(allowCount('5.6.7.8:c:7:p', 1000)).toBe(true);
        expect(allowCount('1.2.3.4:c:8:p', 1000)).toBe(true);
        expect(allowCount('1.2.3.4:c:7:p', 1000)).toBe(false);
    });

    it('refuses a key it cannot bucket rather than counting it', () => {
        // An uncounted impression is a small reporting gap; an unbucketable key is an unbounded map.
        expect(allowCount('', 1000)).toBe(false);
        expect(allowCount(null, 1000)).toBe(false);
        expect(allowCount(undefined, 1000)).toBe(false);
        expect(throttleSize()).toBe(0);
    });

    it('never grows past its cap, however many identities arrive', () => {
        // The key contains a client IP on a public, unauthenticated endpoint. A bare Map here is an
        // unbounded allocation an attacker chooses the size of.
        for (let i = 0; i < MAX_THROTTLE_KEYS + 300; i += 1) {
            allowCount(`ip-${i}:i:1`, 1000);
        }
        expect(throttleSize()).toBe(MAX_THROTTLE_KEYS);
    });

    it('sweeps dead keys once a quiet period passes', () => {
        allowCount('a:i:1', 1000);
        allowCount('b:i:1', 1000);
        expect(throttleSize()).toBe(2);

        allowCount('c:i:1', 1000 + SWEEP_INTERVAL_MS);
        expect(throttleSize()).toBe(1);
    });

    it('treats a backwards clock step as a fresh window instead of blocking the key', () => {
        expect(allowCount('k', 10_000)).toBe(true);
        expect(allowCount('k', 5_000)).toBe(true);
    });
});
