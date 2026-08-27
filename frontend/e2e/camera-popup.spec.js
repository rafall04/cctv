/*
 * Purpose: Penjaga real-browser untuk POPUP KAMERA — permukaan tonton terbesar, dan satu-satunya
 *          yang tidak pernah dibuka oleh spec mana pun.
 * Caller: Playwright (npm run test:e2e).
 * Deps: Build produksi via `vite preview`; seluruh API dipalsukan; host eksternal diblokir.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Sampai 2026-08-28 empat spec e2e menjaga beranda, area, playback, 30 rute admin, dan 7 rute
 * pelanggan — dan TIDAK SATU PUN pernah mengklik sebuah kamera. Popup itulah tempat orang
 * sebenarnya menghabiskan waktunya, tempat slot komersial `popup` hidup (8 dari 10 tawaran
 * mengincar kamera, bukan beranda), dan tempat keadaan galat pemutar tampil.
 *
 * KENAPA PENGUKURAN HALAMAN TIDAK BISA MELIHATNYA
 * Popup ini `position: fixed`. Subtree yang keluar dari alur normal TIDAK menyumbang apa pun ke
 * `main.scrollWidth` maupun `documentElement.scrollWidth` — jadi seluruh mesin ukur yang sudah ada
 * memandangnya sebagai nol, berapa pun lebarnya. Yang jujur adalah panelnya SENDIRI, plus tiap
 * elemen di dalamnya yang melewati tepi kanan viewport.
 *
 * KENAPA VIDEONYA TIDAK DIPUTAR, DAN KENAPA ITU TIDAK APA-APA
 * Host eksternal diblokir dan tidak ada HLS sungguhan, jadi pemutarnya berakhir di keadaan
 * memuat/galat. Itu BUKAN kekurangan tes ini: keadaan itu persis yang dilihat pengunjung ketika
 * kamera sedang mati — dan tata letak, tautan, tombol, serta blok komersial harus tetap benar di
 * sana. Yang tidak diuji di sini hanyalah pemutaran itu sendiri.
 */

import { test, expect } from '@playwright/test';

const NAMA_PANJANG = 'SIMPANG-EMPAT-DENGAN-NAMA-KAMERA-YANG-SENGAJA-PANJANG-TANPA-SPASI-01';

const CAMERAS = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? NAMA_PANJANG : `CCTV TITIK ${i + 1}`,
    location: 'JL. LOKASI YANG JUGA SENGAJA PANJANG SEKALI NOMOR 128 RT 02 RW 09',
    area_id: 2,
    area_name: 'KEC BOJONEGORO DAN SEKITARNYA',
    status: 'active',
    enabled: 1,
    is_online: 1,
    camera_class: 'community',
    live_viewers: 12,
    total_views: 3456,
    enable_recording: 1,
    stream_key: 'sk_e2e',
    delivery_type: 'hls',
}));

/*
 * Tawaran afiliasi dipasang SENGAJA supaya slot popup benar-benar terisi.
 *
 * Tanpa ini slotnya kosong, tidak merender apa pun, dan larian ini akan mengukur popup yang blok
 * komersialnya tidak pernah ada — hijau, dan tidak membuktikan apa pun tentang satu-satunya blok
 * yang benar-benar menghasilkan uang. Kehampaan yang sama yang meloloskan bug strip 2026-08.
 */
const TAWARAN = {
    id: 4242,
    product_title: 'KAMERA CCTV OUTDOOR 5MP COLORVU DS-2CD1153G0-IUF-2.8MM-REV4-NAMA-PANJANG',
    description: 'Tahan hujan, night vision warna, audio dua arah — deskripsi sengaja panjang.',
    store_name: 'TOKO ELEKTRONIK SUMBER REJEKI ABADI JAYA MAKMUR SENTOSA',
    product_url: 'https://toko-rekanan.example/produk/kamera-outdoor-5mp',
    store_url: 'https://toko-rekanan.example/toko/sumber-rejeki',
    product_href: '/api/public/affiliate/offers/4242/go?l=p',
    store_href: '/api/public/affiliate/offers/4242/go?l=s',
    whatsapp_url: 'https://wa.me/6281234567890?text=Halo',
    price_rupiah: 1250000,
    image_base: null, image_width: null, image_height: null,
};

const API_FIXTURES = [
    [/^\/api\/public\/slot$/, { kind: 'affiliate', content: TAWARAN }],
    [/\/api\/cameras\/active/, CAMERAS],
    [/\/api\/cameras\/public/, CAMERAS],
    [/\/api\/areas\/public/, [{ id: 2, name: 'KEC BOJONEGORO DAN SEKITARNYA', slug: 'kec-bojonegoro' }]],
    [/\/api\/public\/trending-cameras/, CAMERAS],
    [/\/api\/public\/discovery/, { live_now: CAMERAS, top_cameras: CAMERAS, popular_areas: [], new_cameras: CAMERAS }],
];

const VIEWPORT = { width: 320, height: 720 };

test.beforeEach(async ({ page, context }) => {
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

/** Buka popup lewat jalan yang dipakai pengunjung sungguhan: mengklik kartu kameranya. */
async function bukaPopup(page) {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/?view=grid&mode=full', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const kartu = page.getByRole('button', { name: `Tonton ${NAMA_PANJANG}` });
    await expect(
        kartu,
        'kartu kamera tidak ada — daftar kameranya tidak dirender, jadi popup tidak bisa dibuka',
    ).toBeVisible({ timeout: 15_000 });
    await kartu.click();

    const popup = page.locator('[data-testid="grid-popup-modal"]');
    await expect(
        popup,
        'popup tidak terbuka setelah kartu diklik — tidak ada yang terukur setelah ini',
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(900);
    return popup;
}

/**
 * Lebar yang jujur untuk panel MELAYANG.
 *
 * `position: fixed` membuat popup ini tidak menyumbang apa pun ke scrollWidth dokumen maupun
 * <main>, jadi kedua angka itu tetap bersih berapa pun lebarnya. Yang benar: luberan panel
 * terhadap dirinya sendiri, dan elemen mana pun di dalamnya yang melewati tepi kanan layar.
 */
async function ukurPopup(page) {
    return page.evaluate(() => {
        const panel = document.querySelector('[data-testid="grid-popup-modal"]');
        if (!panel) return null;
        const lebarLayar = window.innerWidth;
        const pelanggar = [];

        /*
         * Isi di dalam bilah geser horizontal MEMANG melewati tepi layar — itu carousel, bukan
         * luberan; ia digulir, bukan lolos. Strip 'Terkait' di popup ini persis begitu
         * (overflow-x-auto + [contain:paint]).
         *
         * Versi pertama pengukur ini tidak membedakannya dan melaporkan lima 'pelanggar' yang
         * seluruhnya benar. Penjaga yang menuduh kode yang sehat akan dimatikan orang berikutnya,
         * dan setelah itu ia tidak menjaga apa pun.
         */
        const digulirMendatar = (el) => {
            for (let n = el.parentElement; n && n !== panel.parentElement; n = n.parentElement) {
                const ox = getComputedStyle(n).overflowX;
                if (ox === 'auto' || ox === 'scroll') return true;
            }
            return false;
        };

        for (const el of panel.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (digulirMendatar(el)) continue;
            if (r.right > lebarLayar + 1) {
                pelanggar.push(`${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 36)} → +${Math.round(r.right - lebarLayar)}px`);
            }
            if (pelanggar.length >= 5) break;
        }
        return {
            panelScrollW: panel.scrollWidth,
            panelClientW: panel.clientWidth,
            lebarLayar,
            pelanggar,
        };
    });
}

async function periksaPopup(page, label) {
    const m = await ukurPopup(page);
    expect(m, `${label}: panel popup hilang saat diukur`).not.toBeNull();
    expect(
        m.panelScrollW,
        `${label}: isi popup ${m.panelScrollW}px tidak muat di panel ${m.panelClientW}px`,
    ).toBeLessThanOrEqual(m.panelClientW + 1);
    expect(
        m.pelanggar,
        `${label}: ada isi popup yang melewati tepi kanan layar ${m.lebarLayar}px`,
    ).toEqual([]);
}

test('popup terbuka, tidak meluber, dan tetap begitu pada teks besar Android', async ({ page }) => {
    await bukaPopup(page);

    await periksaPopup(page, 'popup @320px');

    // Setelan "teks besar" (~1,5x) — yang mengubah baris yang sekadar sempit jadi keluar layar.
    await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
    await page.waitForTimeout(400);
    await periksaPopup(page, 'popup @320px @1,5x font');
});

test('tidak ada tautan mati di dalam popup', async ({ page }) => {
    const popup = await bukaPopup(page);

    const kosong = await popup.locator('a').evaluateAll((as) => as
        .filter((el) => (el.getAttribute('href') ?? '') === '')
        .map((el) => (el.textContent || '').trim().slice(0, 40) || '(tanpa teks)'));

    expect(
        kosong,
        'tautan berhref kosong di popup — mengkliknya hanya memuat ulang halaman',
    ).toEqual([]);
});

test('kontrol yang dipakai orang untuk keluar dan berbagi ada dan berlabel', async ({ page }) => {
    /*
     * Keduanya pernah jadi pertanyaan pemilik ("tombol bagikan dan kembali kenapa tidak sama?"),
     * dan keduanya adalah satu-satunya jalan keluar dari layar yang menutupi seluruh halaman.
     * Tombol tutup yang hilang di ponsel berarti pengunjung terjebak.
     */
    const popup = await bukaPopup(page);

    await expect(
        popup.getByRole('button', { name: 'Tutup' }).first(),
        'tidak ada tombol Tutup — popup menutupi seluruh layar dan pengunjung terjebak',
    ).toBeVisible();
    await expect(
        popup.getByRole('button', { name: /Bagikan/i }).first(),
        'tidak ada tombol Bagikan',
    ).toBeVisible();
});

test('SATU blok komersial di popup, dan ia menyebut permukaannya sendiri', async ({ page }) => {
    const popup = await bukaPopup(page);

    // Anti-kehampaan: fixture-nya memang menyediakan tawaran, jadi slotnya WAJIB terisi di sini.
    const kartuTawaran = popup.locator('[data-testid="affiliate-offer-card"]');
    await expect(
        kartuTawaran,
        'kartu tawaran tidak dirender, jadi larian ini mengukur popup tanpa blok komersialnya',
    ).toHaveCount(1, { timeout: 15_000 });

    const slot = popup.locator('[data-testid="commercial-slot"]');
    await expect(slot).toHaveAttribute('data-placement', 'popup');

    const terisi = await page.locator('[data-testid="commercial-slot"][data-kind]').count();
    expect(
        terisi,
        `${terisi} blok komersial tampil sekaligus — kelangkaannya itulah produknya`,
    ).toBeLessThanOrEqual(1);
});

test('menutup popup mengembalikan pengunjung ke halaman, bukan ke layar kosong', async ({ page }) => {
    const popup = await bukaPopup(page);

    await popup.getByRole('button', { name: 'Tutup' }).first().click();

    await expect(popup, 'popup tidak tertutup').toBeHidden({ timeout: 10_000 });
    // Dan halaman di belakangnya masih hidup — bukan sekadar popup yang hilang dari layar putih.
    await expect(page.getByRole('button', { name: `Tonton ${NAMA_PANJANG}` })).toBeVisible();
});
