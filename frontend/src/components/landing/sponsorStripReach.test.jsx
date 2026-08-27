/*
 * Purpose: Kunci bahwa strip sponsor terlihat di KEDUA mode beranda publik, bukan hanya mode penuh.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Yang dijanjikan ke calon sponsor adalah "logo Anda di beranda". Beranda punya dua mode, dan
 * strip itu selama ini hanya dipasang di LandingFooter — yang hanya dirender mode PENUH. Pengunjung
 * mode ringan tidak pernah melihat satu pun sponsor, dan tidak ada yang bisa mengetahuinya dari
 * tes mana pun: strip menyembunyikan diri saat tidak ada sponsor aktif, dan sampai hari ini
 * memang nol sponsor. Jadi mode penuh dan mode ringan terlihat sama persis — sampai ada yang
 * tanda tangan, lalu setengah janjinya tidak ditepati tanpa suara.
 *
 * Tes ini memasang SATU sponsor aktif, dan menuntut namanya muncul di dua-duanya.
 */

// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingFooter from './LandingFooter';
import LandingPageSimple from './LandingPageSimple';

const { getActiveSponsors } = vi.hoisted(() => ({ getActiveSponsors: vi.fn() }));
vi.mock('../../services/sponsorService', () => ({
    default: { getActiveSponsors },
    getActiveSponsors,
}));

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({ cameras: [{ id: 1 }, { id: 2 }], areas: [{ id: 1 }], loading: false, dataUnavailable: false }),
}));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true, theme: 'dark' }) }));
vi.mock('../../contexts/BrandingContext', () => ({ useBranding: () => ({ branding: BRANDING, loading: false }) }));
vi.mock('../../utils/animationControl', () => ({
    shouldAnimate: () => false, useReducedMotion: () => true, shouldDisableAnimations: () => true,
}));
vi.mock('./LayoutModeToggle', () => ({ default: () => <div /> }));
vi.mock('./LandingPublicTopStack', () => ({ default: () => <div /> }));
vi.mock('./LandingDiscoveryStrip', () => ({ default: () => <div /> }));
vi.mock('../ads/InlineAdSlot', () => ({ default: () => <div /> }));
vi.mock('../FeedbackWidget', () => ({ default: () => <div /> }));
vi.mock('../SaweriaSupport', () => ({ default: () => <div /> }));

const BRANDING = {
    logo_text: 'R', company_name: 'RAF', company_description: 'Deskripsi',
    copyright_text: 'Pemantauan CCTV Publik', meta_keywords: 'cctv',
    whatsapp_number: '628111111111', show_powered_by: 'true',
};

/* Satu sponsor, tingkat mana pun. Yang diuji jangkauan, bukan tata letak tingkatnya. */
const SPONSOR = {
    id: 1, name: 'CV DISTRIBUTOR CCTV NUSANTARA', logo: null, url: 'https://distributor.example',
    package: 'utama', package_name: 'Sponsor Utama', package_color: 'yellow', package_sort_order: 1,
};

beforeEach(() => {
    getActiveSponsors.mockReset();
    getActiveSponsors.mockResolvedValue({ success: true, data: [SPONSOR] });
});

const propsSimple = {
    onCameraClick: vi.fn(), onAddMulti: vi.fn(), multiCameras: [],
    saweriaEnabled: false, saweriaLink: '',
    CamerasSection: () => <div>cameras</div>,
    layoutMode: 'simple', onLayoutToggle: vi.fn(),
    favorites: [], onToggleFavorite: vi.fn(), isFavorite: () => false,
    viewMode: 'grid', setViewMode: vi.fn(),
    adsConfig: { enabled: false },
};

describe('jangkauan strip sponsor', () => {
    it('mode PENUH menampilkan sponsor', async () => {
        render(<MemoryRouter><LandingFooter saweriaEnabled={false} saweriaLink="" branding={BRANDING} /></MemoryRouter>);

        expect(await screen.findByTestId('landing-sponsor-strip')).toBeTruthy();
        expect(screen.getByTitle(SPONSOR.name)).toBeTruthy();
    });

    it('mode RINGAN menampilkan sponsor yang sama', async () => {
        render(<MemoryRouter><LandingPageSimple {...propsSimple} /></MemoryRouter>);

        expect(await screen.findByTestId('landing-sponsor-strip')).toBeTruthy();
        expect(screen.getByTitle(SPONSOR.name)).toBeTruthy();
    });

    it('tanpa sponsor aktif, mode ringan tidak menumbuhkan apa pun di footernya', async () => {
        // Strip yang merender kerangka kosong akan mengubah tata letak footer di hari nol sponsor -
        // dan itulah alasan pemasangannya bisa dilakukan sekarang, jauh sebelum ada yang tanda tangan.
        getActiveSponsors.mockResolvedValue({ success: true, data: [] });

        render(<MemoryRouter><LandingPageSimple {...propsSimple} /></MemoryRouter>);

        await waitFor(() => expect(getActiveSponsors).toHaveBeenCalled());
        expect(screen.queryByTestId('landing-sponsor-strip')).toBeNull();
    });

    it('permintaan yang gagal juga tidak menumbuhkan apa pun', async () => {
        getActiveSponsors.mockResolvedValue({ success: false, message: 'gagal' });

        render(<MemoryRouter><LandingPageSimple {...propsSimple} /></MemoryRouter>);

        await waitFor(() => expect(getActiveSponsors).toHaveBeenCalled());
        expect(screen.queryByTestId('landing-sponsor-strip')).toBeNull();
    });
});
