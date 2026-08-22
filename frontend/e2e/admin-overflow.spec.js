/*
 * Purpose: Real-browser overflow smoke for the ADMIN surface — the half of the app the public
 *   overflow guard is structurally unable to see (see THE BLIND SPOT below).
 * Caller: playwright.config.js (npm run test:e2e; e2e job in CI).
 * Deps: @playwright/test, built dist served by vite preview; all /api/* mocked, external hosts blocked.
 * MainFuncs: admin-shell overflow assertions per admin page, at 393px and 320px, normal and 1.5x font.
 * SideEffects: None outside the test browser (an admin session is faked in localStorage).
 *
 * THE BLIND SPOT THIS FILE EXISTS TO CLOSE (measured 2026-08, commit e16eb92)
 * ---------------------------------------------------------------------------
 * e2e/overflow.spec.js is correct for public pages and must stay exactly as it is. It cannot see
 * admin pages, for three stacked reasons — every one of them true at the same time:
 *
 *   1. Its PAGES list is public routes only; no /admin route was ever in it.
 *   2. src/index.css sets `overflow-x: clip` on BOTH html and body, so
 *      documentElement.scrollWidth reported a clean 320/320 across 80 measurements — including
 *      ones taken while the admin layout was genuinely 689px wide inside a 320px viewport.
 *   3. Its measure() skips any element with a scrolling ancestor (overflow auto/scroll/hidden/clip
 *      all count). AdminLayout renders `<main className="min-h-screen overflow-y-auto lg:ml-72">`,
 *      and `overflow-y: auto` computes `overflow-x: auto`, so EVERY element inside EVERY admin page
 *      is skipped by that helper.
 *
 * Net effect: the whole admin surface was invisible to the guard, and two blocking layout defects
 * shipped through it — a <fieldset> keeping the UA default `min-inline-size: min-content` (Tailwind
 * preflight never resets it) grew to 689px on a 320px viewport with the camera picker open, putting
 * the picker's search box 356px off screen; and an unbreakable 79-char filename in a <strong> did
 * the same at 584px. Both were fixed with `min-w-0` (+ `break-all` on the filename).
 *
 * So this file does NOT reuse the public measure(). It measures the scroll container itself.
 *
 * WHAT IT FOUND THE FIRST TIME IT RAN — these are NOT flakes, do not silence them
 * ------------------------------------------------------------------------------
 * /admin/affiliate is green. The other two pages are red at 1.5x font ONLY (both are clean at
 * normal font, at 320px and 393px alike), on two pre-existing defects of the same family as the
 * ones that prompted this file — an intrinsic control width that nothing lets shrink:
 *
 *   - src/pages/CameraManagement.jsx:93 — the filter row `grid gap-3 md:grid-cols-2 xl:grid-cols-4`
 *     has no min-w-0 on its items, and a grid item's default `min-width: auto` is min-content. At
 *     24px root font the area <select> measures 417px min-content (a <select> is sized by its widest
 *     <option>) and the search <input> 294px, inside a 222px column — so every item stretches to
 *     450-466px. The <input> is reported as the offender only because it is the first element at
 *     that width; the <select> is what sets it. Note the input alone (294 > 222) overflows with an
 *     EMPTY area list, so this is structural, not a property of the fixture.
 *   - src/components/admin/settings/GeneralSettingsPanel.jsx:262,304,358,400 — four
 *     <input type="datetime-local"> render 335px each at 24px root font (measured with 1-character
 *     fixture values, so this is entirely data-independent) and push <main> to 427px.
 *
 * Fixing those is a src change and deliberately out of this file's scope. Until then `npm run
 * test:e2e` reports 4 failures here, each naming its own culprit.
 */

import { test, expect } from '@playwright/test';

/* ------------------------------------------------------------------ fixtures
 *
 * REALISTIC WORST CASE, NOT EMPTY.
 *
 * An empty admin page cannot overflow: no rows, no picker, no long token, nothing wider than its
 * box. Empty fixtures here would produce a green suite that proves nothing — the same vacuity trap
 * that let the 2026-08 public-strip bug through (see the expectStrip comment in overflow.spec.js).
 * The audit's numbers came from an 85-char store name and a 750-camera picker, so those are the
 * shapes fed back in.
 */

/* Area names deliberately match the LONGEST shape the public spec already treats as realistic
 * ('KEC BOJONEGORO DAN SEKITARNYA', 29 chars) rather than an invented monster — a <select> is sized
 * by its widest <option>, so this fixture decides how hard the camera filter row is pushed and an
 * unrealistic value here would manufacture a failure instead of finding one. */
const AREA_NAMES = [
    'KEC BOJONEGORO DAN SEKITARNYA',
    'KAB MAGETAN',
    'DANDER',
    'TANJUNGHARJO',
    'KEC KAPAS DAN SEKITARNYA',
    'KEC BALEN',
];

/* Long enough that the picker row's `whitespace-nowrap` (from `truncate`) makes its min-content
 * width the FULL string — which is precisely what a fieldset without min-w-0 inflates to. */
const cameraName = (i) =>
    `SIMPANG EMPAT JALAN RAYA NAMA KAMERA YANG SENGAJA SANGAT PANJANG SEKALI NOMOR ${String(i).padStart(4, '0')}`;

/* 750 to match the audit exactly. TargetPicker caps the rendered list at 200, so the extra rows
 * only change the "Menampilkan 200 dari 750" line — but the cap is part of what is being measured,
 * and a fixture under 200 would never render it. */
const ADMIN_CAMERAS = Array.from({ length: 750 }, (_, i) => ({
    id: i + 1,
    name: cameraName(i + 1),
    location: `JL. LOKASI PANJANG DESA CONTOH KECAMATAN CONTOH NOMOR ${i + 1}`,
    area_id: (i % 6) + 1,
    area_name: AREA_NAMES[i % AREA_NAMES.length],
    stream_url: `http://127.0.0.1:4173/hls/kamera-dengan-nama-stream-key-yang-panjang-${i + 1}/index.m3u8`,
    camera_class: 'community',
    status: i % 7 === 0 ? 'inactive' : 'active',
    enabled: i % 5 === 0 ? 0 : 1,
    is_online: i % 3 === 0 ? 0 : 1,
    is_published: 1,
    live_viewers: i % 11,
    total_views: 1000 + i,
    resolution: '1920x1080',
    codec: 'h265',
}));

const ADMIN_AREAS = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    name: AREA_NAMES[i % AREA_NAMES.length],
    slug: `area-${i + 1}`,
    camera_count: 12 + i,
    total_views: 5000 + i,
    description: 'Deskripsi area yang panjang supaya kartunya terisi seperti di produksi.',
}));

/* 85-char store name — the exact class of value the audit measured 605px on. */
const AFFILIATE_PARTNERS = [
    {
        id: 1,
        store_name: 'TOKO KAMERA PENGAWAS DAN AKSESORIS JARINGAN SERBA ADA CABANG BOJONEGORO PUSAT SATU',
        store_url: 'https://tokopedia.example.com/toko-kamera-pengawas-dan-aksesoris-jaringan-serba-ada/etalase/kamera-ip-3mp-outdoor-anti-air',
        contact_name: 'Bapak Penanggung Jawab Kemitraan Wilayah Timur',
        billing_mode: 'lifetime',
        price_rupiah: 0,
        active: 1,
        note: 'Catatan kesepakatan yang panjang supaya barisnya terisi seperti data sungguhan.',
    },
    {
        id: 2,
        store_name: 'CV SUMBER REJEKI ELEKTRONIK DAN PERKAKAS TEKNIK MANDIRI SEJAHTERA ABADI',
        store_url: 'https://shopee.example.com/sumber-rejeki-elektronik-perkakas-teknik-mandiri/produk/adaptor-poe-gigabit-48v',
        contact_name: 'Ibu Manajer Penjualan',
        billing_mode: 'term',
        price_rupiah: 250000,
        active: 0,
        note: 'Berjangka, jatuh tempo tiap bulan.',
    },
];

const AFFILIATE_OFFERS = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    partner_id: (i % 2) + 1,
    product_title: `KAMERA IP OUTDOOR 3MP ANTI AIR DENGAN AUDIO DUA ARAH DAN LAMPU SOROT NOMOR ${i + 1}`,
    description: 'Deskripsi barang yang panjang, seperti yang benar-benar diketik operator ketika '
        + 'menjelaskan isi paket beserta kelengkapan dan garansinya.',
    /* One unbreakable ~120-char token: the same failure shape as the 79-char filename defect. */
    product_url: `https://tokopedia.example.com/toko-kamera-pengawas/produk-kamera-ip-outdoor-3mp-anti-air-audio-dua-arah-lampu-sorot-varian-${i + 1}`,
    product_price_rupiah: 385000 + i * 1000,
    whatsapp_number: '628123456789',
    whatsapp_message: 'Halo, saya mau tanya soal kamera yang tampil di CCTV publik.',
    placements: ['popup'],
    /* The FIRST row is camera-targeted on purpose: clicking its "Ubah" opens the editor with the
     * 750-camera picker already rendered, which is the state both defects were found in. */
    target_mode: i === 0 ? 'camera' : (i % 3 === 1 ? 'area' : 'all'),
    camera_ids: i === 0 ? [1, 2, 3, 4, 5] : [],
    area_ids: i % 3 === 1 ? [1, 2] : [],
    priority: 100 + i,
    active: i % 2 === 0 ? 1 : 0,
    image_base: null,
}));

const LANDING_SETTINGS = {
    area_coverage: 'Wilayah layanan mencakup banyak kecamatan dengan nama yang panjang sekali',
    hero_badge: 'PEMANTAUAN CCTV PUBLIK KABUPATEN',
    section_title: 'Daftar kamera pemantauan lalu lintas dan fasilitas umum',
    eventBanner: {
        enabled: true,
        title: 'PENGUMUMAN KEGIATAN',
        text: 'Teks spanduk kegiatan yang panjang supaya kotak isiannya benar-benar terisi.',
        theme: 'national',
        start_at: '2026-08-01 00:00',
        end_at: '2026-08-31 23:59',
        show_in_full: true,
        show_in_simple: true,
    },
    announcement: {
        enabled: true,
        title: 'INFORMASI PEMELIHARAAN',
        text: 'Teks pengumuman yang panjang supaya kotak isiannya benar-benar terisi juga.',
        style: 'warning',
        start_at: '2026-08-10 00:00',
        end_at: '2026-08-12 23:59',
        show_in_full: true,
        show_in_simple: false,
    },
};

/* Ordered: first regex that matches the pathname wins, so put the specific ones first. */
const API_FIXTURES = [
    [/^\/api\/admin\/affiliate\/partners$/, AFFILIATE_PARTNERS],
    [/^\/api\/admin\/affiliate\/offers$/, AFFILIATE_OFFERS],
    [/^\/api\/settings\/landing-page$/, LANDING_SETTINGS],
    [/^\/api\/cameras$/, ADMIN_CAMERAS],
    [/^\/api\/areas$/, ADMIN_AREAS],
    [/^\/api\/areas\/overview$/, ADMIN_AREAS],
    [/^\/api\/cameras\/active$/, ADMIN_CAMERAS.slice(0, 24)],
];

/*
 * HOW THE ADMIN SESSION IS FAKED
 * ------------------------------
 * There is no AuthContext in this app. ProtectedRoute asks authService, and authService answers
 * from ONE place: `localStorage.getItem('user')` for isAuthenticated(), and that same object's
 * `.role === 'admin'` for isAdmin() (src/services/authService.js). The real access token lives in
 * an HttpOnly cookie the frontend cannot read, and every /api/* call is mocked here anyway, so
 * seeding that single localStorage key is the whole of what "logged in as admin" means client-side.
 * addInitScript runs before app code on every navigation, so the key is present when
 * ProtectedRoute first evaluates — no login round-trip, no flash of the login page.
 */
const ADMIN_USER = {
    id: 1,
    username: 'e2e-admin',
    email: 'e2e-admin@example.invalid',
    role: 'admin',
    full_name: 'Operator Uji Otomatis Dengan Nama Panjang',
};

test.beforeEach(async ({ page, context }) => {
    await page.addInitScript((user) => {
        window.localStorage.setItem('user', JSON.stringify(user));
    }, ADMIN_USER);

    // Same contract as the public spec: known payloads for the endpoints these pages read, empty
    // success for everything else, and every non-local request blocked.
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
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

/*
 * THE MEASUREMENT — and why documentElement is useless on these pages.
 *
 * Public pages let content reach the DOCUMENT's scrollable rect, so `documentElement.scrollWidth`
 * is the number that catches a runaway strip there. Admin pages have TWO layers that swallow it:
 *
 *   - `overflow-x: clip` on html AND body (src/index.css) clamps the root's scroll rect outright;
 *   - even without that, <main> is itself a scroll container (`overflow-y: auto` ⇒ overflow-x:auto),
 *     and a scroll container ABSORBS its content's overflow. Its own box stays viewport-width; the
 *     excess becomes ITS scrollWidth and never propagates to the document.
 *
 * That is why 80 root measurements said 320/320 while the layout was 689px wide. The honest number
 * for a page rendered inside AdminLayout is therefore the CONTAINER's own overflow:
 *
 *   (a) main.scrollWidth vs main.clientWidth — the container's content does not fit the container;
 *   (b) a sweep for any visible element whose rect.right passes the container's right edge, which
 *       names the culprit instead of just reporting a width.
 *
 * The sweep skips elements sitting inside a NESTED scroll container (the tab strip, the picker's
 * own max-h list): those are deliberately scrollable and being wide is their job. It stops that
 * ancestor walk AT <main>, which is exactly the line the public helper cannot draw — it walks to
 * documentElement, hits <main>, and discards the entire admin surface.
 *
 * position:fixed boxes escape every clip, so they are measured against the VIEWPORT instead — same
 * reasoning as the public spec's `fixed` number (that is how the FeedbackWidget bug shipped). On
 * these pages that covers the mobile admin header and the bottom dock.
 */
const measureAdminShell = () => {
    const de = document.documentElement;
    const main = document.querySelector('main');
    if (!main) return { found: false };

    const mainRect = main.getBoundingClientRect();
    const limit = mainRect.right;

    const describe = (el) => {
        const cls = (el.getAttribute('class') || '').slice(0, 90);
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        return `<${el.tagName.toLowerCase()} class="${cls}">${text ? ` — "${text}"` : ''}`;
    };

    // A nested scroll container between `el` and <main> is allowed to be wider than the viewport.
    const insideNestedScroller = (el) => {
        let p = el.parentElement;
        while (p && p !== main) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true;
            p = p.parentElement;
        }
        return false;
    };

    let worst = null;
    let fixedRight = 0;
    let fixedWorst = null;

    for (const el of document.querySelectorAll('body *')) {
        const rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden') continue;

        if (cs.position === 'fixed') {
            if (rect.right > fixedRight) {
                fixedRight = rect.right;
                fixedWorst = describe(el);
            }
            continue;
        }

        if (!main.contains(el)) continue;
        if (insideNestedScroller(el)) continue;
        if (rect.right <= limit + 1) continue;
        if (!worst || rect.right > worst.right) worst = { right: Math.round(rect.right), what: describe(el) };
    }

    return {
        found: true,
        vw: de.clientWidth,
        mainScrollW: main.scrollWidth,
        mainClientW: main.clientWidth,
        worstRight: worst ? worst.right : 0,
        worstWhat: worst ? worst.what : null,
        limit: Math.round(limit),
        fixed: Math.round(fixedRight),
        fixedWhat: fixedWorst,
        // Reported purely so a failure message can show it sitting there looking innocent.
        rootScrollW: de.scrollWidth,
    };
};

async function assertNoAdminOverflow(page, label) {
    const m = await page.evaluate(measureAdminShell);
    expect(m.found, `${label}: no <main> — this page did not render inside AdminLayout, so nothing was measured`).toBe(true);

    expect(
        m.mainScrollW,
        `${label}: the admin scroll container is ${m.mainScrollW}px wide but only ${m.mainClientW}px fits `
        + `(viewport ${m.vw}px). The page scrolls sideways. documentElement.scrollWidth says `
        + `${m.rootScrollW} — that number is blind here, see the header of this file. `
        + `Widest offender: ${m.worstWhat || '(none found — look for a nested scroller that should not scroll)'}`
        + ` at ${m.worstRight}px. Usual cause: a <fieldset> or flex/grid child without min-w-0, or an `
        + 'unbreakable token without break-all.',
    ).toBeLessThanOrEqual(m.mainClientW + 1);

    expect(
        m.worstRight,
        `${label}: an element reaches ${m.worstRight}px, past the container's right edge at ${m.limit}px `
        + `(viewport ${m.vw}px) — ${m.worstWhat}`,
    ).toBeLessThanOrEqual(m.limit + 1);

    expect(
        m.fixed,
        `${label}: a position:fixed element reaches ${m.fixed}px on a ${m.vw}px viewport — ${m.fixedWhat}`,
    ).toBeLessThanOrEqual(m.vw + 1);

    return m;
}

/*
 * `ready` is the anti-vacuity gate, one per page: a selector that only exists once the page has
 * actually rendered its heavy content. Without it a run that silently fell back to the login page,
 * or rendered a spinner, would measure an empty box and pass.
 *
 * `open` drives the page into the state the audit measured. The affiliate defects only appear with
 * the offer editor open on a camera-targeted row — the picker is not reachable from a URL, so the
 * test clicks its way there and then asserts the picker is on screen before measuring.
 */
const ADMIN_PAGES = [
    {
        name: 'admin affiliate (offer editor, 750-camera picker open)',
        url: '/admin/affiliate',
        ready: 'text=Toko Rekanan',
        open: async (page) => {
            await page.getByRole('tab', { name: /Barang/ }).click();
            await page.getByRole('button', { name: 'Ubah' }).first().click();
            // The picker itself — the widest thing on the page and the thing both defects lived in.
            await expect(
                page.getByLabel('Cari Kamera'),
                'the camera picker never rendered, so this run measured nothing',
            ).toBeVisible();
            await expect(page.getByText(/Menampilkan 200 dari 750/)).toBeVisible();
        },
    },
    {
        name: 'admin cameras (list, 750 rows)',
        url: '/admin/cameras',
        ready: `text=${cameraName(1)}`,
    },
    {
        name: 'admin settings (dense form)',
        url: '/admin/settings',
        ready: '#landing_area_coverage',
    },
];

/* The public spec's width (Pixel 5, from playwright.config.js) plus 320 — the narrowest phone still
 * in the field, and the width both audit defects were worst at. */
const VIEWPORTS = [
    { label: '393px', width: 393, height: 851 },
    { label: '320px', width: 320, height: 640 },
];

for (const spec of ADMIN_PAGES) {
    for (const vp of VIEWPORTS) {
        test(`no horizontal overflow: ${spec.name} @${vp.label}`, async ({ page }) => {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.goto(spec.url, { waitUntil: 'networkidle' });

            // Anti-vacuity: prove we are on the real page, not the login redirect or a spinner.
            await expect(
                page.locator(spec.ready).first(),
                `${spec.name}: did not render (auth stub broken, or fixtures rejected) — nothing was measured`,
            ).toBeVisible({ timeout: 15_000 });

            if (spec.open) await spec.open(page);
            // Let lazy admin chunks and deferred mounts settle.
            await page.waitForTimeout(600);

            await assertNoAdminOverflow(page, `${spec.name} @${vp.label}`);

            // Android "large text" (~1.5x) — the setting that turned a merely-tight admin row into
            // an off-screen one before the toggles got min-w-0 + truncate.
            await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
            await page.waitForTimeout(300);
            await assertNoAdminOverflow(page, `${spec.name} @${vp.label} @1.5x font`);
        });
    }
}
