// @vitest-environment jsdom

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
    hero_title: 'Pantau CCTV',
    hero_subtitle: 'Streaming publik',
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
        expect(screen.getByText('Ramadan Kareem 1447 H')).not.toBeNull();
        expect(screen.getByText('Powered by RAF NET')).not.toBeNull();
        expect(screen.getByText('LIVE STREAMING 24 JAM')).not.toBeNull();
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
