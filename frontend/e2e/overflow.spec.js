/*
 * Purpose: Real-browser smoke asserting the one invariant jsdom can never check — no public page overflows horizontally on a phone.
 * Caller: playwright.config.js (npm run test:e2e; e2e job in CI).
 * Deps: @playwright/test, built dist served by vite preview; all /api/* calls are mocked, all external hosts blocked.
 * MainFuncs: overflow assertions per public page, at normal and Android-large font scale.
 * SideEffects: None outside the test browser.
 */

import { test, expect } from '@playwright/test';

/* `expectStrip` marks the pages that must render the horizontal discovery strip. `expectAffiliate`
 * names the surface whose affiliate ("Toko rekanan") block must be on screen. Without those
 * assertions this suite could pass by rendering nothing — which is exactly how it missed the
 * 2026-08 bug: every API was mocked empty, so the strip returned null and its overflow was never
 * measured. The affiliate block arrived on three of these pages on 2026-08-23 and would have
 * repeated that history exactly: no fixture, no card, nine green tests measuring a page the new
 * block was absent from. */
const PAGES = [
    ['landing (default)', '/', { expectStrip: true, expectAffiliate: 'landing' }],
    ['landing simple', '/?mode=simple', { expectStrip: true, expectAffiliate: 'landing' }],
    ['landing full', '/?mode=full', { expectStrip: true, expectAffiliate: 'landing' }],
    ['landing map view', '/?view=map&mode=full', {}],
    ['landing grid view', '/?view=grid&mode=full', {}],
    ['landing playback view', '/?view=playback&mode=full', {}],
    /* The area page was never in this list at all, so the whole public surface went unmeasured
       until the affiliate block landed on it. Slug must match AREAS[0] below — the page 404s on
       anything else and would then measure an error state. */
    ['area page', '/area/kab-magetan', { expectAffiliate: 'area' }],
    ['public playback', '/playback', { expectAffiliate: 'playback' }],
    /* `/admin/login`, not `/login` — the latter is not a route. It fell through the SPA catch-all
       to the landing page, so this entry has been measuring `/?mode=simple&view=grid` (verified:
       that is the URL it lands on, with zero password inputs) and the login form itself has never
       been measured by this suite or the admin one. */
    ['login', '/admin/login', {}],
    /* Trailing slash on purpose. /sewa is static HTML in frontend/public/sewa/, and only the
       directory form resolves to it under `vite preview`; without the slash the dev server falls
       through to the SPA and this would silently test the wrong page. */
    ['sewa (sales page)', '/sewa/', {}],
];

/*
 * Real-shaped payloads, not empty ones.
 *
 * The strips only exist when there is something to put in them, and a strip full of cards is the
 * single most likely thing to widen the document. Names are deliberately long — truncation is part
 * of what keeps them inside the viewport.
 */
const CAMERAS = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    name: `SIMPANG 4 NAMA KAMERA YANG SENGAJA PANJANG ${i + 1}`,
    location: `JL. LOKASI YANG JUGA PANJANG SEKALI NOMOR ${i + 1}`,
    area_id: (i % 2) + 1,
    area_name: i % 2 ? 'KEC BOJONEGORO DAN SEKITARNYA' : 'KAB MAGETAN',
    status: 'active',
    enabled: 1,
    is_online: 1,
    live_viewers: i + 1,
    total_views: 100 + i,
    /*
     * Without this the /playback test measured a THREE-LINE ERROR PAGE and always had.
     *
     * Playback keeps only `cam.enable_recording` cameras and early-returns "Belum Ada Recording
     * Tersedia" when none survive, so every block that page is made of — header, player, stepper,
     * timeline, segment list, options, token access, usage guide, and now the affiliate slot — has
     * never once been on screen while this suite ran. The test passed for eight of them by never
     * rendering any of them.
     */
    enable_recording: 1,
}));

/*
 * Ten-minute segments ending now, generated at run time rather than hard-coded.
 *
 * The timeline and the segment list are laid out FROM these — no segments means both render their
 * empty state, which is the same vacuum as above one level down. Dates are relative because a
 * frozen date would drift out of whatever window the page asks for and quietly empty the list again
 * months from now; that is precisely how a fixture stops testing anything without ever going red.
 */
const SEGMENTS = Array.from({ length: 12 }, (_, i) => {
    const end = new Date(Date.now() - i * 10 * 60 * 1000);
    const start = new Date(end.getTime() - 10 * 60 * 1000);
    return {
        id: 900 + i,
        camera_id: 1,
        filename: `camera1_${start.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}.mp4`,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration: 600,
        file_size: 128 * 1024 * 1024,
        status: 'ok',
    };
});

const AREAS = [
    { id: 1, name: 'KAB MAGETAN', slug: 'kab-magetan', camera_count: 4, total_views: 400 },
    { id: 2, name: 'KEC BOJONEGORO DAN SEKITARNYA', slug: 'kec-bojonegoro', camera_count: 4, total_views: 500 },
];

/*
 * The /sewa page reads its price table from this endpoint at runtime. Same reasoning as CAMERAS
 * above: served an empty list it renders an empty table, and the wide multi-column price grid —
 * the part of that page most likely to overflow a phone — would never be measured at all.
 */
const PLANS = [
    { key: 'trial', name: 'Trial Gratis', description: 'Coba gratis sebelum berlangganan', price_per_camera: 0, recording_price_per_camera: 0, recording_retention_days: 0, max_cameras: 1, is_trial: true, trial_days: 3 },
    { key: 'basic', name: 'Basic', description: '1 kamera, cocok untuk rumah', price_per_camera: 15000, recording_price_per_camera: 10000, recording_retention_days: 0, max_cameras: 1, is_trial: false, trial_days: null },
    { key: 'hemat', name: 'Hemat', description: 'Sampai 3 kamera, lebih murah per kamera', price_per_camera: 12000, recording_price_per_camera: 8000, recording_retention_days: 0, max_cameras: 3, is_trial: false, trial_days: null },
    { key: 'bisnis', name: 'BISNIS DENGAN NAMA PAKET YANG SENGAJA DIBUAT PANJANG', description: 'Sampai 10 kamera, harga terbaik per kamera', price_per_camera: 10000, recording_price_per_camera: 5000, recording_retention_days: 30, max_cameras: 10, is_trial: false, trial_days: null },
];

/*
 * The affiliate ("Toko rekanan") offer — WORST CASE, deliberately, not a plausible one.
 *
 * The block landed on four surfaces on 2026-08-23; the three public ones (landing, area, playback)
 * are measured here. Before this fixture existed the endpoint fell through to the empty default,
 * `sanitizePublicOffer` returned null, and the card never mounted — so every assertion below ran against
 * a page the new block was absent from. Green, and proving nothing about it. Same vacuity that let
 * the 2026-08 strip bug through.
 *
 * Every field here is present because removing it makes the card NARROWER, and a card that cannot
 * overflow anything is not worth measuring:
 *   · title carries an unbroken model-number run — `min-w-0` + `truncate` on the title line is the
 *     only thing between that and a wider card, and an unbreakable token is what defeats wrapping;
 *   · store_name rides the disclosure row beside the "TOKO REKANAN" label (capped at 60%);
 *   · price_rupiah is `shrink-0` and never yields space to the title — INTEGER rupiah, as everywhere;
 *   · whatsapp_url AND a direct product_url are what put the action row at its widest: CTA +
 *     "Tanya" + two 44px icon buttons, four controls on one line at 1× and wrapping at 1.5×.
 *     Drop product_url and the two icon buttons vanish — a third of the row stops being measured;
 *   · image_base adds the 80px fixed thumbnail box beside all of it.
 * The description is long enough that its two-line clamp is exercised rather than assumed.
 */
const AFFILIATE_OFFER = {
    id: 4242,
    product_title: 'KAMERA CCTV OUTDOOR 5MP COLORVU DENGAN NAMA BARANG YANG SENGAJA PANJANG DS-2CD1153G0-IUF-2.8MM-REV4',
    description: 'Tahan hujan, night vision warna, audio dua arah, sudah termasuk adaptor dan bracket — deskripsi ini sengaja panjang supaya klem dua barisnya benar-benar terukur.',
    store_name: 'TOKO ELEKTRONIK SUMBER REJEKI ABADI JAYA MAKMUR SENTOSA',
    product_url: 'https://toko-rekanan.example/produk/kamera-cctv-outdoor-5mp-colorvu-nama-panjang',
    store_url: 'https://toko-rekanan.example/toko/sumber-rejeki-abadi-jaya-makmur',
    product_href: '/api/public/affiliate/offers/4242/go?l=p',
    store_href: '/api/public/affiliate/offers/4242/go?l=s',
    whatsapp_url: 'https://wa.me/6281234567890?text=Halo%2C%20saya%20mau%20tanya%20barang%20ini',
    price_rupiah: 1250000,
    image_base: 'e2e-affiliate-worst-case',
    image_width: 800,
    image_height: 800,
};

/* The area page reads its own detail endpoint, not the list one. Same object shape as AREAS[0]
   plus the fields the header renders. */
const AREA_DETAIL = { ...AREAS[0], description: 'AREA DENGAN NAMA DAN DESKRIPSI YANG SENGAJA PANJANG UNTUK MENGUJI HEADER', city: 'KAB MAGETAN' };

const API_FIXTURES = [
    [/\/api\/public\/billing\/plans/, PLANS],
    [/\/api\/public\/discovery/, { live_now: CAMERAS, top_cameras: CAMERAS, popular_areas: AREAS, new_cameras: CAMERAS }],
    /* The arbiter, not the affiliate endpoint. Since 2026-08-27 one slot has ONE occupant and
       the server picks it, so this is the only route a public surface asks for a commercial
       block — mocking the old per-system endpoint would leave every card unmounted. */
    [/^\/api\/public\/slot$/, { kind: 'affiliate', content: AFFILIATE_OFFER }],
    [/^\/api\/recordings\/\d+\/segments$/, { segments: SEGMENTS, playback_policy: null, coverage: null }],
    [/^\/api\/public\/areas\/[^/]+\/cameras$/, CAMERAS],
    [/^\/api\/public\/areas\/[^/]+$/, AREA_DETAIL],
    [/\/api\/public\/trending-cameras/, CAMERAS],
    [/\/api\/cameras\/active/, CAMERAS],
    [/\/api\/cameras\/public/, CAMERAS],
    [/\/api\/areas\/public/, AREAS],
];

/* A stand-in for the product photo. The real one is a same-origin `/api/affiliate-media/…` path, so
   without this branch it would be answered with JSON and render as a BROKEN image — whose alt text
   is the deliberately long title above, laid out under rules the real photo never obeys. Measuring
   that would be measuring the fixture rather than the card.
   SVG rather than a base64 PNG so this stays a plain string: `Buffer` is a Node global that the
   browser-facing ESLint config does not define, and a lint error in the guard file is not a trade
   worth making for one pixel. Deliberately SQUARE and oversized — 800×800 is the shape an operator
   actually uploads, and the card's fixed 64/80px box is what has to survive it. */
const PHOTO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#556677"/></svg>';

/* Query strings of every affiliate resolve this page fired, in order. The landing assertion below
   reads them: the "landing has no camera context" rule is enforced by the CALLER passing no
   cameraId, and nothing else — the mock cannot enforce it, and a browser test is the only place
   that sees what the mount actually asked for. */
let slotResolveQueries = [];

test.beforeEach(async ({ page, context }) => {
    // Deterministic and offline-safe: known payloads for the endpoints that feed the strips, empty
    // success for everything else (the UI must degrade cleanly), and every non-local request — ads,
    // map tiles, fonts — blocked. This also proves the page works with ads absent; ad iframes wider
    // than the screen are what the viewport guards exist for.
    slotResolveQueries = [];
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        if (!local) return route.abort();
        if (url.pathname.startsWith('/api/affiliate-media/')) {
            return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PHOTO_SVG });
        }
        if (url.pathname === '/api/public/slot') {
            slotResolveQueries.push(url.searchParams);
        }
        if (url.pathname.startsWith('/api/')) {
            const fixture = API_FIXTURES.find(([pattern]) => pattern.test(url.pathname));
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: fixture ? fixture[1] : [] }),
            });
        }
        return route.continue();
    });
    // Deterministic paint: the app already honours reduced motion everywhere.
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

/*
 * The real invariant, measured the way the 2026-07 zoom-out incident taught us:
 * `scrollWidth` alone is not trustworthy under `overflow-x: clip`, so we take the
 * maximum RIGHT EDGE of (a) every unclipped in-flow element and (b) every
 * position:fixed element (fixed boxes escape the root clip guard — that is exactly
 * how the FeedbackWidget bug shipped).
 */
const measure = () => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const isClipped = (el) => {
        let p = el.parentElement;
        while (p && p !== de) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true;
            p = p.parentElement;
        }
        return false;
    };
    let inflow = 0;
    let fixed = 0;
    for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (getComputedStyle(el).position === 'fixed') {
            fixed = Math.max(fixed, r.right);
            continue;
        }
        if (!isClipped(el)) inflow = Math.max(inflow, r.right);
    }
    return {
        vw,
        inflow: Math.round(inflow),
        fixed: Math.round(fixed),
        bodyScrollW: document.body.scrollWidth,
        /*
         * The one the other three cannot see.
         *
         * A horizontal strip's content reaches the DOCUMENT's scrollable rect even when every
         * ancestor clips it: in the 2026-08 incident the strip measured 1768px while its parent,
         * its section, and body all correctly reported 393px — and documentElement still said 1514.
         * `inflow` skipped it (it has a clipping ancestor), `fixed` skipped it (it is static), and
         * `bodyScrollW` was clean. Mobile browsers that fit the page to the document width zoomed
         * to 393/1514 = 26%, so the site rendered as a squeezed left-hand column with black beside
         * it. This number is the only one that saw the bug.
         */
        rootScrollW: de.scrollWidth,
        rootOverflowX: getComputedStyle(de).overflowX,
    };
};

/*
 * Walk the page top to bottom, then return to the top.
 *
 * Not cosmetic. The affiliate slot fires its resolve from an IntersectionObserver with a 200px
 * rootMargin, and on the playback and area pages it sits near the BOTTOM of a long document — a
 * test that only ever looks at the first screen would find the slot present, empty, and forever
 * unresolved, and would call that a rendered block. Scrolling is what a visitor does and what the
 * observer is waiting for. Coming back to the top means the measurement below still happens in the
 * position the previous version of this suite measured, so nothing already covered changed meaning.
 *
 * `scrollHeight` is re-read every step on purpose: lazy mounts make the document grow while we walk
 * it. The step cap is what stops a page that grows forever from hanging the run.
 */
const scrollThroughPage = async (page) => {
    await page.evaluate(async () => {
        const step = Math.max(200, Math.round(window.innerHeight * 0.8));
        for (let i = 0, y = 0; i < 40 && y < document.documentElement.scrollHeight; i += 1, y += step) {
            window.scrollTo(0, y);
            await new Promise((resolve) => { setTimeout(resolve, 120); });
        }
        window.scrollTo(0, 0);
    });
    await page.waitForTimeout(400);
};

/*
 * Anti-vacuity for the affiliate block, and the reason it asserts on the CARD rather than the slot.
 *
 * `<CommercialSlot>` renders its wrapper div unconditionally — an empty slot is the normal case
 * on most cameras, and the wrapper is what the IntersectionObserver observes. So
 * `[data-testid="commercial-slot"]` is present whether or not an occupant resolved, and asserting
 * on it would be precisely the test that measures nothing while looking green. The card only exists
 * when a payload survived resolution, so that is the thing to demand. The price is asserted too:
 * it is the one element that is `shrink-0` and therefore the one most able to widen the row.
 */
async function expectAffiliateBlock(page, name, surface) {
    const slot = page.locator(`[data-testid="commercial-slot"][data-placement="${surface}"]`);
    await expect(
        slot,
        `${name}: no commercial slot for placement="${surface}" — the mount is gone, or it is naming a different surface`,
    ).toHaveCount(1);
    await expect(
        slot.locator('[data-testid="affiliate-offer-card"]'),
        `${name}: the affiliate card did not render on placement="${surface}", so this run measured a page without it`,
    ).toHaveCount(1);
    await expect(
        slot.locator('[data-testid="affiliate-offer-price"]'),
        `${name}: the affiliate card rendered without its price, the widest shrink-0 element on the row`,
    ).toHaveCount(1);
}

for (const [name, url, options = {}] of PAGES) {
    test(`no horizontal overflow: ${name}`, async ({ page }) => {
        await page.goto(url, { waitUntil: 'networkidle' });
        // Let deferred mounts (lite-mode staggering, lazy chunks) settle.
        await page.waitForTimeout(800);
        await scrollThroughPage(page);

        if (options.expectAffiliate) {
            await expectAffiliateBlock(page, name, options.expectAffiliate);

            const asked = slotResolveQueries.filter((q) => q.get('placement') === options.expectAffiliate);
            expect(
                asked.length,
                `${name}: nothing ever asked the backend for a "${options.expectAffiliate}" offer, so the count `
                + 'for this surface would stay at zero however many visitors saw the block',
            ).toBeGreaterThan(0);

            if (options.expectAffiliate === 'landing') {
                /*
                 * The home page is about no camera and no area, so an offer bought for camera 12 —
                 * "this shop is near camera 12" — must never surface here. That rule is enforced in
                 * exactly one place: the landing mount passing neither id. The backend resolver
                 * happily honours a cameraId sent alongside placement=landing (verified directly
                 * against it), so if a "featured camera" is ever threaded into this mount, the leak
                 * is silent and this is the assertion that catches it.
                 */
                const leaked = asked.filter((q) => q.get('cameraId') || q.get('areaId')).map((q) => q.toString());
                expect(
                    leaked,
                    `${name}: a landing resolve carried a camera/area context (${leaked.join(' | ')}). The home `
                    + 'page has none, and the resolver will match a camera-targeted offer when it is given one.',
                ).toEqual([]);
            }
        }

        if (options.expectStrip) {
            // Anti-vacuity: the strip is the widest thing on the page, so a run without it proves
            // nothing. This is the assertion whose absence let the 2026-08 bug through.
            await expect(
                page.locator('[data-testid="landing-discovery-strip-list"]'),
                `${name}: the discovery strip did not render, so this run measured nothing`,
            ).toHaveCount(1);
        }

        const m = await page.evaluate(measure);
        expect(m.rootOverflowX, 'html must keep overflow-x: clip').toBe('clip');
        expect(m.bodyScrollW, `${name}: body scrollWidth ${m.bodyScrollW}px > viewport ${m.vw}px`).toBeLessThanOrEqual(m.vw + 1);
        expect(
            m.rootScrollW,
            `${name}: the DOCUMENT is ${m.rootScrollW}px wide on a ${m.vw}px viewport. A mobile browser `
            + `will zoom the whole page out to ${Math.round((m.vw / m.rootScrollW) * 100)}% to fit it. `
            + 'Usually a horizontal strip missing [contain:paint] — see LandingDiscoveryStrip.',
        ).toBeLessThanOrEqual(m.vw + 1);
        expect(m.inflow, `${name}: an unclipped in-flow element reaches ${m.inflow}px on a ${m.vw}px viewport`).toBeLessThanOrEqual(m.vw + 1);
        expect(m.fixed, `${name}: a fixed element reaches ${m.fixed}px on a ${m.vw}px viewport`).toBeLessThanOrEqual(m.vw + 1);

        // Android "large text" (~1.5x): the exact setting that widened the view-mode
        // toggle row past the viewport before it got min-w-0 + truncate.
        await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
        await page.waitForTimeout(300);
        const scaled = await page.evaluate(measure);
        expect(scaled.inflow, `${name} @1.5x font: in-flow element reaches ${scaled.inflow}px on ${scaled.vw}px`).toBeLessThanOrEqual(scaled.vw + 1);
        expect(scaled.fixed, `${name} @1.5x font: fixed element reaches ${scaled.fixed}px on ${scaled.vw}px`).toBeLessThanOrEqual(scaled.vw + 1);
        expect(scaled.rootScrollW, `${name} @1.5x font: document is ${scaled.rootScrollW}px on ${scaled.vw}px`).toBeLessThanOrEqual(scaled.vw + 1);
    });
}
