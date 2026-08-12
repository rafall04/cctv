/*
 * Purpose: Catch unreadable text on the public surfaces by measuring REAL rendered contrast.
 * Caller: `npm run test:e2e` locally and the e2e job in CI.
 * Deps: @playwright/test, a completed `npm run build`.
 *
 * WHY THIS CANNOT BE A UNIT TEST
 * Contrast is a property of the rendered page, not of source text. It depends on which ancestor
 * actually paints a background, which theme is active, and what the cascade resolved every custom
 * property to. jsdom computes none of that. A lint rule like "every bg-* needs a text-*" would be
 * pure guesswork — full of false positives, and blind to the real failure, which is a colour PAIR.
 *
 * THE BUG THIS EXISTS FOR
 * `body` themed its background but not its foreground, so text fell back to the browser default
 * black. Everything that named its own colour was fine; the one <code> that did not rendered
 * #000 on #08090b — contrast 1.05, invisible. It survived months of review because reading the
 * source never reveals it.
 *
 * HOW IT GATES (same idiom as the file-size ratchet)
 *  - INVISIBLE_FLOOR is absolute. Nothing may sit below it, known pair or not — that is the
 *    black-on-black class, always a defect.
 *  - Below AA, a colour PAIR must be listed in TOLERATED with a reason. New pairs fail. Keying on
 *    the pair rather than on a selector keeps the baseline stable while components move around,
 *    and makes each entry a decision someone wrote down rather than a silent exception.
 */

import { test, expect } from '@playwright/test';

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;
/* Below this a human cannot read the text at all. No exception is ever legitimate. */
const INVISIBLE_FLOOR = 2.0;

/**
 * Pairs already below AA when this guard was written. Each is a deliberate, recorded decision —
 * NOT a licence to add more. Shrinking this map is always welcome; growing it needs a reason here.
 */
const TOLERATED = new Map([
    ['rgb(255, 255, 255) on rgb(14, 165, 233)',
        'White on brand primary = 2.77. Changing it repaints every button in the product, so it is a '
        + 'brand decision rather than a bug fix. Readable in practice; fails AA for normal text.'],
    ['rgb(90, 98, 109) on rgb(11, 13, 15)',
        'Mobile dock labels = 3.15. The dock still uses the deprecated grey ramp instead of semantic '
        + 'content tokens; fixing it belongs with that migration.'],
]);

/*
 * Same offline mocking as overflow.spec.js: every /api/* answers empty-success and every external
 * host is blocked, so the run is deterministic and needs no backend. Pages therefore render their
 * CHROME rather than real data — which is exactly the surface this audit is about, since chrome is
 * where fixed colours live.
 */
test.beforeEach(async ({ page, context }) => {
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
    /*
     * Both dark switches, not just one. The app reads a `dark` class; /sewa/ is standalone HTML
     * that only honours prefers-color-scheme. Emulating the class alone audited /sewa/ in its LIGHT
     * theme while the test name promised dark — which is how its light palette shipped with
     * sub-4.5:1 body text nobody had measured.
     */
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
});

/* [path, minimum text nodes expected] — the floor guards against a page that failed to render at
 * all, which would otherwise let the audit pass by measuring nothing. */
/* /sewa/ carries its own stylesheet rather than the app's tokens, so nothing the app-wide dark
 * palette guarantees applies to it. Trailing slash on purpose — it is static HTML in public/sewa/,
 * and only the directory form resolves to it under `vite preview`. */
const PAGES = [['/', 6], ['/?mode=full', 6], ['/login', 4], ['/playback', 2], ['/sewa/', 20]];

const AUDIT = () => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = (c) => {
        const [r, g, b] = c.slice(0, 3).map((v) => {
            const n = v / 255;
            return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (fg, bg) => {
        const a = lum(fg); const b = lum(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    // Walk up to whatever ancestor actually paints — that is what the text really sits on.
    const effectiveBg = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
            const c = rgb(getComputedStyle(n).backgroundColor);
            if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c;
            n = n.parentElement;
        }
        return rgb(getComputedStyle(document.body).backgroundColor);
    };

    const out = [];
    for (const el of document.querySelectorAll('body *')) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim();
        if (!text) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.2) continue;
        if (!el.getClientRects().length) continue;
        const fg = rgb(s.color);
        if (fg[3] !== undefined && fg[3] < 0.5) continue;

        const bg = effectiveBg(el);
        const isLarge = parseFloat(s.fontSize) >= 24
            || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
        out.push({
            text: text.slice(0, 40),
            pair: `${s.color} on rgb(${bg.slice(0, 3).join(', ')})`,
            ratio: Math.round(ratio(fg, bg) * 100) / 100,
            need: isLarge ? 3.0 : 4.5,
        });
    }
    return out;
};

for (const [path, minNodes] of PAGES) {
    test(`no unreadable text on ${path} in dark mode`, async ({ page }) => {
        await page.goto(path, { waitUntil: 'networkidle' });
        // Dark mode is where an unthemed foreground turns invisible; light mode hides the bug.
        await page.evaluate(() => {
            document.documentElement.classList.remove('light');
            document.documentElement.classList.add('dark');
        });
        await page.waitForTimeout(1500);

        const found = await page.evaluate(AUDIT);
        expect(
            found.length,
            `${path} rendered only ${found.length} text nodes — the audit would pass vacuously`,
        ).toBeGreaterThanOrEqual(minNodes);

        const invisible = found.filter((f) => f.ratio < INVISIBLE_FLOOR);
        expect(
            invisible,
            `\nText is effectively invisible on ${path} (contrast < ${INVISIBLE_FLOOR}):\n  ${
                invisible.map((f) => `"${f.text}" ${f.ratio} — ${f.pair}`).join('\n  ')}\n`,
        ).toEqual([]);

        const newFailures = found
            .filter((f) => f.ratio < f.need && !TOLERATED.has(f.pair))
            .filter((f, i, all) => all.findIndex((o) => o.pair === f.pair) === i);
        expect(
            newFailures,
            `\nNew low-contrast colour pair on ${path} (needs ${AA_NORMAL}, or ${AA_LARGE} for large text).\n`
            + 'Fix the colours, or add the pair to TOLERATED with the reason it is acceptable:\n  '
            + newFailures.map((f) => `"${f.text}" ${f.ratio} — ${f.pair}`).join('\n  ') + '\n',
        ).toEqual([]);
    });
}
