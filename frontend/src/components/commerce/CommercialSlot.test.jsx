/*
 * Purpose: Kunci kontrak satu slot komersial — satu penghuni, tidak pernah dua, tidak pernah
 *          rangka kosong.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Menggantikan AffiliateOfferSlot.test.jsx, dan mempertahankan setengah bagian yang masih benar:
 *   · resolve DITUNDA di balik IntersectionObserver dan menembak paling banyak sekali per
 *     pemasangan — GET itulah yang menghitung impresi di server, jadi ia harus berarti "bloknya
 *     sampai ke layar", bukan "sebuah popup dibuka",
 *   · tidak ada apa pun yang dirender selagi pengambilan berjalan — tanpa kerangka, tanpa kotak
 *     cadangan, karena slot ini duduk di bawah video yang sedang mulai dan mayoritas kamera tidak
 *     punya penghuni,
 *   · tanpa penghuni tidak ada strip SAMA SEKALI: kelas pembungkus tinggal di div dalam, jadi slot
 *     kosong tidak meninggalkan kotak bergaris maupun margin liar di permukaan mana pun,
 *   · berganti kamera membatalkan jawabannya,
 *   · resolve yang gagal tidak bisa dibedakan dari "tidak ada penghuni" — pengunjung tidak pernah
 *     melihat galat untuk blok komersial yang gagal dimuat.
 *
 * DAN SATU YANG BARU, yang menjadi alasan komponen ini ada: dua penghuni tidak boleh pernah
 * dirender bersamaan. Sebelum arbiter, kartu afiliasi dan banner promo dipasang berdampingan di
 * lima permukaan dan keduanya bisa tampil sekaligus di layar ponsel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CommercialSlot from './CommercialSlot.jsx';

const { resolveCommercialSlotOnce } = vi.hoisted(() => ({ resolveCommercialSlotOnce: vi.fn() }));
const { countAffiliateClick } = vi.hoisted(() => ({ countAffiliateClick: vi.fn() }));
const { trackPromoBannerClick, getPublicPromoBanner } = vi.hoisted(() => ({
    trackPromoBannerClick: vi.fn(), getPublicPromoBanner: vi.fn(),
}));

vi.mock('../../services/commercialSlotService.js', () => ({ resolveCommercialSlotOnce }));
vi.mock('../../services/affiliateService', () => ({
    countAffiliateClick,
    AFFILIATE_LINK: Object.freeze({ PRODUCT: 'p', STORE: 's', WHATSAPP: 'w' }),
}));
vi.mock('../../services/promoBannerService', () => ({ getPublicPromoBanner, trackPromoBannerClick }));

const TAWARAN = {
    id: 12,
    product_title: 'Kamera IP Outdoor 3MP',
    store_name: 'Toko Sinar Elektronik',
    product_url: 'https://toko-sinar.example/produk',
    store_url: 'https://toko-sinar.example',
    product_href: '/api/public/affiliate/offers/12/go?l=p',
    store_href: '/api/public/affiliate/offers/12/go?l=s',
    whatsapp_url: null, price_rupiah: 150000,
    image_base: null, image_width: null, image_height: null,
};
const PROMO = { id: 3, title: 'Pemasangan CCTV Gratis', alt_text: 'Promo pemasangan',
    image_base: 'promo-3', image_width: 800, image_height: 400,
    cta_label: 'Tanya Pemasangan', cta_url: 'https://wa.me/628123' };

/* Kelas pembungkus milik HOST, bukan komponen. Yang diuji: ia mendarat di div dalam dan tidak di
   tempat lain, sehingga slot kosong tidak meninggalkan kotak bergaris. */
const KELAS = 'border-t border-edge bg-surface px-3 py-3';
const SELEKTOR = `.${KELAS.split(' ').join('.')}`;

/* Permukaan yang SENGAJA bukan 'popup': fixture yang memakai nilai historis itu tetap lulus
   terhadap komponen yang mengabaikan prop dan mengeraskan 'popup' di dalam dirinya. */
const PERMUKAAN = 'area';
const Slot = (props) => <CommercialSlot placement={PERMUKAAN} className={KELAS} {...props} />;

beforeEach(() => {
    vi.clearAllMocks();
    // jsdom tidak punya IntersectionObserver, jadi komponennya mengambil langsung — perilaku yang
    // diinginkan mayoritas tes di sini. Penundaannya diuji sendiri di blok terakhir.
    delete globalThis.IntersectionObserver;
    resolveCommercialSlotOnce.mockResolvedValue(null);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('satu penghuni, dan hanya satu', () => {
    it('merender kartu afiliasi saat itu pemenangnya', async () => {
        resolveCommercialSlotOnce.mockResolvedValue({ kind: 'affiliate', content: TAWARAN });

        render(<Slot cameraId={11} />);

        await screen.findByTestId('affiliate-offer-card');
        expect(screen.getByText(TAWARAN.product_title)).not.toBeNull();
    });

    it('merender promo saat itu pemenangnya, TANPA mengambil datanya sendiri', async () => {
        resolveCommercialSlotOnce.mockResolvedValue({ kind: 'promo', content: PROMO });

        render(<Slot cameraId={11} />);

        await screen.findByAltText(PROMO.alt_text);
        expect(getPublicPromoBanner, 'promo mengambil datanya sendiri = impresi dihitung dua kali')
            .not.toHaveBeenCalled();
    });

    it('TIDAK PERNAH merender keduanya sekaligus', async () => {
        resolveCommercialSlotOnce.mockResolvedValue({ kind: 'affiliate', content: TAWARAN });

        const { container } = render(<Slot cameraId={11} />);

        await screen.findByTestId('affiliate-offer-card');
        expect(container.querySelectorAll('img[alt]').length, 'poster promo ikut terpasang').toBe(0);
        expect(container.querySelectorAll('[data-testid="affiliate-offer-card"]').length).toBe(1);
    });

    it('menandai jenis penghuninya di DOM, terbaca dari tes peramban', async () => {
        resolveCommercialSlotOnce.mockResolvedValue({ kind: 'promo', content: PROMO });

        render(<Slot cameraId={11} />);

        await waitFor(() => {
            expect(screen.getByTestId('commercial-slot').getAttribute('data-kind')).toBe('promo');
        });
    });
});

describe('slot kosong tidak meninggalkan jejak', () => {
    it('tanpa penghuni tidak ada strip sama sekali', async () => {
        const { container } = render(<Slot cameraId={11} />);

        await waitFor(() => expect(resolveCommercialSlotOnce).toHaveBeenCalled());
        expect(container.querySelector(SELEKTOR), 'kotak bergaris kosong').toBeNull();
        expect(container.querySelector('[data-testid="affiliate-offer-card"]')).toBeNull();
    });

    it('tidak merender apa pun selagi pengambilan masih berjalan', () => {
        resolveCommercialSlotOnce.mockReturnValue(new Promise(() => {}));

        const { container } = render(<Slot cameraId={11} />);

        expect(container.querySelector(SELEKTOR)).toBeNull();
        expect(screen.getByTestId('commercial-slot').getAttribute('data-kind')).toBeNull();
    });

    it('resolve yang gagal tidak bisa dibedakan dari "tidak ada penghuni"', async () => {
        // Layanannya menelan galatnya sendiri dan mengembalikan null; pengunjung tidak pernah
        // melihat galat untuk blok komersial.
        resolveCommercialSlotOnce.mockResolvedValue(null);

        const { container } = render(<Slot cameraId={11} />);

        await waitFor(() => expect(resolveCommercialSlotOnce).toHaveBeenCalled());
        expect(container.querySelector(SELEKTOR)).toBeNull();
    });
});

describe('konteks', () => {
    it('meminta permukaan yang diberikan pemanggil, bukan nilai yang dikeraskan', async () => {
        render(<Slot cameraId={11} />);

        await waitFor(() => {
            expect(resolveCommercialSlotOnce).toHaveBeenCalledWith({
                placement: PERMUKAAN, cameraId: 11, areaId: null,
            });
        });
    });

    it('berganti kamera membatalkan jawabannya', async () => {
        resolveCommercialSlotOnce.mockResolvedValue({ kind: 'affiliate', content: TAWARAN });
        const { rerender } = render(<Slot cameraId={11} />);
        await screen.findByTestId('affiliate-offer-card');

        resolveCommercialSlotOnce.mockResolvedValue(null);
        rerender(<Slot cameraId={99} />);

        await waitFor(() => {
            expect(screen.queryByTestId('affiliate-offer-card'), 'penghuni kamera lama menggantung').toBeNull();
        });
    });

    it('membawa konteks area tanpa kamera - bentuk yang dipasang halaman area', async () => {
        render(<CommercialSlot placement="area" areaId={3} className={KELAS} />);

        await waitFor(() => {
            expect(resolveCommercialSlotOnce).toHaveBeenCalledWith({
                placement: 'area', cameraId: null, areaId: 3,
            });
        });
    });

    it('meminta ulang ketika HANYA permukaannya yang berganti', async () => {
        resolveCommercialSlotOnce.mockResolvedValue({ kind: 'affiliate', content: TAWARAN });
        const { rerender } = render(<CommercialSlot placement="area" cameraId={11} className={KELAS} />);
        await screen.findByTestId('affiliate-offer-card');

        rerender(<CommercialSlot placement="playback" cameraId={11} className={KELAS} />);

        await waitFor(() => {
            expect(resolveCommercialSlotOnce).toHaveBeenLastCalledWith({
                placement: 'playback', cameraId: 11, areaId: null,
            });
        });
    });

    it('meneruskan URL toko yang SUNGGUHAN ke kartu, bukan pengalihnya', async () => {
        // Muatan v2 membawa keduanya; kartu harus memakai URL asli supaya pengunjung melihat
        // tujuan yang benar di bilah status peramban sebelum mengklik.
        resolveCommercialSlotOnce.mockResolvedValue({ kind: 'affiliate', content: TAWARAN });

        render(<Slot cameraId={11} />);

        const tautan = await screen.findByRole('link', { name: /Lihat barang/i });
        expect(tautan.getAttribute('href')).toBe(TAWARAN.product_url);
        expect(tautan.getAttribute('href')).not.toContain('/api/public/affiliate');
    });

    it('menyebut permukaannya di DOM, supaya lima pemasangan bisa dibedakan', async () => {
        render(<Slot cameraId={11} />);

        await waitFor(() => {
            expect(screen.getByTestId('commercial-slot').getAttribute('data-placement')).toBe(PERMUKAAN);
        });
    });
});

describe('pengambilan ditunda sampai slotnya mendekati layar', () => {
    /*
     * GET-nya menghitung impresi di server. Tanpa penundaan ini, "impresi" hanya berarti sebuah
     * popup dibuka - bukan bahwa blok itu benar-benar sampai ke layar seseorang.
     */
    it('tidak mengambil apa pun sebelum slotnya berpotongan dengan layar', () => {
        const amati = vi.fn();
        globalThis.IntersectionObserver = class {
            constructor(cb) { this.cb = cb; }
            observe(...a) { amati(...a); }
            disconnect() {}
        };

        render(<Slot cameraId={11} />);

        expect(amati).toHaveBeenCalledTimes(1);
        expect(resolveCommercialSlotOnce, 'mengambil sebelum terlihat').not.toHaveBeenCalled();
    });

    it('mengambil sekali saat berpotongan, dan memutus pengamatnya lebih dulu', async () => {
        let picu = null;
        const putus = vi.fn();
        // Pengamat sungguhan BERHENTI menembak sesudah disconnect; mock yang tidak menghormati itu
        // menguji simulasinya sendiri, bukan komponennya.
        globalThis.IntersectionObserver = class {
            constructor(cb) { this.hidup = true; picu = (e) => { if (this.hidup) cb(e); }; }
            observe() {}
            disconnect() { this.hidup = false; putus(); }
        };
        resolveCommercialSlotOnce.mockResolvedValue({ kind: 'affiliate', content: TAWARAN });

        render(<Slot cameraId={11} />);
        picu([{ isIntersecting: true }]);
        picu([{ isIntersecting: true }]);   // menggulir lagi tidak boleh mengantre impresi kedua

        await screen.findByTestId('affiliate-offer-card');
        expect(resolveCommercialSlotOnce).toHaveBeenCalledTimes(1);
        expect(putus).toHaveBeenCalled();
    });
});
