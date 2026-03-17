// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPageSimple from './LandingPageSimple';

vi.mock('../contexts/ThemeContext', () => ({
    useTheme: () => ({
        isDark: false,
        toggleTheme: vi.fn(),
    }),
}));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({
        branding: {
            company_name: 'RAF NET',
            logo_text: 'R',
        },
    }),
}));

vi.mock('../utils/animationControl', () => ({
    shouldDisableAnimations: () => false,
}));

vi.mock('./landing/LayoutModeToggle', () => ({
    default: () => <div>layout-toggle</div>,
}));

vi.mock('./landing/LandingPublicTopStack', () => ({
    default: () => <div>top-stack</div>,
}));

vi.mock('./ads/InlineAdSlot', () => ({
    default: ({ slotKey }) => <div data-testid={`ad-slot-${slotKey}`}>{slotKey}</div>,
}));

vi.mock('./FeedbackWidget', () => ({
    default: () => <div>feedback-widget</div>,
}));

vi.mock('./SaweriaSupport', () => ({
    default: () => <div>saweria-support</div>,
}));

describe('LandingPageSimple', () => {
    it('merender footer banner di bawah cameras section dan sebelum footer', () => {
        const CamerasSection = () => <div data-testid="cameras-section">cameras</div>;

        render(
            <LandingPageSimple
                onCameraClick={vi.fn()}
                onAddMulti={vi.fn()}
                multiCameras={[]}
                saweriaEnabled={false}
                saweriaLink=""
                CamerasSection={CamerasSection}
                layoutMode="simple"
                onLayoutToggle={vi.fn()}
                favorites={[]}
                onToggleFavorite={vi.fn()}
                isFavorite={vi.fn(() => false)}
                viewMode="grid"
                setViewMode={vi.fn()}
                adsConfig={{
                    enabled: true,
                    devices: { desktop: true, mobile: true },
                    slots: {
                        footerBanner: {
                            enabled: true,
                            script: '<div>footer ad</div>',
                            devices: {
                                desktop: true,
                                mobile: true,
                            },
                        },
                    },
                }}
            />
        );

        const camerasSection = screen.getByTestId('cameras-section');
        const footerBanner = screen.getByTestId('ad-slot-footer-banner-simple');
        const footer = document.querySelector('footer');

        expect(
            camerasSection.compareDocumentPosition(footerBanner) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(
            footerBanner.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });
});
