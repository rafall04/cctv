/*
 * Purpose: Catch the admin-UI defects an OVERFLOW audit structurally cannot see — chrome labels that
 *          render CLIPPED ("Dashbo…", "Diagnos…"), and controls stacked on top of each other or on
 *          top of the video picture. Both fit inside the viewport perfectly, so admin-overflow.spec
 *          passes them; both are exactly what an operator sees as "the UI looks off".
 * Caller: npm run test:e2e (Playwright), phone viewports.
 * Deps: a completed `npm run build` (playwright.config webServer serves dist).
 * SideEffects: None outside the test browser — an admin session is faked in localStorage and every
 *          /api/* call is mocked, same contract as admin-overflow.spec.
 *
 * WHY REAL DATA
 * -------------
 * Fixtures here are taken from the PRODUCTION database (read-only), not invented: 1,117 cameras,
 * the genuinely longest camera name (53 chars, "JL. Basuki Rahmat Barat - S4_Gubernur Suryo
 * Alun-Alun"), real area names up to 29 chars, real per-camera segment counts. A fixture kinder than
 * production cannot reproduce what production looks like — the whole reason this file exists.
 *
 * WHAT COUNTS AS A DEFECT
 * -----------------------
 *   CLIPPED CHROME — a label the PRODUCT owns (dock item, tab, button) whose own text does not fit
 *     its box. Truncating operator DATA (a 53-char camera name in a cell) is legitimate and is not
 *     reported; truncating the word "Diagnostik" is a layout that was never measured.
 *   STACKED CONTROLS — two interactive elements whose hit areas overlap, or a control parked on top
 *     of the <video> picture. Overlapping hit areas mean one control is unreachable or the picture
 *     is permanently obscured (on playback the speed buttons sit over the camera's burned-in clock).
 */

import { test, expect } from '@playwright/test';

/* ------------------------------------------------------------------ real production values ---- */

const REAL_LONGEST_CAMERA = 'JL. Basuki Rahmat Barat - S4_Gubernur Suryo Alun-Alun';
const REAL_CAMERA_NAMES = [
    REAL_LONGEST_CAMERA,
    'Gresik - CCTV PERTIGAAN KEDUNGPRING BALONGPANGGANG 3',
    'Jl. Mas Suharto V. Utara (Barat Sari Wangi Parfum)',
    'CCTV TIMUR PUSKESMAS TANJUNGHARJO',
    'CCTV GG SOMODIHARJO',
    'CCTV UTARA PASAR NGITIK 1',
    'Rumah Aldi (Privat)',
];
const REAL_AREAS = ['KEC BOJONEGORO DAN SEKITARNYA', 'DS TANJUNGHARJO', 'DS DANDER', 'Lainnya'];

/* Production has 1,117 cameras; 60 is enough to render every list/table shape without a slow test. */
const CAMERAS = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    name: REAL_CAMERA_NAMES[i % REAL_CAMERA_NAMES.length],
    location: REAL_AREAS[i % REAL_AREAS.length],
    area_id: (i % 4) + 1,
    area_name: REAL_AREAS[i % REAL_AREAS.length],
    camera_class: i % 9 === 0 ? 'owner_private' : 'community',
    is_online: i % 5 !== 0 ? 1 : 0,
    enabled: 1,
    enable_recording: 1,
    recording_enabled: 1,
    stream_url: `/hls/camera${i + 1}.m3u8`,
    thumbnail_url: null,
    has_audio: i % 3 === 0 ? 1 : 0,
    video_codec: i % 2 === 0 ? 'h265' : 'h264',
}));

const AREAS = REAL_AREAS.map((name, i) => ({ id: i + 1, name, camera_count: [14, 6, 8, 1][i] ?? 1 }));

/* Real shape: 22 ten-minute segments in a day, the count the operator's screenshot showed. */
const SEGMENTS = Array.from({ length: 22 }, (_, i) => {
    const start = new Date(Date.UTC(2026, 7, 25, 16, 50, 0) + i * 600000);
    return {
        id: i + 1,
        camera_id: 1,
        filename: `${start.toISOString().slice(0, 10).replace(/-/g, '')}_${String(start.getUTCHours()).padStart(2, '0')}0000.mp4`,
        start_time: start.toISOString(),
        end_time: new Date(start.getTime() + 600000).toISOString(),
        duration: 600,
        file_size: 238 * 1024 * 1024,
        source: 'local',
    };
});

const ADMIN_USER = {
    id: 1,
    username: 'e2e-admin',
    email: 'e2e-admin@example.invalid',
    role: 'admin',
    full_name: 'Operator Uji Otomatis',
};

/* Endpoint-specific payloads; anything else answers an empty success so no page hard-fails. */
const FIXTURES = [
    [/^\/api\/cameras\/active$/, CAMERAS],
    [/^\/api\/cameras/, CAMERAS],
    [/^\/api\/areas/, AREAS],
    [/^\/api\/recordings\/segments/, SEGMENTS],
    [/^\/api\/recordings\/playback/, SEGMENTS],
    [/segments/, SEGMENTS],
    [/^\/api\/settings/, { __body: { success: true, data: {} } }],
];

test.beforeEach(async ({ page, context }) => {
    await page.addInitScript((user) => {
        window.localStorage.setItem('user', JSON.stringify(user));
    }, ADMIN_USER);

    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        if (!local) return route.abort();
        if (url.pathname.startsWith('/api/')) {
            const fixture = FIXTURES.find(([pattern]) => pattern.test(url.pathname));
            const value = fixture ? fixture[1] : [];
            const body = value && value.__body ? value.__body : { success: true, data: value };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        }
        return route.continue();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

/* ------------------------------------------------------------------------------ measurement ---- */

/*
 * Clipped chrome. `scrollWidth > clientWidth` on an ellipsised box means the text does not fit.
 *
 * Chrome vs data is decided by ORIGIN, not by looks: an element is chrome when its text is one of
 * the product's own fixed strings. Passing that list in keeps a 53-char camera name — which SHOULD
 * truncate — from being reported as a bug, which is what would make this audit noise and get it
 * switched off.
 */
const findClippedChrome = (chromeWords) => {
    const out = [];
    for (const el of document.querySelectorAll('a, button, [role="tab"], nav span, h1, h2, h3, label')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;

        // Measure the deepest node that actually carries the ellipsis.
        const targets = [el, ...el.querySelectorAll('span, div')];
        for (const t of targets) {
            const ts = getComputedStyle(t);
            if (ts.textOverflow !== 'ellipsis') continue;
            const text = (t.textContent || '').trim().replace(/\s+/g, ' ');
            if (!text || !chromeWords.includes(text)) continue;
            if (t.scrollWidth > t.clientWidth + 1) {
                out.push({
                    text,
                    shownPx: t.clientWidth,
                    neededPx: t.scrollWidth,
                    where: (el.getAttribute('class') || '').slice(0, 60),
                });
            }
        }
    }
    return out;
};

/*
 * Controls stacked on the video picture.
 *
 * The <video> here carries the `controls` attribute, so the browser draws its OWN control bar inside
 * that same box. Any product-drawn control whose rect lands inside the video rect is therefore
 * competing with both the picture and a native control surface. Reported with the fraction of the
 * picture it covers so a deliberate 1-corner button reads differently from a strip across the top.
 */
const findControlsOverVideo = () => {
    const video = document.querySelector('video');
    if (!video) return { hasVideo: false, items: [] };
    const v = video.getBoundingClientRect();
    if (v.width === 0) return { hasVideo: false, items: [] };

    const items = [];
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        const ox = Math.max(0, Math.min(r.right, v.right) - Math.max(r.left, v.left));
        const oy = Math.max(0, Math.min(r.bottom, v.bottom) - Math.max(r.top, v.top));
        if (ox <= 0 || oy <= 0) continue;
        items.push({
            label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
            coversPct: Math.round(((ox * oy) / (v.width * v.height)) * 1000) / 10,
            top: Math.round(r.top - v.top),
            right: Math.round(v.right - r.right),
        });
    }
    return {
        hasVideo: true,
        nativeControls: video.hasAttribute('controls'),
        videoBox: { w: Math.round(v.width), h: Math.round(v.height) },
        items,
    };
};

/*
 * Interactive elements whose hit areas overlap each other — one of them is hard or impossible to hit.
 *
 * The OFF-CANVAS SIDEBAR is why this needs more than a visibility check. On a phone the admin sidebar
 * is present in the DOM and merely translated off-screen; its ~23 links collapse onto each other at
 * negative x, which a naive sweep reports as "Arsip Rekaman covers Logout by 95%" on every single
 * admin route. That is a measuring fault, not 31 bugs — and an audit that accuses healthy code is an
 * audit someone switches off. So: only elements actually inside the viewport, and nothing under an
 * aria-hidden/inert ancestor, count as competing for the same tap.
 */
const findOverlappingControls = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const hiddenAncestor = (el) => {
        for (let p = el; p; p = p.parentElement) {
            if (p.getAttribute && (p.getAttribute('aria-hidden') === 'true' || p.hasAttribute('inert'))) return true;
        }
        return false;
    };
    const els = [...document.querySelectorAll('button, a, [role="button"], input, select')].filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        // Off-screen (closed drawer, virtualised row) is not on the operator's screen.
        if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) return false;
        const cs = getComputedStyle(el);
        if (cs.pointerEvents === 'none') return false;
        if (hiddenAncestor(el)) return false;
        return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    });
    const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 34);
    /*
     * Sticky chrome passing over scrolling content is NOT a collision — it is what a fixed header and
     * a fixed dock are FOR. Measured at the top of the page the dock covers the last row; measured at
     * the bottom the header covers the first. Both are reachable with one gesture, and reporting them
     * produced a failure on nearly every route. Only two controls in the SAME positioning context can
     * genuinely fight over one tap, so a fixed-vs-flow pair is skipped and a fixed-vs-fixed or
     * flow-vs-flow pair is kept — which is exactly the shape of the speed buttons over the video.
     */
    const pinned = (el) => {
        for (let p = el; p; p = p.parentElement) {
            const pos = getComputedStyle(p).position;
            if (pos === 'fixed' || pos === 'sticky') return true;
        }
        return false;
    };
    const out = [];
    for (let i = 0; i < els.length; i += 1) {
        for (let j = i + 1; j < els.length; j += 1) {
            if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
            if (pinned(els[i]) !== pinned(els[j])) continue;
            const a = els[i].getBoundingClientRect();
            const b = els[j].getBoundingClientRect();
            const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
            const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            if (ox < 6 || oy < 6) continue;   // ignore hairline adjacency/borders
            const smaller = Math.min(a.width * a.height, b.width * b.height);
            const pct = Math.round(((ox * oy) / smaller) * 100);
            if (pct < 25) continue;
            out.push({ a: name(els[i]), b: name(els[j]), overlapPct: pct });
        }
    }
    return out;
};

/* The product's own fixed strings that must never render clipped. */
const CHROME_WORDS = [
    'Dashboard', 'Kamera', 'Diagnostik', 'Token', 'Publik', 'Rekaman',
    'Area', 'Pengaturan', 'Analitik', 'Keamanan', 'Simpan', 'Batal', 'Tutup',
    'Putar Ulang', 'Arsip Rekaman', 'Laporan Kamera', 'Penilaian Kamera',
    'Simpan setelan', 'Simpan Default', 'Coba lagi', 'Cari waktu',
];

const PHONES = [
    { name: '320', width: 320, height: 720 },
    { name: '360', width: 360, height: 760 },
    { name: '393', width: 393, height: 851 },
];

/*
 * Every admin route. The dock renders on all of them, so a clipped dock label is caught wherever it
 * happens; per-page chrome is caught on the page that owns it.
 */
const ADMIN_ROUTES = [
    '/admin/dashboard', '/admin/cameras', '/admin/areas', '/admin/playback', '/admin/recordings',
    '/admin/health-debug', '/admin/settings', '/admin/security', '/admin/users', '/admin/analytics',
    '/admin/playback-analytics', '/admin/playback-tokens', '/admin/playback-products', '/admin/arsip',
    '/admin/telegram-archive', '/admin/camera-reports', '/admin/camera-reactions', '/admin/feedback',
    '/admin/sponsors', '/admin/promo-banners', '/admin/affiliate', '/admin/ads', '/admin/billing',
    '/admin/customer-ips', '/admin/voucher', '/admin/ronda', '/admin/hitung-kendaraan',
    '/admin/jam-kamera', '/admin/notification-diagnostics', '/admin/import-export',
    '/admin/backup-restore',
];

async function visit(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
}

/*
 * Scroll every scrollable container to its END before measuring against the dock.
 *
 * Content sitting under a fixed dock is NOT automatically a bug: on a long page you scroll and it
 * comes out. It is only a bug when the page is already at its last pixel and the content is STILL
 * under the dock — then no gesture can reach it, which is the missing bottom-padding defect. So the
 * measurement has to happen at maximum scroll, or it reports normal pages as broken.
 */
async function scrollToEnd(page) {
    await page.evaluate(() => {
        const targets = [document.scrollingElement, ...document.querySelectorAll('main, [class*="overflow-y"]')];
        for (const t of targets) {
            if (t && typeof t.scrollTop === 'number') t.scrollTop = t.scrollHeight;
        }
    });
    await page.waitForTimeout(350);
}

test.describe('admin polish — clipped chrome', () => {
    for (const phone of PHONES) {
        test(`dock labels are never clipped at ${phone.name}px`, async ({ page }) => {
            await page.setViewportSize({ width: phone.width, height: phone.height });
            await visit(page, '/admin/dashboard');

            const dock = page.getByTestId('admin-pwa-quick-actions');
            await expect(dock, 'admin dock did not render').toBeVisible();

            const clipped = await page.evaluate(findClippedChrome, CHROME_WORDS);
            // eslint-disable-next-line no-console
            console.log(`AUDIT dock@${phone.name} ${JSON.stringify(clipped)}`);

            expect(
                clipped,
                `Dock labels render CLIPPED at ${phone.width}px: `
                + clipped.map((c) => `"${c.text}" needs ${c.neededPx}px but has ${c.shownPx}px`).join('; ')
                + '. The dock owns these strings, so this is the layout being too tight for its own labels.',
            ).toEqual([]);
        });
    }
});

test.describe('admin polish — controls stacked on the video picture', () => {
    test('playback video is not covered by product-drawn controls', async ({ page }) => {
        await page.setViewportSize({ width: 393, height: 851 });
        await visit(page, '/admin/playback');

        const report = await page.evaluate(findControlsOverVideo);
        // eslint-disable-next-line no-console
        console.log(`AUDIT playback-video ${JSON.stringify(report)}`);

        test.skip(!report.hasVideo, 'no <video> rendered — fixture did not reach the player');

        const total = report.items.reduce((s, i) => s + i.coversPct, 0);
        expect(
            total,
            `Product-drawn controls cover ${total}% of the video picture on a 393px phone `
            + `(${report.items.map((i) => `"${i.label}" ${i.coversPct}%`).join(', ')}). `
            + `The <video> also draws NATIVE controls (controls=${report.nativeControls}), so the operator `
            + 'sees two control systems competing over one picture.',
        ).toBeLessThan(12);
    });
});

test.describe('admin polish — overlapping hit areas', () => {
    for (const url of ADMIN_ROUTES) {
        test(`no controls overlap each other on ${url}`, async ({ page }) => {
            await page.setViewportSize({ width: 393, height: 851 });
            await visit(page, url);
            await scrollToEnd(page);

            const overlaps = await page.evaluate(findOverlappingControls);
            if (overlaps.length) {
                // eslint-disable-next-line no-console
                console.log(`AUDIT overlap ${url} ${JSON.stringify(overlaps)}`);
            }

            expect(
                overlaps,
                `${url}: interactive elements overlap, so one of them is hard to hit — `
                + overlaps.map((o) => `"${o.a}" over "${o.b}" (${o.overlapPct}%)`).join('; '),
            ).toEqual([]);
        });
    }
});
