/*
 * Purpose: Catch unreadable text on EVERY surface — public, admin, and the customer portal —
 *          by measuring REAL rendered contrast.
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

/* [path, minimum text nodes expected, audits the donation widget] — the floor guards against a
 * page that failed to render at all, which would otherwise let the audit pass by measuring nothing.
 *
 * The donation widget is public chrome that paints its OWN brand colours, and the blanket
 * empty-success mock above answers "is the ask on?" with NO — so it never rendered here and its
 * white-on-amber header (2.15) shipped unmeasured for months. A guard that mocks a feature off
 * cannot guard it, so the simple shell switches the config on and waits for the banner: it arrives
 * late on purpose (deferred mount, opens at 3s, folds itself away at 12s), and auditing before it
 * exists is the same blindness as never enabling it.
 *
 * `/?mode=full` deliberately does NOT do this yet: its footer still paints `bg-amber-500` under
 * white text — the identical 2.15 pair, in LandingFooter.jsx. Turn the flag on there in the same
 * change that fixes that button. Adding the pair to TOLERATED instead would be worse than useless:
 * TOLERATED keys on the colour PAIR, so excusing it once would re-blind this guard to white on
 * amber-500 everywhere, including the widget it was just fixed in. */
/* /sewa/ carries its own stylesheet rather than the app's tokens, so nothing the app-wide dark
 * palette guarantees applies to it. Trailing slash on purpose — it is static HTML in public/sewa/,
 * and only the directory form resolves to it under `vite preview`. */
const BANNER = '[data-testid="saweria-floating-banner"]';

/*
 * Sesi palsu, bentuk yang sama dengan admin-overflow.spec.js: aplikasi hanya membaca kunci
 * `user` di localStorage untuk memutuskan apa yang boleh dirender.
 */
const ADMIN_USER = { id: 1, username: 'e2e-admin', email: 'admin@example.invalid', role: 'admin', full_name: 'Operator Uji' };
const CUSTOMER_USER = { id: 42, username: 'e2e-pelanggan', email: 'pelanggan@example.invalid', role: 'customer', full_name: 'Pelanggan Uji' };

/*
 * KENAPA ADMIN DAN PELANGGAN AKHIRNYA MASUK
 * -----------------------------------------
 * Penjaga ini lahir untuk permukaan publik dan berhenti di situ selama berbulan-bulan, jadi
 * dua permukaan terbesar yang dipakai MANUSIA setiap hari — 30 halaman admin yang dipakai
 * operator dan 7 halaman portal yang dipakai 11 pelanggan berbayar — tidak pernah sekali pun
 * diukur kontrasnya. Padahal justru di sanalah polanya paling berisiko: tabel padat, lencana
 * status, dan teks kecil di atas tint 10% — kombinasi yang SUDAH pernah gagal di repo ini
 * (toast yang latarnya cuma tint 10%, 2026-08-27).
 *
 * API tetap dijawab kosong-berhasil, jadi yang terukur adalah CHROME-nya, bukan datanya. Itu
 * memang sasarannya: warna yang dipatok hidup di chrome, bukan di baris data.
 */
const PAGES = [
    { path: '/', minNodes: 6, donation: true },
    { path: '/?mode=full', minNodes: 6 },
    { path: '/login', minNodes: 4 },
    { path: '/playback', minNodes: 2 },
    { path: '/dukungan', minNodes: 20 },
    { path: '/sewa/', minNodes: 20 },

    // Portal pelanggan — 11 akun nyata, nol pengukuran kontras sampai hari ini.
    { path: '/my', minNodes: 4, user: CUSTOMER_USER },
    { path: '/my/paket', minNodes: 4, user: CUSTOMER_USER },
    { path: '/my/wallet', minNodes: 4, user: CUSTOMER_USER },
    { path: '/my/akun', minNodes: 4, user: CUSTOMER_USER },
    { path: '/my/panduan', minNodes: 10, user: CUSTOMER_USER },
    { path: '/my/rekaman', minNodes: 4, user: CUSTOMER_USER },

    /*
     * Admin: bukan ketiga puluh rutenya, melainkan yang chrome-nya BERBEDA satu sama lain.
     * Kontras adalah sifat chrome — shell, tabel, lencana, tombol — dan tiga puluh halaman
     * yang memakai shell yang sama akan mengukur pasangan warna yang sama tiga puluh kali.
     * Yang dipilih di bawah menutup shell, tabel padat, papan angka, formulir, editor, dan
     * halaman berlencana status.
     */
    { path: '/admin/dashboard', minNodes: 8, user: ADMIN_USER },
    { path: '/admin/cameras', minNodes: 6, user: ADMIN_USER },
    { path: '/admin/analytics', minNodes: 6, user: ADMIN_USER },
    { path: '/admin/settings', minNodes: 6, user: ADMIN_USER },
    { path: '/admin/security', minNodes: 6, user: ADMIN_USER },
    { path: '/admin/billing', minNodes: 6, user: ADMIN_USER },
    { path: '/admin/affiliate', minNodes: 6, user: ADMIN_USER },
    { path: '/admin/sponsors', minNodes: 6, user: ADMIN_USER },
    { path: '/admin/recordings', minNodes: 6, user: ADMIN_USER },
    { path: '/admin/users', minNodes: 6, user: ADMIN_USER },
];

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

for (const { path, minNodes, donation: auditsDonationWidget, user } of PAGES) {
    test(`no unreadable text on ${path} in dark mode`, async ({ page }) => {
        if (user) {
            await page.addInitScript((u) => {
                window.localStorage.setItem('user', JSON.stringify(u));
            }, user);
        }
        if (auditsDonationWidget) {
            // A page route outranks the blanket context route registered in beforeEach.
            await page.route('**/api/saweria/config', (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: { enabled: true } }),
            }));
        }
        await page.goto(path, { waitUntil: 'networkidle' });
        // Dark mode is where an unthemed foreground turns invisible; light mode hides the bug.
        await page.evaluate(() => {
            document.documentElement.classList.remove('light');
            document.documentElement.classList.add('dark');
        });
        if (auditsDonationWidget) {
            // Open card, not the folded bubble: the bubble has no text to measure.
            await page.waitForSelector(`${BANNER} >> text=Dukung Kami`, { timeout: 10_000 });
        }
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
