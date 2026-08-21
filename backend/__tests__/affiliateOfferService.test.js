/**
 * Purpose: Prove the affiliate feature's data rules - the thirteen-key public payload (anti-leak),
 *          the three optional extras (WhatsApp / price / photo, each switched by PRESENCE alone),
 *          targeting precedence, the liveness re-check the /go redirect performs on every read,
 *          the guarded daily stat UPSERT, and the bounded count throttle.
 * Caller: Backend test gate (vitest, node env).
 * Deps: vitest, better-sqlite3 (in-memory, real schema), mocked connectionPool + pinned timeService.
 * MainFuncs: resolveOfferForContext / resolveOfferForRedirect / recordImpression / recordClick /
 *            partner + offer CRUD / setOfferImage / getOfferStats / allowCount.
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
    buildOfferWhatsAppUrl,
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
    setOfferImage,
    statColumnFor,
} from '../services/affiliateOfferService.js';
import { PUBLIC_PAYLOAD_KEYS } from '../services/affiliateOfferExtras.js';
import {
    COUNT_WINDOW_MS,
    MAX_THROTTLE_KEYS,
    SWEEP_INTERVAL_MS,
    _resetThrottleForTests,
    allowCount,
    throttleSize,
} from '../utils/affiliateCountThrottle.js';

/**
 * The exact schema from database/migrations/zz_20260820_add_affiliate_offers.js, PLUS the columns
 * zz_20260821_add_affiliate_offer_extras.js adds on top of it.
 *
 * The extras are spelled here exactly as that migration spells them - every one of them NULLABLE
 * and, critically, `product_price_rupiah INTEGER` with NO DEFAULT. A `DEFAULT 0` here would make
 * this fixture disagree with production about the one distinction the whole price feature rests
 * on: NULL means "this offer advertises no price", 0 means "gratis". A fixture that cannot express
 * the difference cannot fail when the code loses it.
 */
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
            whatsapp_number TEXT,
            whatsapp_message TEXT,
            product_price_rupiah INTEGER,
            image_base TEXT,
            image_width INTEGER,
            image_height INTEGER,
            image_bytes INTEGER,
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
            whatsapp_clicks INTEGER NOT NULL DEFAULT 0,
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
    it('contains EXACTLY the thirteen contracted keys and nothing else', () => {
        const partner = makePartner();
        makeOffer(partner.id, {
            description: 'Garansi resmi 1 tahun',
            whatsapp_number: '081298765432',
            product_price_rupiah: 149000,
        });

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });

        // Spelled out literally, NOT compared against the module's own constant: a list imported
        // from the code under test would agree with whatever that code decided to emit today.
        expect(Object.keys(payload).sort()).toEqual([
            'description',
            'id',
            'image_base',
            'image_height',
            'image_width',
            'price_rupiah',
            'product_href',
            'product_title',
            'product_url',
            'store_href',
            'store_name',
            'store_url',
            'whatsapp_url',
        ]);
    });

    it('emits all thirteen keys, as nulls, when every optional extra is unset', () => {
        // The shape is fixed so the frontend branches on a VALUE, never on `in`/undefined - a key
        // that disappears when empty is a second way to say "absent" and the two eventually differ.
        const partner = makePartner({ store_url: null });
        makeOffer(partner.id, { description: null });

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
        expect(Object.keys(payload)).toHaveLength(13);
        for (const key of ['description', 'store_url', 'store_href', 'whatsapp_url', 'price_rupiah',
            'image_base', 'image_width', 'image_height']) {
            expect(payload[key], key).toBeNull();
        }
    });

    it('keeps the exported PUBLIC_PAYLOAD_KEYS honest about what is actually emitted', () => {
        // The constant is what affiliateOfferExtras.js documents as the contract; the literal list
        // above is the contract. This ties the two together, so a key added to one and not the
        // other cannot pass unnoticed in either direction.
        const partner = makePartner();
        makeOffer(partner.id);

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
        expect([...PUBLIC_PAYLOAD_KEYS].sort()).toEqual(Object.keys(payload).sort());
        expect(PUBLIC_PAYLOAD_KEYS).toHaveLength(13);
    });

    it('never carries a camera name, an area name, the partner id, the FEE, the contact note or the schedule', () => {
        const partner = makePartner();
        makeOffer(partner.id, {
            description: 'Garansi resmi 1 tahun',
            whatsapp_number: '081298765432',
            // Deliberately a DIFFERENT number from the partner's 250000 fee, so "the price leaked"
            // and "the price is shown" cannot be confused for one another.
            product_price_rupiah: 149000,
        });

        const serialized = JSON.stringify(resolveOfferForContext({ placement: 'popup', cameraId: 11 }));

        // Camera / area identity: the slot must not double as a way to enumerate cameras, and a
        // non-community camera's name must never appear on a public surface at all.
        expect(serialized).not.toContain('LAPANGAN');
        expect(serialized).not.toContain('DANDER');
        expect(serialized).not.toContain('RUMAH PAK RT');
        // affiliate_partners.price_rupiah is what the operator charges the SHOP. It is a different
        // number from product_price_rupiah, which is what the visitor sees - and only one of them
        // is public. The visitor's price IS here; the fee must not be.
        expect(serialized).toContain('149000');
        expect(serialized).not.toContain('250000');
        // The counterparty's private contact details, which live one JOIN away from this payload.
        expect(serialized).not.toContain('081234567890');
        expect(serialized).not.toContain('Pak Budi');
        expect(serialized).not.toContain('partner_id');
        // Internal bookkeeping: the schedule, the targeting, the flags, and the raw column names
        // behind the three extras (the payload exposes whatsapp_url, never the number or template).
        for (const internal of ['billing_mode', 'start_date', 'end_date', 'active', 'target_mode',
            'placements', 'priority', 'contact_note', 'whatsapp_number', 'whatsapp_message',
            'product_price_rupiah', 'image_bytes']) {
            expect(serialized, internal).not.toContain(internal);
        }
    });

    it('advertises the REAL destination alongside the /go redirector, keyed p and s', () => {
        // Phase 1 emitted only /go. That was reversed on purpose: a relative href is inside the
        // PWA's "/" scope, so an installed PWA follows the 302 itself and strands the visitor on a
        // stranger's shop inside our shell, with no address bar. An absolute https URL is out of
        // scope and Android hands it to the browser. /go stays as the no-JS fallback and counter.
        const partner = makePartner({ store_url: 'https://toko-sinar.example/etalase' });
        const offer = makeOffer(partner.id, { product_url: 'https://toko-sinar.example/produk/9' });

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
        expect(payload.product_url).toBe('https://toko-sinar.example/produk/9');
        expect(payload.store_url).toBe('https://toko-sinar.example/etalase');
        expect(payload.product_href).toBe(`/api/public/affiliate/offers/${offer.id}/go?l=p`);
        expect(payload.store_href).toBe(`/api/public/affiliate/offers/${offer.id}/go?l=s`);
    });

    it('offers no store link at all when the partner has no shop URL', () => {
        const partner = makePartner({ store_url: null });
        makeOffer(partner.id);

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
        expect(payload.store_url).toBeNull();
        expect(payload.store_href).toBeNull();
        expect(Object.keys(payload)).toHaveLength(13);
    });

    it('emits null rather than a destination it cannot vouch for', () => {
        // The URL is re-validated ON THE WAY OUT, not only on write: a row can predate the policy
        // or be edited straight in sqlite3, and what leaves here becomes an href in a public page,
        // where `javascript:` is worse than it is in a Location header.
        const partner = makePartner();
        const offer = makeOffer(partner.id);
        db.prepare('UPDATE affiliate_offers SET product_url = ? WHERE id = ?')
            .run('javascript:alert(1)', offer.id);
        db.prepare('UPDATE affiliate_partners SET store_url = ? WHERE id = ?')
            .run('http://toko-lama.example', partner.id);

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
        expect(payload.product_url).toBeNull();
        expect(payload.store_url).toBeNull();
        expect(JSON.stringify(payload)).not.toContain('javascript:');
        // The /go href survives; it re-resolves and refuses on its own, and a dead redirector is a
        // 404 rather than an anchor the browser will happily execute.
        expect(payload.product_href).toBe(`/api/public/affiliate/offers/${offer.id}/go?l=p`);
        expect(payload.store_href).toBeNull();
    });

    it('builds the same thirteen keys directly from a row, with a missing description as null', () => {
        expect(buildPublicPayload({
            id: 7,
            product_title: 'Kamera',
            description: '',
            store_name: 'Toko',
            product_url: 'https://toko.example/p/7',
            store_url: null,
            whatsapp_number: null,
            whatsapp_message: null,
            product_price_rupiah: null,
            image_base: null,
            image_width: null,
            image_height: null,
        })).toEqual({
            id: 7,
            product_title: 'Kamera',
            description: null,
            store_name: 'Toko',
            product_url: 'https://toko.example/p/7',
            store_url: null,
            product_href: '/api/public/affiliate/offers/7/go?l=p',
            store_href: null,
            whatsapp_url: null,
            price_rupiah: null,
            image_base: null,
            image_width: null,
            image_height: null,
        });
    });
});

describe('product price - NULL and 0 are different facts', () => {
    /*
     * The whole price feature rests on this distinction, and it is the kind that gets flattened by
     * a helpful `?? 0` or a `DEFAULT 0` in a later migration:
     *
     *   NULL -> this offer does not advertise a price at all; the card shows no price row.
     *   0    -> this offer costs nothing ("gratis"), and the card says so.
     *
     * Presence is the switch, so NULL is the OFF position - there is no show_price flag to consult
     * instead. A code path that cannot tell the two apart silently prints "Rp0" on every offer
     * whose price was never set, which is a lie about a partner's product on a public page.
     */
    it('stores NULL when no price is given, and reports it as null publicly', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);

        expect(db.prepare('SELECT product_price_rupiah AS p FROM affiliate_offers WHERE id = ?')
            .get(offer.id).p).toBeNull();
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).price_rupiah).toBeNull();
    });

    it('stores 0 as 0 and reports it as 0, never as "no price"', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id, { product_price_rupiah: 0 });

        expect(db.prepare('SELECT product_price_rupiah AS p FROM affiliate_offers WHERE id = ?')
            .get(offer.id).p).toBe(0);
        const price = resolveOfferForContext({ placement: 'popup', cameraId: 11 }).price_rupiah;
        expect(price).toBe(0);
        expect(price).not.toBeNull();
    });

    it('round-trips an ordinary integer price through create, read and the public payload', () => {
        const partner = makePartner();
        makeOffer(partner.id, { product_price_rupiah: 149000 });

        expect(affiliateOfferService.listOffers()[0].product_price_rupiah).toBe(149000);
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).price_rupiah).toBe(149000);
    });

    it('clears a price back to NULL when the field is submitted empty', () => {
        // Clearing is how the price is switched off, so '' MUST mean NULL and not 0 - and it must
        // reach the column, not merely be ignored as "nothing sent".
        const partner = makePartner();
        const offer = makeOffer(partner.id, { product_price_rupiah: 149000 });

        affiliateOfferService.updateOffer(offer.id, { product_price_rupiah: '' });

        expect(db.prepare('SELECT product_price_rupiah AS p FROM affiliate_offers WHERE id = ?')
            .get(offer.id).p).toBeNull();
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).price_rupiah).toBeNull();
    });

    it('refuses a float or a negative product price (money is INTEGER rupiah)', () => {
        // The Critical Invariant. A float here would be rounded by whichever formatter reached it
        // first and print a price nobody set.
        const partner = makePartner();
        expect(() => makeOffer(partner.id, { product_price_rupiah: 149000.5 })).toThrow(/bulat/i);
        expect(() => makeOffer(partner.id, { product_price_rupiah: -1 })).toThrow(/bulat/i);
        expect(() => makeOffer(partner.id, { product_price_rupiah: 'gratis' })).toThrow(/bulat/i);

        // And a PUT must refuse exactly what a POST refuses; validating on create only is how a
        // value the API rejects ends up in the table anyway.
        const offer = makeOffer(partner.id);
        expect(() => affiliateOfferService.updateOffer(offer.id, { product_price_rupiah: 1.5 })).toThrow(/bulat/i);
        expect(() => affiliateOfferService.updateOffer(offer.id, { product_price_rupiah: -5 })).toThrow(/bulat/i);
    });

    it('ignores a price that is not an integer in the ROW, rather than printing it', () => {
        // Defence on the read side too: a hand-edited or legacy row holding a float must show no
        // price at all instead of a rounded one.
        const partner = makePartner();
        const offer = makeOffer(partner.id, { product_price_rupiah: 149000 });
        db.prepare('UPDATE affiliate_offers SET product_price_rupiah = ? WHERE id = ?').run(1500.75, offer.id);

        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).price_rupiah).toBeNull();
    });
});

describe('WhatsApp CTA - presence is the switch, and {kamera} is not a placeholder', () => {
    it('emits no whatsapp_url at all when the offer has no number', () => {
        const partner = makePartner();
        makeOffer(partner.id);

        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).whatsapp_url).toBeNull();
    });

    it('appears the moment a number is filled and disappears when it is cleared', () => {
        // This IS the switch. There is no show_whatsapp boolean to disagree with the number.
        const partner = makePartner();
        const offer = makeOffer(partner.id);

        affiliateOfferService.updateOffer(offer.id, { whatsapp_number: '081298765432' });
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).whatsapp_url)
            .toContain('https://wa.me/6281298765432?text=');

        affiliateOfferService.updateOffer(offer.id, { whatsapp_number: '' });
        expect(db.prepare('SELECT whatsapp_number AS n FROM affiliate_offers WHERE id = ?')
            .get(offer.id).n).toBeNull();
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 }).whatsapp_url).toBeNull();
    });

    it('substitutes {barang} and {toko} with the offer and shop that already appear on the card', () => {
        const partner = makePartner({ store_name: 'Toko Sinar' });
        makeOffer(partner.id, {
            product_title: 'Kamera Indoor 2MP',
            whatsapp_number: '081298765432',
            whatsapp_message: 'Halo {toko}, saya mau tanya {barang}',
        });

        const url = resolveOfferForContext({ placement: 'popup', cameraId: 11 }).whatsapp_url;
        expect(decodeURIComponent(url.split('text=')[1]))
            .toBe('Halo Toko Sinar, saya mau tanya Kamera Indoor 2MP');
        // The text is percent-encoded, so a space never reaches the anchor raw.
        expect(url).not.toContain(' ');
    });

    it('NEVER substitutes a camera name, however hard the template asks for one', () => {
        /*
         * THE LEAK THIS FEATURE MUST NOT REPEAT.
         *
         * promoBannerService.resolvePromoBannerForContext carries a comment claiming no camera
         * field is echoed to the caller, then substitutes {kamera} into its public cta_url - on a
         * query with no camera_class filter, so an owner_private or subscriber camera's name (i.e.
         * someone's home) can reach an anonymous visitor.
         *
         * Here the resolver selects `area_id` and nothing else, so there is no name in scope to
         * leak. This test asserts that from the outside: an operator who types {kamera} gets the
         * literal text back, not the camera. Camera 11 is even a community camera - if the name of
         * a PUBLIC camera cannot get in, a private one certainly cannot.
         */
        const partner = makePartner();
        makeOffer(partner.id, {
            whatsapp_number: '081298765432',
            whatsapp_message: 'Halo, saya lihat di {kamera} soal {barang}',
        });

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
        const serialized = JSON.stringify(payload);

        expect(serialized).not.toContain('LAPANGAN');
        expect(serialized).not.toContain('DANDER');
        expect(decodeURIComponent(payload.whatsapp_url.split('text=')[1]))
            .toBe('Halo, saya lihat di {kamera} soal Kamera Indoor 2MP');
    });

    it('falls back to a default opener when only the number is set', () => {
        const partner = makePartner();
        makeOffer(partner.id, { product_title: 'Kamera Indoor 2MP', whatsapp_number: '081298765432' });

        const url = resolveOfferForContext({ placement: 'popup', cameraId: 11 }).whatsapp_url;
        expect(decodeURIComponent(url.split('text=')[1])).toContain('Kamera Indoor 2MP');
    });

    it('normalises a local 08 number to the international form wa.me needs', () => {
        expect(buildOfferWhatsAppUrl({ whatsapp_number: '0812-9876-5432', product_title: 'X' }))
            .toContain('https://wa.me/6281298765432?');
        expect(buildOfferWhatsAppUrl({ whatsapp_number: '6281298765432', product_title: 'X' }))
            .toContain('https://wa.me/6281298765432?');
        expect(buildOfferWhatsAppUrl({ whatsapp_number: '', product_title: 'X' })).toBeNull();
        expect(buildOfferWhatsAppUrl({})).toBeNull();
    });

    it('refuses an implausible number on write instead of storing a dead link', () => {
        // A wa.me link to a nonexistent number fails silently inside WhatsApp, where neither the
        // operator nor we can see it. Refusing at the panel is the only place it is visible.
        const partner = makePartner();
        expect(() => makeOffer(partner.id, { whatsapp_number: '0812' })).toThrow(/WhatsApp/i);
        expect(() => makeOffer(partner.id, { whatsapp_number: '0812345678901234567' })).toThrow(/WhatsApp/i);

        const offer = makeOffer(partner.id);
        expect(() => affiliateOfferService.updateOffer(offer.id, { whatsapp_number: '0812' })).toThrow(/WhatsApp/i);
    });
});

describe('product photo - presence is the switch, and the base is allowlisted on the way out', () => {
    const GOOD_BASE = 'aff-0123456789abcdef';

    it('emits no image trio at all until a photo is attached', () => {
        const partner = makePartner();
        makeOffer(partner.id);

        const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
        expect(payload.image_base).toBeNull();
        expect(payload.image_width).toBeNull();
        expect(payload.image_height).toBeNull();
    });

    it('publishes the base and its dimensions once a photo is attached, and drops all three when cleared', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);

        setOfferImage(offer.id, { imageBase: GOOD_BASE, width: 320, height: 240, bytes: 8192 });
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 })).toMatchObject({
            image_base: GOOD_BASE,
            image_width: 320,
            image_height: 240,
        });

        // Clearing image_base IS how "no photo" is expressed - there is no show_image flag.
        affiliateOfferService.clearOfferImage(offer.id);
        expect(resolveOfferForContext({ placement: 'popup', cameraId: 11 })).toMatchObject({
            image_base: null,
            image_width: null,
            image_height: null,
        });
    });

    it('refuses to publish a base that fails the affiliate filename allowlist', () => {
        /*
         * The frontend turns image_base into `/api/affiliate-media/<base>-320.webp`, so an
         * unvalidated base is a path fragment we hand a browser. A doctored row must produce no
         * image at all - and it must take the dimensions with it, because a width with no picture
         * is worse than no picture.
         */
        const partner = makePartner();
        const offer = makeOffer(partner.id);
        setOfferImage(offer.id, { imageBase: GOOD_BASE, width: 320, height: 240, bytes: 8192 });

        for (const hostile of ['../../etc/passwd', 'aff-../../etc/passwd', '/etc/passwd',
            'aff-ABCDEF', 'aff-abc', 'promo-0123456789ab', '']) {
            db.prepare('UPDATE affiliate_offers SET image_base = ? WHERE id = ?').run(hostile, offer.id);
            const payload = resolveOfferForContext({ placement: 'popup', cameraId: 11 });
            expect(payload.image_base, hostile).toBeNull();
            expect(payload.image_width, hostile).toBeNull();
            expect(payload.image_height, hostile).toBeNull();
        }
    });

    it('keeps the byte count internal - it is operator bookkeeping, not visitor content', () => {
        const partner = makePartner();
        const offer = makeOffer(partner.id);
        setOfferImage(offer.id, { imageBase: GOOD_BASE, width: 320, height: 240, bytes: 8192 });

        expect(JSON.stringify(resolveOfferForContext({ placement: 'popup', cameraId: 11 })))
            .not.toContain('8192');
        // ...but the admin projection still has it, so this is about the PUBLIC payload only.
        expect(affiliateOfferService.getOffer(offer.id).image_bytes).toBe(8192);
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

    it('refuses l=w outright - a WhatsApp tap is countable, never navigable', () => {
        /*
         * `w` is a real link kind: it counts. What it must never have is a DESTINATION. Falling
         * through to the product URL would file one intent as another AND land the visitor
         * somewhere they did not tap; redirecting to wa.me instead would leave a stable, guessable
         * URL on our domain that opens a chat with a partner's phone number - a free
         * "our domain in front of your WhatsApp link" tool for anyone who finds it.
         *
         * Null here is what the controller turns into a 404 on the non-beacon path.
         */
        const partner = makePartner();
        const offer = makeOffer(partner.id, { whatsapp_number: '081298765432' });

        expect(resolveOfferForRedirect(offer.id, 'w')).toBeNull();
        // ...while the very same offer still redirects for the two kinds that do have a target,
        // so this is a rule about `w` and not a dead offer.
        expect(resolveOfferForRedirect(offer.id, 'p')).not.toBeNull();
        expect(resolveOfferForRedirect(offer.id, 's')).not.toBeNull();
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
        recordClick(offer.id, 'w');

        const rows = statRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            offer_id: offer.id,
            stat_date: TODAY,
            impressions: 2,
            product_clicks: 1,
            store_clicks: 2,
            whatsapp_clicks: 1,
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

    it('sends p, s and w to three different columns and never to each other', () => {
        /*
         * A WhatsApp tap is a different intent from a product tap - starting a conversation, not
         * browsing - and it is what a partner is invoiced against, so folding it into
         * product_clicks would produce one number nobody can read. Three offers, one event each,
         * so a mapping that collapsed two kinds into one column shows up as a column that moved
         * on the wrong row rather than as a total that still happens to add up.
         */
        const partner = makePartner();
        const a = makeOffer(partner.id, { product_title: 'A' });
        const b = makeOffer(partner.id, { product_title: 'B' });
        const c = makeOffer(partner.id, { product_title: 'C', whatsapp_number: '081298765432' });

        recordClick(a.id, 'p');
        recordClick(b.id, 's');
        recordClick(c.id, 'w');

        const byOffer = Object.fromEntries(statRows().map((r) => [r.offer_id, r]));
        expect(byOffer[a.id]).toMatchObject({ product_clicks: 1, store_clicks: 0, whatsapp_clicks: 0, impressions: 0 });
        expect(byOffer[b.id]).toMatchObject({ product_clicks: 0, store_clicks: 1, whatsapp_clicks: 0, impressions: 0 });
        expect(byOffer[c.id]).toMatchObject({ product_clicks: 0, store_clicks: 0, whatsapp_clicks: 1, impressions: 0 });
    });

    it('cannot mint a phantom whatsapp row for an offer id that does not exist', () => {
        // The WHERE EXISTS guard has to cover the NEW column too: the id arrives from a public URL
        // and `w` is reachable by the same beacon a forged id can be aimed at.
        const partner = makePartner();
        makeOffer(partner.id);

        expect(() => recordClick(999999, 'w')).not.toThrow();
        expect(statRows()).toEqual([]);
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

    it('maps only p, s and w to a stat column and throws on anything else', () => {
        // SQLite cannot parameterize an identifier, so this map is the only thing standing between
        // a query-string value and an interpolated column name.
        expect(statColumnFor('p')).toBe('product_clicks');
        expect(statColumnFor('s')).toBe('store_clicks');
        expect(statColumnFor('w')).toBe('whatsapp_clicks');

        for (const bogus of ['impressions', 'P', 'W', '', 'id', 'constructor', '__proto__', 'toString', 'store_clicks', 'whatsapp_clicks']) {
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

        recordClick(offer.id, 'w');

        expect(affiliateOfferService.getOfferStats(offer.id, 30)).toEqual([
            { stat_date: TODAY, impressions: 1, product_clicks: 1, store_clicks: 0, whatsapp_clicks: 1 },
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
