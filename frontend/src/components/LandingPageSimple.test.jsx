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
                eventBanner={{
                    enabled: true,
                    title: 'Ramadan Kareem',
                    text: 'Selamat menunaikan ibadah puasa.',
                    theme: 'ramadan',
                    show_in_simple: true,
                    isActive: true,
                }}
                announcement={{
                    enabled: true,
                    title: 'Info Layanan',
                    text: 'Maintenance malam ini.',
                    style: 'warning',
                    show_in_simple: true,
                    isActive: true,
                }}
            />
        );

        expect(screen.getByTestId('landing-announcement-simple')).toBeTruthy();
        expect(screen.getByTestId('landing-event-banner-simple')).toBeTruthy();
        expect(screen.getByText('Ramadan Kareem')).toBeTruthy();
        expect(
            screen.getByTestId('landing-event-banner-simple').compareDocumentPosition(
                screen.getByTestId('landing-announcement-simple')
            ) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(screen.getAllByText('RAF NET').length).toBeGreaterThan(0);
        expect(screen.getByRole('tab', { name: /full/i })).not.toBeNull();
        expect(screen.getByRole('tab', { name: /simple/i })).not.toBeNull();
        expect(document.body.textContent).not.toContain('Penutup ringkas untuk tampilan cepat tanpa elemen berulang.');
        expect(document.body.textContent).not.toContain('Ã¢â‚¬Â¢');
        expect(document.body.textContent).not.toContain('Ã‚Â©');
        expect(document.body.textContent).not.toContain('Ã¢Ëœâ€¢');
    });
});
