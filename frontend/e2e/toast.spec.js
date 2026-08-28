/*
 * Purpose: Penjaga real-browser untuk POPUP NOTIFIKASI (toast) — bentuk, keterbacaan, dan
 *          keterjangkauan tombol tutupnya, di layar ponsel sampai tablet.
 * Caller: Playwright (npm run test:e2e).
 * Deps: Build produksi via `vite preview`; API dipalsukan; sesi admin dipalsukan di localStorage.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Toast adalah satu-satunya cara aplikasi ini memberi tahu operator bahwa perbuatannya berhasil
 * atau gagal — dan sampai 2026-08-28 ia TIDAK PERNAH diukur di peramban sungguhan. Yang ada hanya
 * asersi kelas CSS di jsdom, dan jsdom tidak menghitung tata letak sama sekali: ia tidak bisa
 * melihat lebar, posisi, tumpang tindih, maupun warna latar yang benar-benar tercat.
 *
 * Kebutaan itu sudah memakan korban: keempat jenis toast berlatar tint 10% — 90% TEMBUS PANDANG —
 * sehingga teks halaman terbaca menembusnya dan kata-katanya bertumpuk. Dilaporkan pemiliknya,
 * bukan ditemukan tes. Berkas ini menutup kelas kegagalan itu di tempat yang bisa melihatnya.
 *
 * KENAPA TOAST TIDAK BISA DIUKUR LEWAT scrollWidth HALAMAN
 * Wadahnya `position: fixed`. Subtree di luar alur normal tidak menyumbang apa pun ke
 * documentElement maupun <main>, jadi seluruh mesin ukur luberan yang sudah ada memandangnya
 * sebagai nol — persis seperti popup kamera. Yang jujur adalah kotak toast itu sendiri terhadap
 * viewport.
 *
 * KENAPA /admin/sponsors
 * Halaman itu memanggil notifyError saat pemuatan sponsor gagal, jadi satu respons `success:false`
 * memunculkan toast SUNGGUHAN lewat jalur yang sama persis dengan yang dilihat operator. Tidak ada
 * suntikan, tidak ada komponen yang dirender di luar konteksnya.
 *
 * CATATAN CAKUPAN: portal pelanggan TIDAK memunculkan toast sama sekali (nol pemakaian
 * useNotification di pages/customer). Jadi toast adalah permukaan admin, dan diuji sebagai admin.
 */

import { test, expect } from '@playwright/test';

const ADMIN_USER = {
    id: 1, username: 'e2e-admin', email: 'admin@example.invalid',
    role: 'admin', full_name: 'Operator Uji Otomatis',
};

/*
 * Pesan galat KASUS TERBURUK: satu runtun tanpa spasi, bentuk yang mengalahkan pembungkusan kata.
 * Pesan galat nyata memang begini — nama berkas, URL, kode dari server.
 */
const PESAN_PANJANG = 'Gagal-memuat-sponsor-dari-server-karena-koneksi-basis-data-terputus-KODE-ERR_CONN_RESET_0xDEADBEEF';

const VIEWPORTS = [
    { label: '320px', width: 320, height: 640 },
    { label: '393px', width: 393, height: 851 },
    { label: '768px', width: 768, height: 1024 },
];

test.beforeEach(async ({ page, context }) => {
    await page.addInitScript((u) => {
        window.localStorage.setItem('user', JSON.stringify(u));
    }, ADMIN_USER);

    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        if (!local) return route.abort();
        if (url.pathname === '/api/sponsors') {
            // Jalur yang memunculkan toast: halaman memanggil notifyError untuk respons gagal.
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, message: PESAN_PANJANG }),
            });
        }
        if (url.pathname.startsWith('/api/')) {
            return route.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ success: true, data: [] }),
            });
        }
        return route.continue();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

/** Buka halaman yang gagal memuat, lalu tunggu toast-nya benar-benar ada. */
async function munculkanToast(page, vp) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/admin/sponsors', { waitUntil: 'networkidle' });

    const toast = page.getByRole('alert').first();
    await expect(
        toast,
        'toast tidak muncul — jalur notifikasinya putus, dan tidak ada yang terukur setelah ini',
    ).toBeVisible({ timeout: 15_000 });
    return toast;
}

/** Kotak toast terhadap viewport, plus luberan isinya terhadap dirinya sendiri. */
async function ukurToast(page) {
    return page.evaluate(() => {
        const el = document.querySelector('[role="alert"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const gaya = getComputedStyle(el);
        const tutup = el.querySelector('[aria-label="Dismiss notification"]');
        const rt = tutup?.getBoundingClientRect();
        return {
            kiri: Math.round(r.left),
            kanan: Math.round(r.right),
            lebarLayar: window.innerWidth,
            isiLebih: el.scrollWidth - el.clientWidth,
            latar: gaya.backgroundColor,
            tutupW: rt ? Math.round(rt.width) : 0,
            tutupH: rt ? Math.round(rt.height) : 0,
        };
    });
}

/** Alpha dari `rgb()`/`rgba()`. Tanpa alpha = opak. */
function alphaDari(warna) {
    const bagian = (warna.match(/[\d.]+/g) || []).map(Number);
    return bagian.length >= 4 ? bagian[3] : 1;
}

for (const vp of VIEWPORTS) {
    test(`toast sehat @${vp.label}`, async ({ page }) => {
        await munculkanToast(page, vp);
        const m = await ukurToast(page);

        expect(m.kanan, `toast melewati tepi kanan layar ${m.lebarLayar}px`).toBeLessThanOrEqual(m.lebarLayar + 1);
        expect(m.kiri, 'toast dimulai di luar tepi kiri layar').toBeGreaterThanOrEqual(-1);
        expect(m.isiLebih, 'isi toast tidak muat di dalam toast-nya sendiri').toBeLessThanOrEqual(1);
    });

    test(`toast tetap begitu pada teks besar Android @${vp.label}`, async ({ page }) => {
        await munculkanToast(page, vp);
        await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
        await page.waitForTimeout(300);

        const m = await ukurToast(page);

        expect(m.kanan, `toast melewati tepi kanan pada font 1,5x`).toBeLessThanOrEqual(m.lebarLayar + 1);
        expect(m.kiri, 'toast dimulai di luar tepi kiri pada font 1,5x').toBeGreaterThanOrEqual(-1);
        expect(m.isiLebih, 'isi toast meluber dari toast-nya pada font 1,5x').toBeLessThanOrEqual(1);
    });
}

test('toast benar-benar OPAK di peramban, bukan sekadar bernama kelas opak', async ({ page }) => {
    /*
     * Pembuktian sungguhan untuk perbaikan 2026-08-27. Tes jsdom hanya bisa memastikan nama kelas
     * `bg-surface-overlay` ada; hanya peramban yang bisa menjawab warna apa yang BENAR-BENAR
     * tercat. Kalau alpha-nya turun lagi di bawah 1, teks halaman akan terbaca menembusnya lagi.
     */
    await munculkanToast(page, VIEWPORTS[0]);
    const m = await ukurToast(page);

    expect(
        alphaDari(m.latar),
        `latar toast ${m.latar} tembus pandang — teks halaman akan terbaca menembusnya`,
    ).toBeGreaterThanOrEqual(0.9);
});

test('tombol tutupnya cukup besar untuk jari', async ({ page }) => {
    /*
     * WCAG 2.5.8 (AA, WCAG 2.2) menuntut sasaran ketuk minimal 24x24 CSS px. Toast menutupi
     * sudut layar dan hilang sendiri dalam 5-8 detik; kalau tombol tutupnya meleset saat ditekan,
     * operator menekan apa pun yang ada DI BAWAHNYA.
     */
    await munculkanToast(page, VIEWPORTS[0]);
    const m = await ukurToast(page);

    expect(m.tutupW, `lebar sasaran ketuk ${m.tutupW}px`).toBeGreaterThanOrEqual(24);
    expect(m.tutupH, `tinggi sasaran ketuk ${m.tutupH}px`).toBeGreaterThanOrEqual(24);
});

test('toast bisa ditutup, dan menutupnya membuka kembali halaman di bawahnya', async ({ page }) => {
    const toast = await munculkanToast(page, VIEWPORTS[0]);

    await toast.getByRole('button', { name: 'Dismiss notification' }).click();

    await expect(toast, 'toast tidak hilang setelah ditutup').toBeHidden({ timeout: 5_000 });
});
