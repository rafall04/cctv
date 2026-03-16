// @vitest-environment jsdom

import { screen, waitFor, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../test/renderWithRouter';
import LandingPage from './LandingPage';

const { getPublicSaweriaConfig, testBackendReachability, updateMetaTags, getPublicLandingPageSettings, getPublicAdsSettings } = vi.hoisted(() => ({
    getPublicSaweriaConfig: vi.fn(),
    testBackendReachability: vi.fn(),
    updateMetaTags: vi.fn(),
    getPublicLandingPageSettings: vi.fn(),
    getPublicAdsSettings: vi.fn(),
}));

vi.mock('../services/saweriaService', () => ({
    getPublicSaweriaConfig,
}));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({
        branding: {
            hero_title: 'Hero CCTV',
            hero_subtitle: 'Pantau area publik',
            footer_text: 'Footer',
        },
    }),
}));

vi.mock('../utils/metaUpdater', () => ({
    updateMetaTags,
}));

vi.mock('../utils/connectionTester', () => ({
    testBackendReachability,
}));

vi.mock('../config/config.js', () => ({
    getApiUrl: () => 'https://api.example.com',
}));

vi.mock('../services/settingsService', () => ({
    settingsService: {
        getPublicLandingPageSettings,
        getPublicAdsSettings,
    },
}));

vi.mock('../contexts/CameraContext', () => ({
    CameraProvider: ({ children }) => <>{children}</>,
    useCameras: () => ({
        cameras: [],
        deviceTier: 'mid',
    }),
}));

vi.mock('../contexts/ToastContext', () => ({
    ToastProvider: ({ children }) => <>{children}</>,
    useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('../hooks/useCameraStatusTracker', () => ({
    useCameraStatusTracker: vi.fn(),
}));

vi.mock('../hooks/useCameraHistory', () => ({
    useCameraHistory: () => ({
        favorites: [],
        recentCameras: [],
        toggleFavorite: vi.fn(),
        isFavorite: vi.fn(() => false),
        addRecentCamera: vi.fn(),
    }),
}));

vi.mock('../components/ui/Icons', () => ({
    Icons: {},
}));

vi.mock('../components/landing/LandingNavbar', () => ({
    default: () => <div>navbar</div>,
}));

vi.mock('../components/landing/LandingFooter', () => ({
    default: () => <div>footer</div>,
}));

vi.mock('../components/landing/LandingHero', () => ({
    default: () => <div data-testid="landing-hero">hero</div>,
}));

vi.mock('../components/landing/LandingCamerasSection', () => ({
    default: () => <div>cameras-section</div>,
}));

vi.mock('../components/landing/LandingStatsBar', () => ({
    default: () => <div>stats-bar</div>,
}));

vi.mock('../components/LandingPageSimple', () => ({
    default: ({ announcement, eventBanner }) => (
        <div>
            <div data-testid="landing-simple-event">{eventBanner?.title || 'no-event'}</div>
            <div data-testid="landing-simple-announcement">{announcement?.title || 'no-announcement'}</div>
        </div>
    ),
}));

vi.mock('../components/landing/LandingAnnouncementBar', () => ({
    default: ({ layoutMode }) => <div data-testid={`announcement-${layoutMode}`}>announcement</div>,
}));

vi.mock('../components/landing/LandingEventBanner', () => ({
    default: ({ layoutMode }) => <div data-testid={`event-banner-${layoutMode}`}>event-banner</div>,
}));

vi.mock('../components/MultiView/MultiViewButton', () => ({
    default: () => <div>multi-button</div>,
}));

vi.mock('../components/MultiView/MultiViewLayout', () => ({
    default: () => <div>multi-layout</div>,
}));

vi.mock('../components/MultiView/VideoPopup', () => ({
    default: () => <div>video-popup</div>,
}));

vi.mock('../components/SaweriaLeaderboard', () => ({
    default: () => <div>saweria-leaderboard</div>,
}));

vi.mock('../components/FeedbackWidget', () => ({
    default: () => <div>feedback-widget</div>,
}));

vi.mock('../components/SaweriaSupport', () => ({
    default: () => <div>saweria-support</div>,
}));

describe('LandingPage connectivity recovery', () => {
    beforeEach(() => {
        getPublicSaweriaConfig.mockReset();
        testBackendReachability.mockReset();
        updateMetaTags.mockReset();
        getPublicLandingPageSettings.mockReset();
        getPublicAdsSettings.mockReset();

        getPublicSaweriaConfig.mockResolvedValue({
            success: true,
            data: { enabled: false, saweria_link: null },
        });
        getPublicLandingPageSettings.mockResolvedValue({
            success: true,
            data: {
                area_coverage: 'Coverage',
                hero_badge: 'Live',
                section_title: 'CCTV Publik',
                eventBanner: {
                    title: 'Ramadan Kareem',
                    show_in_full: true,
                    show_in_simple: true,
                    isActive: true,
                },
                announcement: {
                    title: 'Info Layanan',
                    show_in_full: true,
                    show_in_simple: true,
                    isActive: true,
                },
            },
        });
        getPublicAdsSettings.mockResolvedValue({
            success: true,
            data: {
                enabled: false,
                devices: { desktop: true, mobile: true },
                slots: {
                    socialBar: { enabled: false },
                    topBanner: { enabled: false },
                    afterCamerasNative: { enabled: false },
                    popupTopBanner: { enabled: false },
                    popupBottomNative: { enabled: false },
                },
            },
        });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ success: false }),
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('mengecek ulang konektivitas saat browser kembali online', async () => {
        testBackendReachability
            .mockResolvedValueOnce({ reachable: false, latency: -1 })
            .mockResolvedValueOnce({ reachable: true, latency: 120 });

        renderWithRouter(<LandingPage />);

        await waitFor(() => {
            expect(testBackendReachability).toHaveBeenCalledTimes(1);
        });

        await act(async () => {
            window.dispatchEvent(new Event('online'));
        });

        await waitFor(() => {
            expect(testBackendReachability).toHaveBeenCalledTimes(2);
        });
    }, 10000);

    it('mengecek ulang konektivitas saat tab kembali focus setelah jeda throttle', async () => {
        testBackendReachability
            .mockResolvedValueOnce({ reachable: true, latency: 90 })
            .mockResolvedValueOnce({ reachable: true, latency: 95 });

        renderWithRouter(<LandingPage />);

        await waitFor(() => {
            expect(testBackendReachability).toHaveBeenCalledTimes(1);
        });

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 3100));
            window.dispatchEvent(new Event('focus'));
        });

        await waitFor(() => {
            expect(testBackendReachability).toHaveBeenCalledTimes(2);
        });
    }, 10000);

    it('merender event banner sebelum announcement pada full mode', async () => {
        renderWithRouter(<LandingPage />);

        await waitFor(() => {
            expect(screen.getByTestId('event-banner-full')).toBeTruthy();
        });

        expect(
            screen.getByTestId('event-banner-full').compareDocumentPosition(
                screen.getByTestId('announcement-full')
            ) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(
            screen.getByTestId('announcement-full').compareDocumentPosition(
                screen.getByTestId('landing-hero')
            ) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });
});
