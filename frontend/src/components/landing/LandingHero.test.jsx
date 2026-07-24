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
    default: () => <div>spotlight</div>,
}));

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({
        cameras: [
            { id: 1, area_name: 'KAB SURABAYA', is_online: true },
            { id: 2, area_name: 'DI YOGYAKARTA', is_online: true },
        ],
    }),
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
