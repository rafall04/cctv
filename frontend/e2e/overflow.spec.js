/*
 * Purpose: Real-browser smoke asserting the one invariant jsdom can never check — no public page overflows horizontally on a phone.
 * Caller: playwright.config.js (npm run test:e2e; e2e job in CI).
 * Deps: @playwright/test, built dist served by vite preview; all /api/* calls are mocked, all external hosts blocked.
 * MainFuncs: overflow assertions per public page, at normal and Android-large font scale.
 * SideEffects: None outside the test browser.
 */

import { test, expect } from '@playwright/test';

const PAGES = [
    ['landing (default)', '/'],
    ['landing simple', '/?mode=simple'],
    ['landing full', '/?mode=full'],
    ['public playback', '/playback'],
    ['login', '/login'],
];

test.beforeEach(async ({ page, context }) => {
    // Deterministic and offline-safe: every API call answers with an empty success
    // payload (the UI must degrade cleanly), and every non-local request — ads, map
    // tiles, fonts — is blocked. This also proves the page works with ads absent;
    // ad iframes wider than the screen are what the viewport guards exist for.
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        if (!local) return route.abort();
        if (url.pathname.startsWith('/api/')) {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: [] }),
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
        rootOverflowX: getComputedStyle(de).overflowX,
    };
};

for (const [name, url] of PAGES) {
    test(`no horizontal overflow: ${name}`, async ({ page }) => {
        await page.goto(url, { waitUntil: 'networkidle' });
        // Let deferred mounts (lite-mode staggering, lazy chunks) settle.
        await page.waitForTimeout(800);

        const m = await page.evaluate(measure);
        expect(m.rootOverflowX, 'html must keep overflow-x: clip').toBe('clip');
        expect(m.bodyScrollW, `${name}: body scrollWidth ${m.bodyScrollW}px > viewport ${m.vw}px`).toBeLessThanOrEqual(m.vw + 1);
        expect(m.inflow, `${name}: an unclipped in-flow element reaches ${m.inflow}px on a ${m.vw}px viewport`).toBeLessThanOrEqual(m.vw + 1);
        expect(m.fixed, `${name}: a fixed element reaches ${m.fixed}px on a ${m.vw}px viewport`).toBeLessThanOrEqual(m.vw + 1);

        // Android "large text" (~1.5x): the exact setting that widened the view-mode
        // toggle row past the viewport before it got min-w-0 + truncate.
        await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
        await page.waitForTimeout(300);
        const scaled = await page.evaluate(measure);
        expect(scaled.inflow, `${name} @1.5x font: in-flow element reaches ${scaled.inflow}px on ${scaled.vw}px`).toBeLessThanOrEqual(scaled.vw + 1);
        expect(scaled.fixed, `${name} @1.5x font: fixed element reaches ${scaled.fixed}px on ${scaled.vw}px`).toBeLessThanOrEqual(scaled.vw + 1);
    });
}
