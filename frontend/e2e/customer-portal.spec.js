/*
 * Purpose: Penjaga real-browser untuk portal pelanggan (/my/*) dan pendaftaran (/daftar).
 * Caller: Playwright (npm run test:e2e).
 * Deps: Build produksi yang disajikan `vite preview`; seluruh API dipalsukan; auth dipalsukan
 *       lewat localStorage, sama seperti admin-overflow.spec.js.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Sampai 2026-08-28 portal pelanggan punya NOL cakupan peramban. Bukan permukaan sepi: 11 akun
 * pelanggan nyata bisa masuk ke sana di produksi, 10 token playback sudah terbit, dan halaman
 * dompet menampilkan saldo rupiah orang. Satu-satunya permukaan yang sudah dijaga adalah publik
 * (overflow.spec.js) dan admin (admin-overflow.spec.js) — pelanggan berada persis di antaranya
 * dan terlewat oleh keduanya.
 *
 * TIGA HAL YANG DIUKUR, dan semuanya lahir dari cacat yang benar-benar terjadi di repo ini:
 *
 *  1. HALAMANNYA BENAR-BENAR TAMPIL. Anti-kehampaan. Tanpa ini sebuah larian yang gagal auth,
 *     gagal fixture, atau berhenti di spinner tetap HIJAU sambil mengukur halaman kosong — dan
 *     halaman kosong tidak bisa meluber, tidak bisa punya tautan mati, tidak bisa apa-apa.
 *
 *  2. TIDAK MELUBER KE SAMPING, di layar ponsel dan pada font 1,5x (setelan "teks besar" Android).
 *     Diukur lewat main.scrollWidth, BUKAN documentElement: `overflow-x: clip` di html/body plus
 *     <main> yang jadi kontainer gulir sendiri membuat root berbohong 320/320 sementara tata
 *     letaknya 689px — pelajaran yang sudah dibayar mahal di admin-overflow.spec.js.
 *
 *  3. TIDAK ADA <a href="">. Tautan begitu mengklik dirinya sendiri; halaman sekadar memuat ulang
 *     dan penggunanya menyimpulkan tombolnya rusak. Ditemukan hidup di kaki beranda produksi
 *     2026-08-27 dan sudah disapukan ke publik + 30 rute admin; pelanggan bagian yang tersisa.
 *
 * FIXTURE-NYA SENGAJA KASUS TERBURUK, bukan yang masuk akal. Nama panjang tanpa spasi, token yang
 * tidak bisa dipatahkan, rupiah delapan digit: nilai yang wajar tidak bisa meluberkan apa pun, dan
 * larian yang mengukur nilai wajar adalah larian yang hijau tanpa membuktikan apa-apa.
 */

import { test, expect } from '@playwright/test';

/* Satu runtun tanpa spasi — bentuk yang mengalahkan pembungkusan kata di setiap kartu. */
const NAMA_PANJANG = 'PELANGGAN-DENGAN-NAMA-SANGAT-PANJANG-TANPA-SPASI-SAMA-SEKALI-0001';
const EMAIL_PANJANG = 'pelanggan.dengan.alamat.surel.yang.sengaja.panjang@contoh-domain-panjang.example';
const TOKEN_PANJANG = 'VVC9E2XA0001BAGIKANREKAMANKELUARGABAPAKSOMODIHARJOTANPAPEMISAH';

const CUSTOMER_USER = {
    id: 42,
    username: NAMA_PANJANG,
    email: EMAIL_PANJANG,
    role: 'customer',
    full_name: NAMA_PANJANG,
};

const KAMERA = Array.from({ length: 3 }, (_, i) => ({
    id: 1500 + i,
    name: `CCTV ${NAMA_PANJANG} TITIK ${i + 1}`,
    location: 'Jalan Dengan Nama Yang Juga Sengaja Dibuat Panjang Sekali Nomor 128',
    area_name: 'DS TANJUNGHARJO',
    camera_class: 'subscriber',
    billing_status: i === 0 ? 'active' : 'suspended',
    enabled: 1,
    status: 'active',
    enable_recording: 1,
    recording_duration_hours: 168,
    is_live: i === 0,
    stream_url: null,
}));

const PAKET = {
    key: 'bisnis',
    name: 'PAKET BISNIS DENGAN NAMA YANG SENGAJA SANGAT PANJANG UNTUK MENGUJI BARIS',
    price_per_camera: 10000,
    recording_price_per_camera: 5000,
    recording_retention_days: 30,
    max_cameras: 10,
    is_trial: false,
};

/* Rupiah delapan digit: angka mono yang paling lebar yang bisa muncul sungguhan di dompet. */
const DOMPET = {
    balance_rupiah: 12345678,
    total_topup_rupiah: 98765432,
    total_spent_rupiah: 86419754,
    currency: 'IDR',
};

const PEMBAYARAN = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    amount_rupiah: 1250000 + i,
    status: ['paid', 'pending', 'expired', 'failed'][i % 4],
    method: 'QRIS-DENGAN-NAMA-METODE-PANJANG',
    reference: `INV-2026-08-28-${String(i).padStart(6, '0')}-REFERENSI-PANJANG`,
    created_at: '2026-08-28 09:15:00',
}));

const TOKEN = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    label: `Token Keluarga ${NAMA_PANJANG} Nomor ${i + 1}`,
    token_prefix: TOKEN_PANJANG.slice(0, 8 + i),
    share_url: `https://cctv.raf.my.id/playback?t=${TOKEN_PANJANG}`,
    camera_id: 1500,
    expires_at: '2026-12-31 23:59:59',
    revoked_at: null,
}));

const RINGKASAN = {
    balance_rupiah: DOMPET.balance_rupiah,
    active_cameras: 1,
    suspended_cameras: 2,
    plan: PAKET,
    next_billing_date: '2026-09-28',
    daily_cost_rupiah: 15000,
};

/*
 * Cocokkan jalur PALING SPESIFIK lebih dulu: `/api/customer/plans` (katalog) dan
 * `/api/customer/plan` (milik pelanggan ini) berbeda, dan pola yang longgar akan menjawab yang
 * satu dengan muatan yang lain — halaman lalu merender bentuk yang salah dan tetap hijau.
 */
const API_FIXTURES = [
    [/^\/api\/customer\/summary$/, RINGKASAN],
    [/^\/api\/customer\/cameras$/, KAMERA],
    [/^\/api\/customer\/plans$/, [PAKET]],
    [/^\/api\/customer\/plan$/, { ...PAKET, cameras: KAMERA.length }],
    [/^\/api\/customer\/wallet$/, DOMPET],
    [/^\/api\/customer\/payments$/, PEMBAYARAN],
    [/^\/api\/customer\/payment-options$/, { methods: [{ key: 'qris', label: 'QRIS', enabled: true }] }],
    [/^\/api\/customer\/playback-tokens$/, TOKEN],
    [/^\/api\/public\/billing\/plans$/, [PAKET]],
    [/^\/api\/users\/profile$/, CUSTOMER_USER],
];

const PAGES = [
    // Pendaftaran itu PUBLIK — corong sewa dimulai di sini, dan sampai hari ini tak pernah diukur.
    /*
     * Pendaftaran mandiri SENGAJA ditutup di produksi, jadi halaman ini adalah pemberitahuan
     * pendek — dan ia tidak punya <main> sama sekali. Yang dijaga di sini justru keadaan yang
     * benar-benar dilihat orang: pemberitahuannya terbaca, dan jalan keluarnya (Masuk) hidup.
     */
    { name: 'daftar (pendaftaran ditutup)', url: '/daftar', anon: true, ready: /Pendaftaran mandiri sedang ditutup/i },
    { name: 'my — kamera saya', url: '/my', ready: /Kamera|Belum ada kamera/i },
    { name: 'my/paket', url: '/my/paket', ready: /Paket/i },
    { name: 'my/wallet', url: '/my/wallet', ready: /Saldo|Total masuk|Nominal/i },
    { name: 'my/akun', url: '/my/akun', ready: /Profil Akun|Username/i },
    { name: 'my/panduan', url: '/my/panduan', ready: /Panduan|Status/i },
    { name: 'my/rekaman', url: '/my/rekaman', ready: /Rekaman/i },
];

/* Ponsel kecil: 320px masih dipakai, dan ia yang pertama pecah. */
const VIEWPORT = { width: 320, height: 720 };

test.beforeEach(async ({ page, context }) => {
    await page.addInitScript((user) => {
        window.localStorage.setItem('user', JSON.stringify(user));
    }, CUSTOMER_USER);

    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        // Host eksternal diblokir: larian ini harus deterministik dan tidak boleh menyentuh jaringan.
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

/**
 * Lebar yang JUJUR untuk halaman berlayout.
 *
 * documentElement tidak bisa dipakai: `overflow-x: clip` di html/body menjepit rect gulir root,
 * dan <main> sendiri kontainer gulir yang MENYERAP luberan isinya. Yang tersisa sebagai angka
 * benar adalah luberan kontainernya sendiri, plus tiap elemen yang melewati tepi kanan <main>.
 */
async function ukurLuberan(page) {
    return page.evaluate(() => {
        const main = document.querySelector('main') || document.body;
        const batas = main.getBoundingClientRect();
        const pelanggar = [];
        for (const el of main.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            const style = getComputedStyle(el);
            if (style.position === 'fixed') continue;
            if (r.right > batas.right + 1) {
                pelanggar.push(`${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 40)} → ${Math.round(r.right - batas.right)}px`);
            }
            if (pelanggar.length >= 5) break;
        }
        return {
            mainScrollW: main.scrollWidth,
            mainClientW: main.clientWidth,
            pelanggar,
        };
    });
}

async function periksaLuberan(page, label) {
    const m = await ukurLuberan(page);
    expect(
        m.mainScrollW,
        `${label}: isi ${m.mainScrollW}px tidak muat di kontainer ${m.mainClientW}px — ${m.pelanggar.join(' | ') || 'tanpa elemen tunggal yang menonjol'}`,
    ).toBeLessThanOrEqual(m.mainClientW + 1);
}

for (const spec of PAGES) {
    test(`portal pelanggan sehat: ${spec.name}`, async ({ page }) => {
        await page.setViewportSize(VIEWPORT);
        await page.goto(spec.url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(600);

        // (1) Anti-kehampaan — halaman kosong tidak bisa gagal pada apa pun di bawah ini.
        // Halaman anonim tanpa <main> dicari di seluruh dokumen; halaman berlayout DIBATASI ke
        // <main> supaya teks navigasi tidak bisa memalsukan 'halamannya tampil'.
        const penanda = spec.anon
            ? page.getByText(spec.ready).first()
            : page.locator('main').getByText(spec.ready).first();
        await expect(
            penanda,
            `${spec.name}: tidak merender (auth palsu gagal, fixture ditolak, atau berhenti di spinner) — tidak ada yang terukur`,
        ).toBeVisible({ timeout: 15_000 });

        // (2) Tidak ada tautan mati.
        const hrefKosong = await page.$$eval('a', (as) => as
            .filter((el) => (el.getAttribute('href') ?? '') === '')
            .map((el) => (el.textContent || '').trim().slice(0, 40) || '(tanpa teks)'));
        expect(
            hrefKosong,
            `${spec.name}: tautan berhref kosong — mengkliknya hanya memuat ulang halaman`,
        ).toEqual([]);

        // (3) Tidak meluber, pada ukuran normal DAN pada "teks besar" Android.
        await periksaLuberan(page, `${spec.name} @320px`);

        await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
        await page.waitForTimeout(300);
        await periksaLuberan(page, `${spec.name} @320px @1,5x font`);
    });
}
