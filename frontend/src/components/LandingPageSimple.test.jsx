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
    shouldDisableAnimations: () => true,
}));

vi.mock('./FeedbackWidget', () => ({
    default: () => <div>feedback-widget</div>,
}));

vi.mock('./SaweriaSupport', () => ({
    default: () => <div>saweria-support</div>,
}));

describe('LandingPageSimple footer layout', () => {
    it('memisahkan badge Ramadan dan brand tanpa teks rusak', () => {
        render(
            <LandingPageSimple
                onCameraClick={() => {}}
                onAddMulti={() => {}}
                multiCameras={[]}
                saweriaEnabled={false}
                saweriaLink=""
                CamerasSection={() => <div>map-view-section</div>}
                layoutMode="simple"
                onLayoutToggle={() => {}}
                favorites={[]}
                onToggleFavorite={() => {}}
                isFavorite={() => false}
                viewMode="map"
                setViewMode={() => {}}
                hideFloatingWidgets
            />
        );

        expect(screen.getAllByText('Ramadan Kareem 1447 H').length).toBeGreaterThan(0);
        expect(screen.getAllByText('RAF NET').length).toBeGreaterThan(0);
        expect(document.body.textContent).not.toContain('â€¢');
        expect(document.body.textContent).not.toContain('Â©');
        expect(document.body.textContent).not.toContain('â˜•');
    });
});
