// @vitest-environment jsdom

/**
 * Purpose: Verifies the lightweight landing mode composition, status copy, compact discovery, and ad placement.
 * Caller: Frontend Vitest suite.
 * Deps: mocked theme, branding, cameras, public config, ads, and floating widgets.
 * MainFuncs: LandingPageSimple render tests.
 * SideEffects: Renders into jsdom only.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LandingPageSimple from './LandingPageSimple';

vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({
        isDark: false,
        toggleTheme: vi.fn(),
    }),
}));

vi.mock('../../contexts/BrandingContext', () => ({
    useBranding: () => ({
        branding: {
            company_name: 'RAF NET',
            logo_text: 'R',
        },
    }),
}));

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({
        cameras: [
            { id: 1, is_online: 1 },
            { id: 2, is_online: 0 },
            { id: 3, is_online: 1 },
        ],
        loading: false,
    }),
}));

vi.mock('../../utils/animationControl', () => ({
    shouldDisableAnimations: () => false,
}));

vi.mock('./LayoutModeToggle', () => ({
    default: () => <div>layout-toggle</div>,
}));

vi.mock('./LandingPublicTopStack', () => ({
    default: () => <div>top-stack</div>,
}));

vi.mock('./LandingDiscoveryStrip', () => ({
    default: ({ discovery }) => <div data-testid="landing-discovery-strip">{discovery?.live_now?.[0]?.name || 'no-discovery'}</div>,
}));

vi.mock('../ads/InlineAdSlot', () => ({
    default: ({ slotKey }) => <div data-testid={`ad-slot-${slotKey}`}>{slotKey}</div>,
}));

vi.mock('../FeedbackWidget', () => ({
    default: () => <div>feedback-widget</div>,
}));

vi.mock('../SaweriaSupport', () => ({
    default: () => <div>saweria-support</div>,
}));

function renderWithRouter(ui) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('LandingPageSimple', () => {
    it('merender footer banner di bawah cameras section dan sebelum footer', async () => {
        const CamerasSection = () => <div data-testid="cameras-section">cameras</div>;

        renderWithRouter(
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

        await screen.findByText('feedback-widget');

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

    it('menampilkan papan status command-deck (online/offline/total/kota + menonton) di mode simpel', async () => {
        const CamerasSection = () => <div data-testid="cameras-section">cameras</div>;

        renderWithRouter(
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
                adsConfig={null}
            />
        );

        await screen.findByText('feedback-widget');

        expect(screen.queryByText(/dataset publik/i)).toBeNull();
        // The old compact prose strip is gone — it is now the command-deck metric board.
        expect(screen.queryByText('Ringkasan cepat kamera publik saat ini.')).toBeNull();

        // "Online"/values also appear in the header pulse and footer stats now, so scope the
        // assertions to the board's labelled region to keep them unambiguous.
        const board = screen.getByRole('region', { name: 'Status jaringan kamera' });
        expect(within(board).getByText('Status kamera')).toBeTruthy();
        expect(within(board).getByText('Online')).toBeTruthy();
        expect(within(board).getByText('Offline')).toBeTruthy();
        expect(within(board).getByText('Total')).toBeTruthy();
        expect(within(board).getByText('Kota')).toBeTruthy();
        expect(within(board).getByText('Menonton sekarang')).toBeTruthy();
        // Same canonical tally as Full mode: 2 online, 1 offline, 3 total (mock has 3 cameras).
        expect(within(board).getByText('2')).toBeTruthy();
        expect(within(board).getByText('1')).toBeTruthy();
        expect(within(board).getByText('3')).toBeTruthy();
    });

    it('menampilkan discovery compact yang sama di mode simpel', () => {
        const CamerasSection = () => <div data-testid="cameras-section">cameras</div>;

        renderWithRouter(
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
                adsConfig={null}
                publicDiscovery={{
                    live_now: [{ id: 9, name: 'CCTV Compact' }],
                    top_cameras: [],
                    new_cameras: [],
                    popular_areas: [],
                }}
            />
        );

        expect(screen.getByTestId('landing-discovery-strip').textContent).toContain('CCTV Compact');
    });

    it('menyembunyikan floating widget saat diminta parent shell', () => {
        const CamerasSection = () => <div data-testid="cameras-section">cameras</div>;

        renderWithRouter(
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
                adsConfig={null}
                hideFloatingWidgets={true}
            />
        );

        expect(screen.queryByText('feedback-widget')).toBeNull();
    });
});
