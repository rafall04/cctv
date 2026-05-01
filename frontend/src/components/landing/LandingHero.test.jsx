// @vitest-environment jsdom

/**
 * Purpose: Verifies landing hero badge layout, default copy simplification, and powered-by visibility.
 * Caller: Frontend Vitest suite.
 * Deps: mocked LandingStatsBar.
 * MainFuncs: LandingHero render tests.
 * SideEffects: Renders configured coverage HTML into jsdom.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingHero from './LandingHero';

vi.mock('./LandingStatsBar', () => ({
    default: () => <div>stats-bar</div>,
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
    it('merender stack badge hero secara vertikal', () => {
        render(
            <LandingHero
                branding={baseBranding}
                landingSettings={landingSettings}
                disableHeavyEffects
            />
        );

        const stack = screen.getByTestId('landing-hero-badge-stack');
        expect(stack.className).toContain('flex-col');
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
