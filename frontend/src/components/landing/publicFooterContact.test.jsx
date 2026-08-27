/*
 * Purpose: Kunci dua janji kaki halaman publik — tidak ada tombol mati, dan jalan masuk ke
 *          halaman jualan benar-benar ada.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Dua cacat yang ditemukan saat menyapu permukaan publik menjelang mencari sponsor, dan keduanya
 * TERBUKTI HIDUP di produksi hari itu:
 *
 *  1. Tombol "Hubungi Kami / WhatsApp" di kaki beranda dirender TANPA SYARAT, sementara
 *     buildWhatsappLink mengembalikan string kosong ketika nomornya belum diatur. Hasilnya
 *     `<a href="">` — mengklik tombol kontak utama hanya memuat ulang halaman. Diperiksa langsung
 *     di cctv.raf.my.id: href-nya memang kosong. Docstring helper-nya bahkan sudah memperingatkan
 *     pemanggil untuk bercabang di truthiness; pemanggil ini tidak.
 *
 *  2. /dukungan — satu-satunya halaman yang menjelaskan cara menjadi sponsor — tidak ditautkan
 *     dari mana pun. Satu-satunya rujukan ke jalur itu di seluruh repo adalah definisi rutenya
 *     sendiri. Halaman jualan yang hanya bisa dibuka oleh yang sudah tahu URL-nya sama saja
 *     dengan tidak ada.
 *
 * Keduanya tidak akan pernah memerahkan tes render biasa: yang pertama tetap merender sebuah
 * tombol, dan yang kedua adalah sesuatu yang TIDAK ADA.
 */

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LandingFooter from './LandingFooter';
import LandingPageSimple from './LandingPageSimple';

vi.mock('../../services/sponsorService', () => ({
    default: { getActiveSponsors: vi.fn().mockResolvedValue({ success: true, data: [] }) },
    getActiveSponsors: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));
vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({ cameras: [{ id: 1 }], areas: [{ id: 1 }], loading: false, dataUnavailable: false }),
}));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true, theme: 'dark' }) }));
vi.mock('../../contexts/BrandingContext', () => ({ useBranding: () => ({ branding: DASAR, loading: false }) }));
vi.mock('../../utils/animationControl', () => ({ shouldDisableAnimations: () => true }));
vi.mock('./LayoutModeToggle', () => ({ default: () => <div /> }));
vi.mock('./LandingPublicTopStack', () => ({ default: () => <div /> }));
vi.mock('./LandingDiscoveryStrip', () => ({ default: () => <div /> }));
vi.mock('../ads/InlineAdSlot', () => ({ default: () => <div /> }));
vi.mock('../FeedbackWidget', () => ({ default: () => <div /> }));
vi.mock('../SaweriaSupport', () => ({ default: () => <div /> }));
vi.mock('../commerce/CommercialSlot', () => ({ default: () => <div /> }));

const DASAR = {
    logo_text: 'R', company_name: 'RAF', company_description: 'Deskripsi',
    copyright_text: 'Pemantauan CCTV Publik', show_powered_by: 'true',
};

const penuh = (branding = DASAR) => render(
    <MemoryRouter>
        <LandingFooter saweriaEnabled={false} saweriaLink="" branding={branding} />
    </MemoryRouter>
);

const ringan = () => render(
    <MemoryRouter>
        <LandingPageSimple
            onCameraClick={vi.fn()} onAddMulti={vi.fn()} multiCameras={[]}
            saweriaEnabled={false} saweriaLink=""
            CamerasSection={() => <div>cameras</div>}
            layoutMode="simple" onLayoutToggle={vi.fn()}
            favorites={[]} onToggleFavorite={vi.fn()} isFavorite={() => false}
            viewMode="grid" setViewMode={vi.fn()}
            adsConfig={{ enabled: false }}
        />
    </MemoryRouter>
);

describe('tidak ada tombol kontak yang mati', () => {
    it('TANPA nomor: tombol WhatsApp tidak dirender sama sekali', () => {
        penuh({ ...DASAR, whatsapp_number: '' });

        expect(screen.queryByRole('link', { name: /WhatsApp/i })).toBeNull();
    });

    it('TANPA nomor: ajakan "Hubungi Kami" ikut hilang', () => {
        // Mengajak menghubungi tanpa memberi cara menghubungi lebih buruk daripada diam.
        penuh({ ...DASAR, whatsapp_number: '' });

        expect(screen.queryByText(/Hubungi Kami/i)).toBeNull();
    });

    it('DENGAN nomor: tombolnya kembali, dan href-nya BUKAN string kosong', () => {
        penuh({ ...DASAR, whatsapp_number: '081234567890' });

        const tautan = screen.getByRole('link', { name: /WhatsApp/i });
        expect(tautan.getAttribute('href')).not.toBe('');
        expect(tautan.getAttribute('href')).toContain('wa.me/6281234567890');
    });

    it('tidak ada satu pun tautan berhref kosong di kaki halaman', () => {
        // Penjaga bentuknya, bukan hanya kasus WhatsApp: <a href=""> mengklik dirinya sendiri.
        const { container } = penuh({ ...DASAR, whatsapp_number: '' });

        const kosong = [...container.querySelectorAll('a')]
            .filter((a) => (a.getAttribute('href') ?? '') === '');

        expect(kosong.map((a) => a.textContent.trim())).toEqual([]);
    });
});

describe('halaman jualan bisa ditemukan', () => {
    it('mode PENUH menautkan ke /dukungan', () => {
        penuh();

        const tautan = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/dukungan');
        expect(tautan, '/dukungan tidak ditautkan dari kaki halaman mode penuh').toBeTruthy();
    });

    it('mode RINGAN menautkan ke /dukungan', () => {
        ringan();

        const tautan = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/dukungan');
        expect(tautan, '/dukungan tidak ditautkan dari kaki halaman mode ringan').toBeTruthy();
    });

    it('teksnya menyebut sponsor, bukan kata "dukung" yang sudah dipakai tombol donasi', () => {
        // Kaki halaman sudah punya "Traktir Kopi" untuk donasi. Dua ajakan bernama mirip akan
        // membuat calon sponsor mengklik yang salah.
        penuh();

        const tautan = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/dukungan');
        expect(tautan.textContent.toLowerCase()).toContain('sponsor');
    });
});
