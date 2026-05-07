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

const { getPublicSaweriaConfig, testBackendReachability, updateMetaTags, getPublicLandingPageSettings, getPublicAdsSettings, getDiscovery, preloadLandingMapView, resolvePublicPopupCamera, videoPopupPropsSpy, landingPageSimplePropsSpy, cameraProviderPropsSpy, cameraContextState } = vi.hoisted(() => ({
    getPublicSaweriaConfig: vi.fn(),
    testBackendReachability: vi.fn(),
    updateMetaTags: vi.fn(),
    getPublicLandingPageSettings: vi.fn(),
    getPublicAdsSettings: vi.fn(),
    getDiscovery: vi.fn(),
    preloadLandingMapView: vi.fn(),
    resolvePublicPopupCamera: vi.fn(),
    videoPopupPropsSpy: vi.fn(),
    landingPageSimplePropsSpy: vi.fn(),
    cameraProviderPropsSpy: vi.fn(),
    cameraContextState: { cameras: [], deviceTier: 'mid' },
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

vi.mock('../services/publicCameraResolver', () => ({
    resolvePublicPopupCamera,
}));

vi.mock('../utils/preloadLandingMapView', () => ({
    preloadLandingMapView,
}));

vi.mock('../contexts/CameraContext', () => ({
    CameraProvider: ({ children, autoRefresh }) => {
        cameraProviderPropsSpy({ autoRefresh });
        return <>{children}</>;
    },
    useCameras: () => ({
        cameras: cameraContextState.cameras,
        deviceTier: cameraContextState.deviceTier,
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
    default: ({ onMapCameraOpen, viewMode }) => (
        <section id="camera-workspace" data-testid="camera-workspace" data-view-mode={viewMode}>
            <button
                type="button"
                data-testid="open-map-popup"
                onClick={() => onMapCameraOpen?.({
                    id: 99,
                    name: 'Map Camera',
                    status: 'active',
                    is_online: 1,
                })}
                >
                    cameras-section
                </button>
            <button
                type="button"
                data-testid="open-map-popup-alt"
                onClick={() => onMapCameraOpen?.({
                    id: 100,
                    name: 'Map Camera Alt',
                    status: 'active',
                    is_online: 1,
                })}
            >
                cameras-section-alt
            </button>
        </section>
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
        preloadLandingMapView.mockReset();
        resolvePublicPopupCamera.mockReset();
        videoPopupPropsSpy.mockReset();
        landingPageSimplePropsSpy.mockReset();
        cameraProviderPropsSpy.mockReset();
        cameraContextState.cameras = [];
        cameraContextState.deviceTier = 'mid';
        testBackendReachability.mockResolvedValue({ reachable: true, latency: 80 });
        getDiscovery.mockResolvedValue({
            success: true,
            data: { live_now: [], top_cameras: [], new_cameras: [], popular_areas: [] },
        });
        resolvePublicPopupCamera.mockResolvedValue({
            id: 99,
            name: 'Map Camera',
            streams: { hls: 'https://example.com/map.m3u8' },
            status: 'active',
            is_online: 1,
            _stream_resolution_pending: false,
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
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });
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

    it('merender popup map dari host halaman lewat resolusi stream saat map membuka kamera', async () => {
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

        await waitFor(() => {
            expect(resolvePublicPopupCamera).toHaveBeenCalledWith(
                expect.objectContaining({ id: 99, name: 'Map Camera' }),
                []
            );
        });

        expect(videoPopupPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            modalTestId: 'map-popup-modal',
            bodyTestId: 'map-video-body',
            camera: expect.objectContaining({
                id: 99,
                name: 'Map Camera',
                _stream_resolution_pending: false,
                streams: { hls: 'https://example.com/map.m3u8' },
            }),
        }));
        expect(cameraProviderPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            autoRefresh: false,
        }));
    });

    it('merender popup direct URL kamera lewat resolusi stream sebelum playback', async () => {
        cameraContextState.cameras = [{
            id: 99,
            name: 'Map Camera',
            status: 'active',
            is_online: 1,
        }];

        renderWithRouter(<LandingPage />, {
            initialEntries: ['/?camera=99-map-camera'],
        });

        await waitFor(() => {
            expect(resolvePublicPopupCamera).toHaveBeenCalledWith(
                expect.objectContaining({ id: 99, name: 'Map Camera' }),
                expect.arrayContaining([expect.objectContaining({ id: 99 })])
            );
        });

        await waitFor(() => {
            expect(videoPopupPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
                camera: expect.objectContaining({
                    id: 99,
                    name: 'Map Camera',
                    _stream_resolution_pending: false,
                    streams: { hls: 'https://example.com/map.m3u8' },
                }),
            }));
        });
    });

    it('mengabaikan hasil resolusi popup yang terlambat saat popup baru dibuka', async () => {
        let resolveFirstPopup;
        const firstPopupPromise = new Promise((resolve) => {
            resolveFirstPopup = resolve;
        });

        resolvePublicPopupCamera.mockImplementation((camera) => {
            if (camera.id === 99) {
                return firstPopupPromise;
            }

            return Promise.resolve({
                ...camera,
                streams: { hls: `https://example.com/${camera.id}.m3u8` },
                _stream_resolution_pending: false,
            });
        });

        renderWithRouter(<LandingPage />);

        await waitFor(() => {
            expect(screen.getByTestId('open-map-popup')).toBeTruthy();
        });

        await act(async () => {
            screen.getByTestId('open-map-popup').click();
            screen.getByTestId('open-map-popup-alt').click();
        });

        await act(async () => {
            resolveFirstPopup({
                id: 99,
                name: 'Map Camera',
                streams: { hls: 'https://example.com/late.m3u8' },
                status: 'active',
                is_online: 1,
                _stream_resolution_pending: false,
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId('map-popup-modal')).toBeTruthy();
        });

        expect(videoPopupPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            camera: expect.objectContaining({
                id: 100,
                name: 'Map Camera Alt',
                streams: { hls: 'https://example.com/100.m3u8' },
                _stream_resolution_pending: false,
            }),
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

    it('scrolls to the camera workspace and preloads map when mobile dock map is clicked', async () => {
        const scrollTo = vi.fn();
        vi.stubGlobal('scrollTo', scrollTo);

        renderWithRouter(<LandingPage />, { initialEntries: ['/?mode=full&view=grid'] });

        await waitFor(() => {
            expect(screen.getByTestId('camera-workspace')).toBeTruthy();
        });

        await act(async () => {
            screen.getByRole('button', { name: 'Map' }).click();
        });

        await waitFor(() => {
            expect(screen.getByTestId('camera-workspace').dataset.viewMode).toBe('map');
        });

        expect(preloadLandingMapView).toHaveBeenCalled();
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({
            behavior: 'smooth',
        }));
    });

    it('tidak auto-preload map dari intersection observer pada device low-end', async () => {
        cameraContextState.deviceTier = 'low';
        let observedCallback;
        const observe = vi.fn();
        const disconnect = vi.fn();
        vi.stubGlobal('IntersectionObserver', vi.fn((callback) => {
            observedCallback = callback;
            return { observe, disconnect };
        }));

        renderWithRouter(<LandingPage />, { initialEntries: ['/?mode=full&view=grid'] });

        expect(observe).not.toHaveBeenCalled();

        if (observedCallback) {
            observedCallback([{ isIntersecting: true, intersectionRatio: 1 }]);
        }

        expect(preloadLandingMapView).not.toHaveBeenCalled();
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
