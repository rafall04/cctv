/*
 * Purpose: Real-browser smoke asserting the one invariant jsdom can never check — no public page overflows horizontally on a phone.
 * Caller: playwright.config.js (npm run test:e2e; e2e job in CI).
 * Deps: @playwright/test, built dist served by vite preview; all /api/* calls are mocked, all external hosts blocked.
 * MainFuncs: overflow assertions per public page, at normal and Android-large font scale.
 * SideEffects: None outside the test browser.
 */

import { test, expect } from '@playwright/test';

/* `expectStrip` marks the pages that must render the horizontal discovery strip. Without that
 * assertion this suite could pass by rendering nothing — which is exactly how it missed the 2026-08
 * bug: every API was mocked empty, so the strip returned null and its overflow was never measured. */
const PAGES = [
    ['landing (default)', '/', { expectStrip: true }],
    ['landing simple', '/?mode=simple', { expectStrip: true }],
    ['landing full', '/?mode=full', { expectStrip: true }],
    ['landing map view', '/?view=map&mode=full', {}],
    ['landing grid view', '/?view=grid&mode=full', {}],
    ['landing playback view', '/?view=playback&mode=full', {}],
    ['public playback', '/playback', {}],
    ['login', '/login', {}],
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
}));

const AREAS = [
    { id: 1, name: 'KAB MAGETAN', slug: 'kab-magetan', camera_count: 4, total_views: 400 },
    { id: 2, name: 'KEC BOJONEGORO DAN SEKITARNYA', slug: 'kec-bojonegoro', camera_count: 4, total_views: 500 },
];

const API_FIXTURES = [
    [/\/api\/public\/discovery/, { live_now: CAMERAS, top_cameras: CAMERAS, popular_areas: AREAS, new_cameras: CAMERAS }],
    [/\/api\/cameras\/active/, CAMERAS],
    [/\/api\/cameras\/public/, CAMERAS],
    [/\/api\/areas\/public/, AREAS],
];

test.beforeEach(async ({ page, context }) => {
    // Deterministic and offline-safe: known payloads for the endpoints that feed the strips, empty
    // success for everything else (the UI must degrade cleanly), and every non-local request — ads,
    // map tiles, fonts — blocked. This also proves the page works with ads absent; ad iframes wider
    // than the screen are what the viewport guards exist for.
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        if (!local) return route.abort();
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

for (const [name, url, options = {}] of PAGES) {
    test(`no horizontal overflow: ${name}`, async ({ page }) => {
        await page.goto(url, { waitUntil: 'networkidle' });
        // Let deferred mounts (lite-mode staggering, lazy chunks) settle.
        await page.waitForTimeout(800);

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
