/*
 * promoBannerService.test.js — targeting resolution, scheduling, and stats for the
 * provider promo banner.
 *
 * These run against a REAL in-memory SQLite with the real schema rather than a
 * mocked query(): the whole point of the resolver is its SQL (specificity order,
 * date window, EXISTS targeting, upsert conflict target), and a stubbed query()
 * would assert nothing about any of that.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const { db } = vi.hoisted(() => {
    const Db = require('better-sqlite3');
    return { db: new Db(':memory:') };
});

vi.mock('../database/connectionPool.js', () => ({
    query: (sql, params = []) => db.prepare(sql).all(params),
    queryOne: (sql, params = []) => db.prepare(sql).get(params),
    execute: (sql, params = []) => db.prepare(sql).run(params),
    transaction: (fn) => db.transaction(fn),
}));

// Pin "today" so the schedule-window assertions do not drift with the clock.
vi.mock('../services/timeService.js', () => ({
    getLocalDate: () => '2026-08-12',
}));

vi.mock('../services/promoImageService.js', () => ({
    deletePromoImage: vi.fn(() => 0),
}));

const {
    resolvePromoBannerForContext,
    createPromoBanner,
    updatePromoBanner,
    deletePromoBanner,
    setPromoBannerTargets,
    listPromoBanners,
    recordImpression,
    recordClick,
    getPromoBannerStats,
    buildWhatsAppUrl,
    normalizePlacements,
    normalizeTargetMode,
} = await import('../services/promoBannerService.js');

function resetSchema() {
    db.exec(`
        DROP TABLE IF EXISTS promo_banner_stats;
        DROP TABLE IF EXISTS promo_banner_targets;
        DROP TABLE IF EXISTS promo_banners;
        DROP TABLE IF EXISTS cameras;
        DROP TABLE IF EXISTS areas;

        CREATE TABLE areas (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE cameras (id INTEGER PRIMARY KEY, name TEXT, area_id INTEGER);

        CREATE TABLE promo_banners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            alt_text TEXT,
            image_base TEXT,
            image_width INTEGER,
            image_height INTEGER,
            image_bytes INTEGER,
            cta_label TEXT,
            cta_url TEXT,
            whatsapp_number TEXT,
            whatsapp_message TEXT,
            target_mode TEXT NOT NULL DEFAULT 'all',
            placements TEXT NOT NULL DEFAULT '["popup"]',
            active INTEGER NOT NULL DEFAULT 1,
            start_date TEXT,
            end_date TEXT,
            priority INTEGER NOT NULL DEFAULT 100,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE promo_banner_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            promo_id INTEGER NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER NOT NULL,
            UNIQUE (promo_id, target_type, target_id)
        );
        CREATE TABLE promo_banner_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            promo_id INTEGER NOT NULL,
            stat_date TEXT NOT NULL,
            impressions INTEGER NOT NULL DEFAULT 0,
            clicks INTEGER NOT NULL DEFAULT 0,
            UNIQUE (promo_id, stat_date)
        );

        INSERT INTO areas (id, name) VALUES (2, 'DANDER'), (3, 'TANJUNGHARJO'), (9, 'SURABAYA');
        INSERT INTO cameras (id, name, area_id) VALUES
            (11, 'CCTV LAPANGAN DANDER', 2),
            (12, 'CCTV BALAI TANJUNGHARJO', 3),
            (99, 'CCTV SURABAYA', 9);
    `);
}

/** Create a banner that is renderable (has an image) unless told otherwise. */
function makeBanner(overrides = {}) {
    const promo = createPromoBanner({
        title: 'Pemasangan Gratis',
        placements: ['popup'],
        ...overrides,
    });
    if (overrides.image_base !== null) {
        db.prepare('UPDATE promo_banners SET image_base = ? WHERE id = ?')
            .run(overrides.image_base || `promo-${'a'.repeat(12)}${promo.id}`, promo.id);
    }
    return promo;
}

beforeEach(() => {
    resetSchema();
});

describe('resolvePromoBannerForContext — targeting', () => {
    it('serves an "all" banner to any camera', () => {
        makeBanner({ target_mode: 'all' });
        expect(resolvePromoBannerForContext({ cameraId: 99, placement: 'popup' })).toMatchObject({
            title: 'Pemasangan Gratis',
        });
    });

    it('serves an area banner only to cameras inside that area', () => {
        makeBanner({ title: 'Promo Dander', target_mode: 'area', area_ids: [2, 3] });

        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' })).toMatchObject({ title: 'Promo Dander' });
        expect(resolvePromoBannerForContext({ cameraId: 12, placement: 'popup' })).toMatchObject({ title: 'Promo Dander' });
        // Surabaya is outside the coverage area — it must get nothing.
        expect(resolvePromoBannerForContext({ cameraId: 99, placement: 'popup' })).toBeNull();
    });

    it('serves a camera banner only to that camera', () => {
        makeBanner({ title: 'Khusus Lapangan', target_mode: 'camera', camera_ids: [11] });

        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' })).toMatchObject({ title: 'Khusus Lapangan' });
        expect(resolvePromoBannerForContext({ cameraId: 12, placement: 'popup' })).toBeNull();
    });

    it('prefers the most specific banner: camera beats area beats all', () => {
        makeBanner({ title: 'Semua', target_mode: 'all', priority: 1 });
        // Covers both coverage areas, so camera 12 (area 3) is an area-only match
        // while camera 11 (area 2) also has a camera-level banner competing for it.
        makeBanner({ title: 'Area', target_mode: 'area', area_ids: [2, 3], priority: 1 });
        makeBanner({ title: 'Kamera', target_mode: 'camera', camera_ids: [11], priority: 500 });

        // Priority 500 still wins over priority 1, because specificity is the outer sort.
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' }).title).toBe('Kamera');
        expect(resolvePromoBannerForContext({ cameraId: 12, placement: 'popup' }).title).toBe('Area');
        // Area 9 is outside the coverage areas, so only the catch-all remains.
        expect(resolvePromoBannerForContext({ cameraId: 99, placement: 'popup' }).title).toBe('Semua');
    });

    it('breaks specificity ties on priority, lower number first', () => {
        makeBanner({ title: 'Kedua', target_mode: 'all', priority: 50 });
        makeBanner({ title: 'Pertama', target_mode: 'all', priority: 10 });
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' }).title).toBe('Pertama');
    });

    it('resolves by areaId when no camera is in context (area landing page)', () => {
        makeBanner({ title: 'Area', target_mode: 'area', area_ids: [2], placements: ['area'] });
        expect(resolvePromoBannerForContext({ areaId: 2, placement: 'area' })).toMatchObject({ title: 'Area' });
        expect(resolvePromoBannerForContext({ areaId: 9, placement: 'area' })).toBeNull();
    });

    it('falls back to an "all" banner when the camera id is unknown', () => {
        // Same response shape for a real and a bogus camera id, so the endpoint
        // cannot be used to test whether a camera exists.
        makeBanner({ target_mode: 'all' });
        expect(resolvePromoBannerForContext({ cameraId: 424242, placement: 'popup' })).not.toBeNull();
    });
});

describe('resolvePromoBannerForContext — eligibility', () => {
    it('skips inactive banners', () => {
        makeBanner({ active: false });
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' })).toBeNull();
    });

    it('skips banners with no uploaded image', () => {
        makeBanner({ image_base: null });
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' })).toBeNull();
    });

    it('honours the schedule window on both ends', () => {
        makeBanner({ title: 'Belum mulai', start_date: '2026-09-01' });
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' })).toBeNull();

        resetSchema();
        makeBanner({ title: 'Sudah lewat', end_date: '2026-08-11' });
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' })).toBeNull();

        resetSchema();
        makeBanner({ title: 'Sedang jalan', start_date: '2026-08-12', end_date: '2026-08-12' });
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' })).toMatchObject({ title: 'Sedang jalan' });
    });

    it('only matches the requested placement', () => {
        makeBanner({ placements: ['landing', 'playback'] });
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' })).toBeNull();
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'landing' })).not.toBeNull();
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'playback' })).not.toBeNull();
    });

    it('rejects an unknown placement outright', () => {
        makeBanner({ placements: ['popup'] });
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'nonsense' })).toBeNull();
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: '' })).toBeNull();
    });

    it('never leaks admin-only fields to the public shape', () => {
        makeBanner({ whatsapp_number: '081234', priority: 3, end_date: '2026-12-31' });
        const promo = resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' });
        for (const secret of ['whatsapp_number', 'whatsapp_message', 'priority', 'end_date', 'start_date', 'target_mode', 'placements', 'active']) {
            expect(promo).not.toHaveProperty(secret);
        }
    });
});

describe('buildWhatsAppUrl', () => {
    it('converts a local 08xx number to international 62 form', () => {
        expect(buildWhatsAppUrl({ whatsapp_number: '081234567890' })).toContain('https://wa.me/6281234567890?');
    });

    it('leaves an already-international number alone and strips punctuation', () => {
        expect(buildWhatsAppUrl({ whatsapp_number: '+62 812-3456-7890' })).toContain('https://wa.me/6281234567890?');
    });

    it('substitutes camera and area placeholders into the message', () => {
        const url = buildWhatsAppUrl(
            { whatsapp_number: '0812', whatsapp_message: 'Pasang CCTV di {area} dekat {kamera}' },
            { cameraName: 'LAPANGAN', areaName: 'DANDER' }
        );
        expect(decodeURIComponent(url.split('text=')[1])).toBe('Pasang CCTV di DANDER dekat LAPANGAN');
    });

    it('returns null without a number so the caller can fall back to cta_url', () => {
        expect(buildWhatsAppUrl({ whatsapp_number: null })).toBeNull();
        expect(buildWhatsAppUrl({ whatsapp_number: 'abc' })).toBeNull();
    });

    it('prefers the WhatsApp link over a plain cta_url when both are set', () => {
        makeBanner({ whatsapp_number: '081234567890', cta_url: 'https://example.com' });
        expect(resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' }).cta_url).toContain('wa.me');
    });
});

describe('validation helpers', () => {
    it('rejects an empty or unknown placement list', () => {
        expect(() => normalizePlacements([])).toThrow(/minimal satu/i);
        expect(() => normalizePlacements(['bogus'])).toThrow(/minimal satu/i);
    });

    it('dedupes and filters placements', () => {
        expect(normalizePlacements(['popup', 'popup', 'bogus', 'landing'])).toEqual(['popup', 'landing']);
    });

    it('rejects an unknown target mode', () => {
        expect(() => normalizeTargetMode('everyone')).toThrow(/target_mode/);
        expect(normalizeTargetMode('area')).toBe('area');
    });

    it('requires a title', () => {
        expect(() => createPromoBanner({ title: '   ' })).toThrow(/Judul/i);
    });
});

describe('targeting writes', () => {
    it('replaces targets wholesale rather than accumulating them', () => {
        const promo = makeBanner({ target_mode: 'area', area_ids: [2, 3] });
        setPromoBannerTargets(promo.id, { area_ids: [9], camera_ids: [] });

        const [row] = listPromoBanners();
        expect(row.area_ids).toEqual([9]);
    });

    it('keeps untouched target types when updating only one of them', () => {
        const promo = makeBanner({ target_mode: 'area', area_ids: [2], camera_ids: [11] });
        updatePromoBanner(promo.id, { area_ids: [3] });

        const row = listPromoBanners()[0];
        expect(row.area_ids).toEqual([3]);
        expect(row.camera_ids).toEqual([11]);
    });

    it('drops targeting rows when the banner is deleted', () => {
        const promo = makeBanner({ target_mode: 'area', area_ids: [2] });
        deletePromoBanner(promo.id);
        expect(db.prepare('SELECT COUNT(*) AS n FROM promo_banner_targets').get().n).toBe(0);
        expect(listPromoBanners()).toEqual([]);
    });
});

describe('schedule state is decided server-side', () => {
    /*
     * The admin panel used to recompute this from the browser clock in UTC while
     * the resolver used the app's LOCAL date, so for the first 7 hours of every
     * WIB day an already-expired banner was still labelled "Tayang".
     */
    it.each([
        ['live', {}],
        ['inactive', { active: false }],
        ['not_started', { start_date: '2026-09-01' }],
        ['expired', { end_date: '2026-08-11' }],
    ])('reports %s', (expected, overrides) => {
        makeBanner(overrides);
        const [row] = listPromoBanners();
        expect(row.schedule_state).toBe(expected);
        expect(row.is_live).toBe(expected === 'live' ? 1 : 0);
    });

    it('reports no_image for a banner that has never had a poster', () => {
        makeBanner({ image_base: null });
        const [row] = listPromoBanners();
        expect(row.schedule_state).toBe('no_image');
        expect(row.is_live).toBe(0);
    });

    it('agrees with what the public resolver actually serves', () => {
        // The chip and the visitor must never disagree.
        for (const overrides of [{}, { active: false }, { start_date: '2026-09-01' }, { end_date: '2026-08-11' }, { image_base: null }]) {
            resetSchema();
            makeBanner(overrides);
            const [row] = listPromoBanners();
            const served = resolvePromoBannerForContext({ cameraId: 11, placement: 'popup' }) !== null;
            expect(Boolean(row.is_live), JSON.stringify(overrides)).toBe(served);
        }
    });

    it('treats the last day of the window as still live', () => {
        makeBanner({ start_date: '2026-08-12', end_date: '2026-08-12' });
        expect(listPromoBanners()[0].schedule_state).toBe('live');
    });
});

describe('stats', () => {
    it('accumulates impressions and clicks into one row per day', () => {
        const promo = makeBanner();
        recordImpression(promo.id);
        recordImpression(promo.id);
        recordClick(promo.id);

        expect(getPromoBannerStats(promo.id)).toEqual([
            { stat_date: '2026-08-12', impressions: 2, clicks: 1 },
        ]);
    });

    it('exposes running totals on the admin list', () => {
        const promo = makeBanner();
        recordImpression(promo.id);
        recordClick(promo.id);
        expect(listPromoBanners()[0]).toMatchObject({ total_impressions: 1, total_clicks: 1 });
    });

    it('ignores events for a banner that does not exist', () => {
        // A public click endpoint takes its id from the URL, so a bogus id must not
        // be able to create stat rows for a banner that was never configured.
        expect(recordClick(4242)).toBe(false);
        expect(db.prepare('SELECT COUNT(*) AS n FROM promo_banner_stats').get().n).toBe(0);
    });

    it('ignores a non-integer id', () => {
        expect(recordClick(null)).toBe(false);
        expect(recordImpression('1; DROP TABLE promo_banners')).toBe(false);
    });
});
