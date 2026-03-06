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
    it('menjaga simple mode tetap ringkas tanpa copy tambahan', () => {
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

        expect(screen.getAllByText('Ramadan Kareem 1447 H').length).toBe(1);
        expect(screen.getAllByText('RAF NET').length).toBeGreaterThan(0);
        expect(screen.getByRole('tab', { name: /full/i })).not.toBeNull();
        expect(screen.getByRole('tab', { name: /simple/i })).not.toBeNull();
        expect(document.body.textContent).not.toContain('Penutup ringkas untuk tampilan cepat tanpa elemen berulang.');
        expect(document.body.textContent).not.toContain('Ã¢â‚¬Â¢');
        expect(document.body.textContent).not.toContain('Ã‚Â©');
        expect(document.body.textContent).not.toContain('Ã¢Ëœâ€¢');
    });
});
