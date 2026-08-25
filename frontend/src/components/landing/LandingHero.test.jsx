// @vitest-environment jsdom

/**
 * Purpose: Verifies the rebuilt hero status deck — eyebrow badge, powered-by visibility,
 *          and default copy simplification — without pulling in the camera context or the
 *          spotlight's thumbnail/config chain.
 * Caller: Frontend Vitest suite.
 * Deps: mocked LandingStatsBar, LandingHeroSpotlight, CameraContext, animation control.
 * MainFuncs: LandingHero render tests.
 * SideEffects: None.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingHero from './LandingHero';

vi.mock('./LandingStatsBar', () => ({
    default: () => <div>stats-bar</div>,
}));

vi.mock('./LandingHeroSpotlight', () => ({
    default: ({ camera }) => <div data-testid="spotlight">{camera ? camera.name : 'kosong'}</div>,
}));

const cameraState = {
    cameras: [
        { id: 1, area_name: 'KAB SURABAYA', is_online: true },
        { id: 2, area_name: 'DI YOGYAKARTA', is_online: true },
    ],
    loading: false,
    dataUnavailable: false,
};

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => cameraState,
}));

vi.mock('../../utils/animationControl', () => ({
    shouldDisableAnimations: () => true,
}));

const baseBranding = {
    show_powered_by: 'true',
    logo_text: 'R',
    company_name: 'RAF NET',
    hero_title: 'Pantau CCTV Secara Real-Time',
    hero_subtitle: 'Pantau CCTV secara real-time dengan sistem CCTV RAF NET. Akses gratis 24 jam untuk memantau berbagai lokasi.',
    footer_text: 'Akses realtime',
};

const landingSettings = {
    hero_badge: 'LIVE STREAMING 24 JAM',
    area_coverage: 'Area coverage aktif',
};

describe('LandingHero', () => {
    it('merender eyebrow status deck dengan badge live dan powered-by', () => {
        render(
            <LandingHero
                branding={baseBranding}
                landingSettings={landingSettings}
                disableHeavyEffects
            />
        );

        expect(screen.getByTestId('landing-hero-badge-stack')).toBeTruthy();
        expect(screen.getByText('Powered by RAF NET')).not.toBeNull();
        expect(screen.getByText('LIVE STREAMING 24 JAM')).not.toBeNull();
        expect(screen.queryByText('Streaming HD')).toBeNull();
        expect(screen.queryByText('Multi-View')).toBeNull();
        expect(screen.queryByText('Playback')).toBeNull();
        expect(screen.queryByTestId('landing-event-banner-full')).toBeNull();
    });

    /*
     * Backend tak terjangkau BUKAN "jaringan berisi nol kota". Sebelum ini hero menyatakan
     * "0 kota" dengan titik hijau berdenyut — dibuktikan di browser dengan seluruh /api/**
     * diputus. Aturannya sama dengan papan metrik: jangan sebut angka yang tidak kita punya.
     */
    it('tidak menyatakan jumlah kota maupun titik hidup saat data tidak terambil', () => {
        cameraState.cameras = [];
        cameraState.dataUnavailable = true;
        try {
            const { container } = render(
                <LandingHero
                    branding={baseBranding}
                    landingSettings={landingSettings}
                    disableHeavyEffects
                />
            );

            expect(screen.queryByText(/^0 kota/)).toBeNull();
            expect(screen.getByText(/… kota · siaran 24 jam/)).not.toBeNull();
            expect(container.querySelector('.bg-status-live')).toBeNull();
            expect(container.querySelector('.bg-status-idle')).not.toBeNull();
        } finally {
            cameraState.cameras = [{ id: 1, area_name: 'KAB SURABAYA', is_online: true }];
            cameraState.dataUnavailable = false;
        }
    });

    it('menyederhanakan copy default hero tanpa mengubah branding custom', () => {
        render(
            <LandingHero
                branding={baseBranding}
                landingSettings={landingSettings}
                disableHeavyEffects
            />
        );

        expect(screen.getByText('Pantau CCTV Real-Time')).toBeTruthy();
        expect(screen.getByText('Akses CCTV publik 24 jam dari satu halaman.')).toBeTruthy();
    });

    /*
     * Sesi live di produksi praktis selalu nol (~20-40 buka-pemutar per hari untuk 36 kamera),
     * jadi memeringkat hanya dengan live_viewers menyorot kamera PERTAMA yang punya thumbnail,
     * bukan yang paling ramai. Total tayangan yang harus memutus seri itu.
     */
    it('memilih total tayangan tertinggi, bukan yang pertama, saat live_viewers seri nol', () => {
        const withSpotlightCameras = (cameras, assert) => {
            const previous = cameraState.cameras;
            cameraState.cameras = cameras;
            try {
                const { unmount } = render(
                    <LandingHero
                        branding={baseBranding}
                        landingSettings={landingSettings}
                        disableHeavyEffects
                    />
                );
                assert(screen.getByTestId('spotlight').textContent);
                unmount();
            } finally {
                cameraState.cameras = previous;
            }
        };
        const cam = (id, name, extra) => ({
            id, name, area_name: 'KAB SURABAYA', is_online: true, thumbnail_path: `c${id}.jpg`, live_viewers: 0, ...extra,
        });

        withSpotlightCameras(
            [cam(1, 'Sepi'), cam(2, 'Ramai', { total_views: 980 }), cam(3, 'Sedang', { viewer_stats: { total_views: 400 } })],
            (name) => expect(name).toBe('Ramai')
        );

        // Penonton saat ini tetap menang lebih dulu bila memang ada.
        withSpotlightCameras(
            [cam(1, 'Arsip', { total_views: 9000 }), cam(2, 'Ditonton', { live_viewers: 3, total_views: 4 })],
            (name) => expect(name).toBe('Ditonton')
        );

        // Seri sungguhan: id terkecil, supaya sorotannya tidak berganti tiap refresh.
        withSpotlightCameras(
            [cam(7, 'Tujuh', { total_views: 5 }), cam(2, 'Dua', { total_views: 5 })],
            (name) => expect(name).toBe('Dua')
        );

        // Offline/maintenance dan yang tanpa thumbnail tetap dilewati.
        withSpotlightCameras(
            [cam(1, 'Mati', { total_views: 900, is_online: 0 }), cam(2, 'Perbaikan', { total_views: 800, status: 'maintenance' }), cam(3, 'Buta', { total_views: 700, thumbnail_path: null }), cam(4, 'Layak', { total_views: 6 })],
            (name) => expect(name).toBe('Layak')
        );
    });

    it('tidak merender powered by saat dinonaktifkan', () => {
        render(
            <LandingHero
                branding={{ ...baseBranding, show_powered_by: 'false' }}
                landingSettings={landingSettings}
                disableHeavyEffects
            />
        );

        expect(screen.queryByText('Powered by RAF NET')).toBeNull();
    });
});
