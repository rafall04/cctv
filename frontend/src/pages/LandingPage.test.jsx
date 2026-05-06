/*
 * Purpose: Regression tests for public landing connectivity, settings, and popup recovery behavior.
 * Caller: Frontend Vitest suites for landing page flows.
 * Deps: React Testing Library, Vitest, LandingPage, mocked public services and UI components.
 * MainFuncs: Verifies recovery UI, public settings hydration, and map popup props.
 * SideEffects: Mocks runtime config, services, and child components during test execution.
 */
// @vitest-environment jsdom

import { screen, waitFor, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../test/renderWithRouter';
import LandingPage from './LandingPage';

const { getPublicSaweriaConfig, testBackendReachability, updateMetaTags, getPublicLandingPageSettings, getPublicAdsSettings, getDiscovery, videoPopupPropsSpy, landingPageSimplePropsSpy } = vi.hoisted(() => ({
    getPublicSaweriaConfig: vi.fn(),
    testBackendReachability: vi.fn(),
    updateMetaTags: vi.fn(),
    getPublicLandingPageSettings: vi.fn(),
    getPublicAdsSettings: vi.fn(),
    getDiscovery: vi.fn(),
    videoPopupPropsSpy: vi.fn(),
    landingPageSimplePropsSpy: vi.fn(),
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
    getApiKey: () => '',
}));

vi.mock('../services/settingsService', () => ({
    settingsService: {
        getPublicLandingPageSettings,
        getPublicAdsSettings,
    },
}));

vi.mock('../services/publicGrowthService', () => ({
    default: {
        getDiscovery,
        getTrendingCameras: vi.fn().mockResolvedValue({ success: true, data: [] }),
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
    default: ({ onMapCameraOpen }) => (
        <button
            type="button"
            data-testid="open-map-popup"
            onClick={() => onMapCameraOpen?.({
                id: 99,
                name: 'Map Camera',
                streams: { hls: 'https://example.com/map.m3u8' },
                status: 'active',
                is_online: 1,
            })}
        >
            cameras-section
        </button>
    ),
}));

vi.mock('../components/landing/LandingStatsBar', () => ({
    default: () => <div>stats-bar</div>,
}));

vi.mock('../components/landing/LandingPageSimple', () => ({
    default: (props) => {
        landingPageSimplePropsSpy(props);
        return (
            <div>
                <div data-testid="landing-simple-event">{props.eventBanner?.title || 'no-event'}</div>
                <div data-testid="landing-simple-announcement">{props.announcement?.title || 'no-announcement'}</div>
            </div>
        );
    },
}));

vi.mock('../components/ads/InlineAdSlot', () => ({
    default: ({ slotKey }) => <div data-testid={`ad-slot-${slotKey}`}>{slotKey}</div>,
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
    default: (props) => {
        videoPopupPropsSpy(props);
        return <div data-testid={props.modalTestId || 'grid-popup-modal'}>video-popup</div>;
    },
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
        getDiscovery.mockReset();
        videoPopupPropsSpy.mockReset();
        landingPageSimplePropsSpy.mockReset();
        testBackendReachability.mockResolvedValue({ reachable: true, latency: 80 });
        getDiscovery.mockResolvedValue({
            success: true,
            data: { live_now: [], top_cameras: [], new_cameras: [], popular_areas: [] },
        });

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
                popup: {
                    enabled: true,
                    preferredSlot: 'bottom',
                    hideSocialBarOnPopup: true,
                    hideFloatingWidgetsOnPopup: true,
                    maxHeight: {
                        desktop: 160,
                        mobile: 220,
                    },
                },
                slots: {
                    playbackPopunder: {
                        enabled: false,
                        devices: {
                            desktop: true,
                            mobile: true,
                        },
                    },
                    socialBar: { enabled: false },
                    footerBanner: { enabled: false },
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
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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

        expect(warnSpy).toHaveBeenCalledWith('[LandingPage] Backend health check unreachable');
        warnSpy.mockRestore();
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

    it('merender popup map dari host halaman dengan test id map saat map membuka kamera', async () => {
        renderWithRouter(<LandingPage />);

        await waitFor(() => {
            expect(screen.getByTestId('open-map-popup')).toBeTruthy();
        });

        await act(async () => {
            screen.getByTestId('open-map-popup').click();
        });

        await waitFor(() => {
            expect(screen.getByTestId('map-popup-modal')).toBeTruthy();
        });

        expect(videoPopupPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            modalTestId: 'map-popup-modal',
            bodyTestId: 'map-video-body',
            camera: expect.objectContaining({ id: 99, name: 'Map Camera' }),
        }));
    });

    it('merender footer banner di bawah halaman pada full mode', async () => {
        getPublicAdsSettings.mockResolvedValueOnce({
            success: true,
            data: {
                enabled: true,
                devices: { desktop: true, mobile: true },
                popup: {
                    enabled: true,
                    preferredSlot: 'bottom',
                    hideSocialBarOnPopup: true,
                    hideFloatingWidgetsOnPopup: true,
                    maxHeight: {
                        desktop: 160,
                        mobile: 220,
                    },
                },
                slots: {
                    playbackPopunder: { enabled: false, devices: { desktop: true, mobile: true } },
                    socialBar: { enabled: false },
                    footerBanner: { enabled: true, script: '<div>footer ad</div>' },
                    afterCamerasNative: { enabled: false },
                    popupTopBanner: { enabled: false },
                    popupBottomNative: { enabled: false },
                },
            },
        });

        renderWithRouter(<LandingPage />);

        await waitFor(() => {
            expect(screen.getByTestId('ad-slot-footer-banner')).toBeTruthy();
        });

        expect(
            screen.getByTestId('ad-slot-footer-banner').compareDocumentPosition(
                screen.getByText('footer')
            ) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it('meneruskan config footer banner ke simple mode', async () => {
        getPublicAdsSettings.mockResolvedValueOnce({
            success: true,
            data: {
                enabled: true,
                devices: { desktop: true, mobile: true },
                popup: {
                    enabled: true,
                    preferredSlot: 'bottom',
                    hideSocialBarOnPopup: true,
                    hideFloatingWidgetsOnPopup: true,
                    maxHeight: {
                        desktop: 160,
                        mobile: 220,
                    },
                },
                slots: {
                    playbackPopunder: { enabled: false, devices: { desktop: true, mobile: true } },
                    socialBar: { enabled: false },
                    footerBanner: { enabled: true, script: '<div>simple footer ad</div>' },
                    afterCamerasNative: { enabled: false },
                    popupTopBanner: { enabled: false },
                    popupBottomNative: { enabled: false },
                },
            },
        });

        renderWithRouter(<LandingPage />, { initialEntries: ['/?mode=simple'] });

        await waitFor(() => {
            expect(screen.getByTestId('landing-simple-event')).toBeTruthy();
        });

        expect(landingPageSimplePropsSpy).toHaveBeenCalledWith(expect.objectContaining({
            adsConfig: expect.objectContaining({
                slots: expect.objectContaining({
                    footerBanner: expect.objectContaining({
                        enabled: true,
                        script: '<div>simple footer ad</div>',
                    }),
                }),
            }),
        }));
    });

    it('meneruskan discovery publik yang sama ke simple mode', async () => {
        getDiscovery.mockResolvedValueOnce({
            success: true,
            data: {
                live_now: [{ id: 4, name: 'CCTV Ramai', live_viewers: 8 }],
                top_cameras: [],
                new_cameras: [],
                popular_areas: [],
            },
        });

        renderWithRouter(<LandingPage />, { initialEntries: ['/?mode=simple'] });

        await waitFor(() => {
            expect(landingPageSimplePropsSpy).toHaveBeenCalledWith(expect.objectContaining({
                publicDiscovery: expect.objectContaining({
                    live_now: [expect.objectContaining({ id: 4, name: 'CCTV Ramai' })],
                }),
                discoveryLoading: false,
            }));
        });
    });
});
