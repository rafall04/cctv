/*
 * Purpose: Regression tests for the public CCTV map aggregation, viewport, and popup behavior.
 * Caller: Frontend Vitest suites for landing/map interactions.
 * Deps: React Testing Library, Vitest, mocked react-leaflet/Leaflet, MapView.
 * MainFuncs: Verifies marker aggregation, map chrome layering, viewport commands, and stream modal flows.
 * SideEffects: Mocks browser media APIs and map services during test execution.
 */
// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import MapView from './MapView';

const {
    fitBoundsMock,
    setViewMock,
    mapEventHandlers,
    getZoomMock,
    getBoundsMock,
    setMockZoom,
    setMockBounds,
    resetMockMapState,
    startSessionMock,
    stopSessionMock,
    startTimeoutMock,
    clearTimeoutMock,
    updateStageMock,
    resetFailuresMock,
    hlsInstances,
} = vi.hoisted(() => ({
    fitBoundsMock: vi.fn(),
    setViewMock: vi.fn(),
    mapEventHandlers: {},
    getZoomMock: vi.fn(),
    getBoundsMock: vi.fn(),
    setMockZoom: vi.fn(),
    setMockBounds: vi.fn(),
    resetMockMapState: vi.fn(),
    startSessionMock: vi.fn().mockResolvedValue('session-1'),
    stopSessionMock: vi.fn().mockResolvedValue(undefined),
    startTimeoutMock: vi.fn(),
    clearTimeoutMock: vi.fn(),
    updateStageMock: vi.fn(),
    resetFailuresMock: vi.fn(),
    hlsInstances: [],
}));

const createMockBounds = (south, west, north, east) => ({
    isValid: () => true,
    getSouth: () => south,
    getWest: () => west,
    getNorth: () => north,
    getEast: () => east,
});

let mockZoom = 11;
let mockBounds = createMockBounds(-8, 111, -6, 113);

getZoomMock.mockImplementation(() => mockZoom);
getBoundsMock.mockImplementation(() => mockBounds);
setMockZoom.mockImplementation((value) => {
    mockZoom = value;
});
setMockBounds.mockImplementation((value) => {
    mockBounds = value;
});
resetMockMapState.mockImplementation(() => {
    mockZoom = 11;
    mockBounds = createMockBounds(-8, 111, -6, 113);
    Object.keys(mapEventHandlers).forEach((key) => delete mapEventHandlers[key]);
});

const mapMock = {
    flyTo: vi.fn(),
    fitBounds: fitBoundsMock,
    setView: setViewMock,
    invalidateSize: vi.fn(),
    getZoom: getZoomMock,
    getBounds: getBoundsMock,
};

vi.mock('react-router-dom', () => ({
    useSearchParams: () => [new URLSearchParams('mode=simple&view=map')],
}));

vi.mock('react-leaflet', () => ({
    MapContainer: ({ children }) => <div data-testid="map-container">{children}</div>,
    TileLayer: () => <div />,
    Marker: ({ eventHandlers, position }) => (
        <button
            data-testid={`marker-${position[0]}-${position[1]}`}
            onClick={() => eventHandlers?.click?.()}
            type="button"
        >
            marker
        </button>
    ),
    ZoomControl: () => <div />,
    LayersControl: Object.assign(({ children }) => <div>{children}</div>, {
        BaseLayer: ({ children }) => <div>{children}</div>,
    }),
    useMap: () => mapMock,
    useMapEvents: (handlers) => {
        Object.assign(mapEventHandlers, handlers);
        return mapMock;
    },
}));

vi.mock('leaflet', () => ({
    default: {
        Icon: {
            Default: {
                prototype: {},
                mergeOptions: vi.fn(),
            },
        },
        divIcon: vi.fn(() => ({})),
        latLngBounds: vi.fn((coords = []) => {
            if (!Array.isArray(coords) || coords.length === 0) {
                return createMockBounds(-8, 111, -6, 113);
            }

            const latitudes = coords.map(([lat]) => lat);
            const longitudes = coords.map(([, lng]) => lng);
            return createMockBounds(
                Math.min(...latitudes),
                Math.min(...longitudes),
                Math.max(...latitudes),
                Math.max(...longitudes),
            );
        }),
    },
}));

vi.mock('hls.js', () => {
    class HlsMock {
        static isSupported() {
            return true;
        }

        static Events = {
            MANIFEST_PARSED: 'manifestParsed',
            FRAG_LOADED: 'fragLoaded',
            FRAG_BUFFERED: 'fragBuffered',
            ERROR: 'error',
        };

        static ErrorTypes = {
            NETWORK_ERROR: 'networkError',
            MEDIA_ERROR: 'mediaError',
        };

        constructor() {
            this.handlers = {};
            hlsInstances.push(this);
        }

        loadSource = vi.fn();
        attachMedia = vi.fn();
        destroy = vi.fn();
        on(event, handler) {
            this.handlers[event] = handler;
        }
    }

    return { default: HlsMock };
});

vi.mock('../services/settingsService', () => ({
    settingsService: {
        getMapCenter: vi.fn().mockResolvedValue({
            success: true,
            data: { latitude: -7.15, longitude: 111.88, zoom: 11, name: 'Semua Lokasi' },
        }),
    },
}));

vi.mock('../services/viewerService', () => ({
    viewerService: {
        startSession: startSessionMock,
        stopSession: stopSessionMock,
    },
}));

vi.mock('../utils/deviceDetector', () => ({
    detectDeviceTier: () => 'mid',
}));

vi.mock('../utils/hlsConfig', () => ({
    getHLSConfig: () => ({}),
}));

vi.mock('../utils/rafThrottle', () => ({
    createTransformThrottle: () => ({ update: vi.fn(), cancel: vi.fn() }),
}));

vi.mock('../utils/fallbackHandler', () => ({
    createFallbackHandler: () => ({
        handleError: () => ({ action: 'manual-retry-required' }),
        destroy: vi.fn(),
        clearPendingRetry: vi.fn(),
        reset: vi.fn(),
    }),
}));

vi.mock('../hooks/useStreamTimeout', () => ({
    useStreamTimeout: () => ({
        startTimeout: startTimeoutMock,
        clearTimeout: clearTimeoutMock,
        updateStage: updateStageMock,
        resetFailures: resetFailuresMock,
        getConsecutiveFailures: () => 1,
    }),
}));

vi.mock('./CodecBadge', () => ({
    default: () => <div />,
}));

vi.mock('./MultiView/ZoomableVideo', () => ({
    default: ({ videoRef }) => <video ref={videoRef} data-testid="map-popup-video" />,
}));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({ branding: { company_name: 'RAF NET' } }),
}));

vi.mock('../utils/snapshotHelper', () => ({
    takeSnapshot: vi.fn(),
}));

describe('MapView area filter visibility', () => {
    let playMock;
    let requestFullscreenMock;
    const cameras = [
        {
            id: 1,
            name: 'Lobby',
            latitude: '-7.1507',
            longitude: '111.8815',
            area_name: 'Dander',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
            streams: { hls: 'https://example.com/live-1.m3u8' },
        },
    ];

    const statusCameras = [
        {
            id: 1,
            name: 'Lobby',
            latitude: '-7.1507',
            longitude: '111.8815',
            area_name: 'Dander',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
            streams: { hls: 'https://example.com/live-1.m3u8' },
        },
        {
            id: 2,
            name: 'Gerbang',
            latitude: '-7.1508',
            longitude: '111.8816',
            area_name: 'Dander',
            is_online: 1,
            status: 'active',
            is_tunnel: 1,
            streams: { hls: 'https://example.com/live-2.m3u8' },
        },
        {
            id: 3,
            name: 'Gudang',
            latitude: '-7.1509',
            longitude: '111.8817',
            area_name: 'Dander',
            is_online: 0,
            status: 'active',
            is_tunnel: 0,
            streams: { hls: 'https://example.com/live-1.m3u8' },
        },
        {
            id: 4,
            name: 'Parkir',
            latitude: '-7.1510',
            longitude: '111.8818',
            area_name: 'Dander',
            is_online: 1,
            status: 'maintenance',
            is_tunnel: 0,
            streams: { hls: 'https://example.com/live-2.m3u8' },
        },
    ];

    const areaCameras = [
        {
            id: 1,
            name: 'Lobby',
            latitude: '-7.1507',
            longitude: '111.8815',
            area_name: 'Dander',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        },
        {
            id: 2,
            name: 'Kantor',
            latitude: '-7.2507',
            longitude: '112.0815',
            area_name: 'Baureno',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        },
    ];

    const areas = [
        { name: 'Dander', latitude: '-7.1500', longitude: '111.8800' },
        { name: 'Baureno', latitude: '-7.2500', longitude: '112.0800' },
    ];

    beforeEach(() => {
        vi.useRealTimers();
        resetMockMapState();
        playMock = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
        window.URL.createObjectURL = vi.fn(() => 'blob:test');
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            writable: true,
            value: null,
        });
        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
            configurable: true,
            writable: true,
            value: requestFullscreenMock,
        });
        fitBoundsMock.mockReset();
        setViewMock.mockReset();
        mapMock.flyTo.mockReset();
        mapMock.invalidateSize.mockReset();
        L.divIcon.mockClear();
        startSessionMock.mockClear();
        stopSessionMock.mockClear();
        hlsInstances.length = 0;
    });

    afterEach(() => {
        playMock?.mockRestore();
        vi.useRealTimers();
    });

    it('menyembunyikan filter area internal saat showAreaFilter=false', async () => {
        await act(async () => {
            render(<MapView cameras={cameras} areas={[]} showAreaFilter={false} />);
        });
        await waitFor(() => {
            expect(screen.queryByRole('combobox')).toBeNull();
        });
    });

    it('tetap merender filter area internal saat showAreaFilter=true', async () => {
        await act(async () => {
            render(<MapView cameras={cameras} areas={[]} showAreaFilter />);
        });
        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeTruthy();
        });
    });

    it('merender status bar compact dengan tiga label utama', async () => {
        await act(async () => {
            render(<MapView cameras={statusCameras} areas={[]} showAreaFilter={false} />);
        });

        await waitFor(() => {
            expect(screen.getByTestId('map-status-bar')).toBeTruthy();
        });

        expect(screen.getByText('Online 1')).toBeTruthy();
        expect(screen.getByText('Tunnel 1')).toBeTruthy();
        expect(screen.getByText('Offline 2')).toBeTruthy();
    });

    it('tidak lagi merender label perbaikan pada status bar compact', async () => {
        await act(async () => {
            render(<MapView cameras={statusCameras} areas={[]} showAreaFilter={false} />);
        });

        await waitFor(() => {
            expect(screen.getByTestId('map-status-bar')).toBeTruthy();
        });

        expect(screen.queryByText(/Perbaikan/i)).toBeNull();
    });

    it('langsung menampilkan status perbaikan saat kamera maintenance dibuka dari map tanpa loading', async () => {
        await act(async () => {
            render(<MapView cameras={statusCameras} areas={[]} showAreaFilter={false} />);
        });

        fireEvent.click(screen.getByTestId('marker--7.151-111.8818'));

        await waitFor(() => {
            expect(screen.getByText('Dalam Perbaikan')).toBeTruthy();
        });

        expect(screen.getByText('PERBAIKAN')).toBeTruthy();
        expect(screen.getByTestId('map-video-body')).toBeTruthy();
        expect(screen.queryByText('Menghubungkan...')).toBeNull();
        expect(screen.queryByTitle('Zoom In')).toBeNull();
        expect(screen.queryByTitle('Fullscreen')).toBeNull();
        expect(screen.getByTitle('Tutup')).toBeTruthy();
        expect(startSessionMock).not.toHaveBeenCalledWith(4);
    });

    it('langsung menampilkan status offline saat kamera offline dibuka dari map tanpa loading', async () => {
        await act(async () => {
            render(<MapView cameras={statusCameras} areas={[]} showAreaFilter={false} />);
        });

        fireEvent.click(screen.getByTestId('marker--7.1509-111.8817'));

        await waitFor(() => {
            expect(screen.getByText('Kamera Offline')).toBeTruthy();
        });

        expect(screen.getByText('OFFLINE')).toBeTruthy();
        expect(screen.getByTestId('map-video-body')).toBeTruthy();
        expect(screen.queryByText('Menghubungkan...')).toBeNull();
        expect(screen.queryByTitle('Zoom In')).toBeNull();
        expect(screen.queryByTitle('Fullscreen')).toBeNull();
        expect(screen.getByTitle('Tutup')).toBeTruthy();
        expect(startSessionMock).not.toHaveBeenCalledWith(3);
    });

    it('menampilkan status perbaikan yang benar pada top bar fullscreen map', async () => {
        await act(async () => {
            render(<MapView cameras={statusCameras} areas={[]} showAreaFilter={false} />);
        });

        fireEvent.click(screen.getByTestId('marker--7.151-111.8818'));

        await waitFor(() => {
            expect(screen.getByText('Dalam Perbaikan')).toBeTruthy();
        });

        document.fullscreenElement = {};
        fireEvent(document, new Event('fullscreenchange'));

        await waitFor(() => {
            expect(screen.getByText('PERBAIKAN')).toBeTruthy();
        });
    });

    it('menampilkan status offline yang benar pada top bar fullscreen map', async () => {
        await act(async () => {
            render(<MapView cameras={statusCameras} areas={[]} showAreaFilter={false} />);
        });

        fireEvent.click(screen.getByTestId('marker--7.1509-111.8817'));

        await waitFor(() => {
            expect(screen.getByText('Kamera Offline')).toBeTruthy();
        });

        document.fullscreenElement = {};
        fireEvent(document, new Event('fullscreenchange'));

        await waitFor(() => {
            expect(screen.getByText('OFFLINE')).toBeTruthy();
        });
    });

    it('mengikuti area baru setelah marker dibuka lalu area internal diganti', async () => {
        await act(async () => {
            render(<MapView cameras={areaCameras} areas={areas} showAreaFilter />);
        });

        setViewMock.mockClear();
        fitBoundsMock.mockClear();

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        await waitFor(() => {
            expect(startSessionMock).toHaveBeenCalledWith(1);
        });

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Baureno' } });

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.2507, 112.0815], 15, { animate: true, duration: 0.5 });
        });
        expect(fitBoundsMock).not.toHaveBeenCalled();
    });

    it('mengikuti area baru saat selectedArea dikontrol parent setelah modal pernah dibuka', async () => {
        const { rerender } = render(
            <MapView cameras={areaCameras} areas={areas} showAreaFilter selectedArea="Dander" />
        );

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.1507, 111.8815], 15, { animate: true, duration: 0.5 });
        });

        setViewMock.mockClear();

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        await waitFor(() => {
            expect(startSessionMock).toHaveBeenCalledWith(1);
        });

        rerender(<MapView cameras={areaCameras} areas={areas} showAreaFilter selectedArea="Baureno" />);

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.2507, 112.0815], 15, { animate: true, duration: 0.5 });
        });
    });

    it('menjaga posisi map saat modal ditutup tanpa ganti area', async () => {
        await act(async () => {
            render(<MapView cameras={areaCameras} areas={areas} showAreaFilter selectedArea="Dander" />);
        });

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalled();
        });

        setViewMock.mockClear();
        fitBoundsMock.mockClear();

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        await waitFor(() => {
            expect(screen.getByTitle('Tutup')).toBeTruthy();
        });

        fireEvent.click(screen.getByTitle('Tutup'));

        await act(async () => {
            await Promise.resolve();
        });

        expect(setViewMock).not.toHaveBeenCalled();
        expect(fitBoundsMock).not.toHaveBeenCalled();
    });

    it('membatalkan pending focus lama saat area berubah sebelum modal dibuka', async () => {
        const onFocusHandled = vi.fn();
        const { rerender } = render(
            <MapView
                cameras={areaCameras}
                areas={areas}
                showAreaFilter
                selectedArea="all"
                focusedCameraId={1}
                onFocusHandled={onFocusHandled}
            />
        );

        await act(async () => {
            await Promise.resolve();
        });
        expect(onFocusHandled).toHaveBeenCalled();

        rerender(
            <MapView
                cameras={areaCameras}
                areas={areas}
                showAreaFilter
                selectedArea="Baureno"
                focusedCameraId={null}
                onFocusHandled={onFocusHandled}
            />
        );

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 700));
        });

        expect(screen.queryByText('Lobby')).toBeNull();
    });

    it('menyesuaikan rasio body live map dari metadata video 4:3', async () => {
        await act(async () => {
            render(<MapView cameras={cameras} areas={[]} showAreaFilter={false} />);
        });

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        const body = await screen.findByTestId('map-video-body');
        const video = document.querySelector('video');

        expect(body.style.aspectRatio).toBe(String(16 / 9));
        expect(video).toBeTruthy();
        await act(async () => {
            await Promise.resolve();
        });

        Object.defineProperty(video, 'videoWidth', {
            configurable: true,
            value: 640,
        });
        Object.defineProperty(video, 'videoHeight', {
            configurable: true,
            value: 480,
        });

        await act(async () => {
            video.dispatchEvent(new Event('loadedmetadata'));
        });

        await waitFor(() => {
            expect(body.style.aspectRatio).toBe(String(4 / 3));
        });
    });
    it('menormalkan rasio body live map yang padded dekat 16:9', async () => {
        await act(async () => {
            render(<MapView cameras={cameras} areas={[]} showAreaFilter={false} />);
        });

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        const body = await screen.findByTestId('map-video-body');
        const video = document.querySelector('video');

        expect(video).toBeTruthy();

        Object.defineProperty(video, 'videoWidth', {
            configurable: true,
            value: 1920,
        });
        Object.defineProperty(video, 'videoHeight', {
            configurable: true,
            value: 1088,
        });

        await act(async () => {
            video.dispatchEvent(new Event('loadedmetadata'));
        });

        await waitFor(() => {
            expect(body.style.aspectRatio).toBe(String(16 / 9));
        });
    });

    it('mengikuti lebar modal popup shared yang dipakai grid view pada desktop', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });

        await act(async () => {
            render(<MapView cameras={cameras} areas={[]} showAreaFilter={false} />);
        });

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        const modal = await screen.findByTestId('map-popup-modal');

        await waitFor(() => {
            expect(modal.style.width).toBe('1024px');
        });
    });

    it('double click pada body video map memicu fullscreen seperti grid view', async () => {
        await act(async () => {
            render(<MapView cameras={cameras} areas={[]} showAreaFilter={false} />);
        });

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        const body = await screen.findByTestId('map-video-body');
        fireEvent.doubleClick(body);

        await waitFor(() => {
            expect(requestFullscreenMock).toHaveBeenCalled();
        });
    });

    it('mengirim kamera ke host halaman dan tidak merender popup lokal saat onCameraOpen tersedia', async () => {
        const onCameraOpen = vi.fn();

        await act(async () => {
            render(
                <MapView
                    cameras={cameras}
                    areas={[]}
                    showAreaFilter={false}
                    onCameraOpen={onCameraOpen}
                />
            );
        });

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        await waitFor(() => {
            expect(onCameraOpen).toHaveBeenCalledWith(expect.objectContaining({
                id: 1,
                name: 'Lobby',
            }));
        });

        expect(screen.queryByTestId('map-popup-modal')).toBeNull();
    });

    it('tetap memprioritaskan sponsor bawah popup map pada desktop saat kedua slot aktif', async () => {
        await act(async () => {
            render(
                <MapView
                    cameras={cameras}
                    areas={[]}
                    showAreaFilter={false}
                    adsConfig={{
                        enabled: true,
                        devices: { desktop: true, mobile: true },
                        popup: {
                            enabled: true,
                            preferredSlot: 'top',
                            hideSocialBarOnPopup: true,
                            hideFloatingWidgetsOnPopup: true,
                            maxHeight: {
                                desktop: 160,
                                mobile: 220,
                            },
                        },
                        slots: {
                            popupTopBanner: {
                                enabled: true,
                                script: '<div>popup top ad map</div>',
                            },
                            popupBottomNative: {
                                enabled: true,
                                script: '<div>popup bottom ad map</div>',
                            },
                        },
                    }}
                />
            );
        });

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        await waitFor(() => {
            expect(screen.getByText('popup bottom ad map')).toBeTruthy();
        });

        expect(screen.queryByText('popup top ad map')).toBeNull();
    });

    it('merender aggregate marker saat zoom rendah untuk area padat', async () => {
        const denseCameras = Array.from({ length: 30 }, (_, index) => ({
            id: index + 1,
            name: `Dense ${index + 1}`,
            latitude: (-7.1507 + (index * 0.0001)).toFixed(4),
            longitude: (111.8815 + (index * 0.0001)).toFixed(4),
            area_name: 'Dense Area',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        const denseAreas = [
            { name: 'Dense Area', latitude: '-7.1400', longitude: '111.8900' },
        ];

        setMockZoom(11);

        await act(async () => {
            render(<MapView cameras={denseCameras} areas={denseAreas} showAreaFilter />);
        });

        await waitFor(() => {
            expect(screen.getAllByText('marker')).toHaveLength(1);
        });

        expect(screen.getAllByText('marker')[0]).toBeTruthy();
        expect(screen.getByTestId('map-zoom-hint')).toBeTruthy();
        const aggregateIconCall = L.divIcon.mock.calls.at(-1)?.[0];
        expect(aggregateIconCall?.html).not.toContain('AREA');
        expect(aggregateIconCall?.html).not.toContain('GROUP');
        expect(aggregateIconCall?.iconSize).toEqual([50, 50]);
    });

    it('tidak membiarkan overlay zoom hint menutup kontrol layer map', async () => {
        const denseCameras = Array.from({ length: 30 }, (_, index) => ({
            id: index + 1,
            name: `Dense ${index + 1}`,
            latitude: (-7.1507 + (index * 0.0001)).toFixed(4),
            longitude: (111.8815 + (index * 0.0001)).toFixed(4),
            area_name: 'Dense Area',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        setMockZoom(11);

        await act(async () => {
            render(<MapView cameras={denseCameras} areas={[]} showAreaFilter />);
        });

        const zoomHint = screen.getByTestId('map-zoom-hint');
        const areaFilterPanel = screen.getByTestId('map-area-filter-panel');
        const mapChrome = zoomHint.closest('[data-testid="map-top-chrome"]');
        const mapChromeControls = zoomHint.closest('[data-testid="map-top-chrome-controls"]');

        expect(mapChrome?.className).toContain('pointer-events-none');
        expect(mapChromeControls?.className).toContain('pointer-events-none');
        expect(zoomHint.className).toContain('pointer-events-none');
        expect(areaFilterPanel.className).toContain('pointer-events-auto');
    });

    it('menggunakan hotspot spasial di mode all-area untuk area besar yang tersebar', async () => {
        const makeCluster = (startId, count, baseLat, baseLng) => Array.from({ length: count }, (_, index) => ({
            id: startId + index,
            name: `Bojonegoro ${startId + index}`,
            latitude: (baseLat + (index * 0.00005)).toFixed(5),
            longitude: (baseLng + (index * 0.00005)).toFixed(5),
            area_name: 'BOJONEGORO',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        const spreadCameras = [
            ...makeCluster(1, 13, -7.1500, 111.8800),
            ...makeCluster(101, 42, -7.3100, 111.6500),
            ...makeCluster(201, 40, -7.0200, 112.0300),
        ];

        setMockZoom(11);

        await act(async () => {
            render(
                <MapView
                    cameras={spreadCameras}
                    areas={[{ name: 'BOJONEGORO', latitude: '-7.1500', longitude: '111.8800' }]}
                    showAreaFilter
                />
            );
        });

        await waitFor(() => {
            expect(screen.getAllByText('marker')).toHaveLength(3);
        });

        const aggregateIconCalls = L.divIcon.mock.calls
            .map((call) => call[0])
            .filter((call) => Array.isArray(call?.iconSize) && call.iconSize[0] === 50);

        expect(aggregateIconCalls).toHaveLength(3);
        expect(aggregateIconCalls.some((call) => call.html.includes('13'))).toBe(true);
        expect(aggregateIconCalls.some((call) => call.html.includes('42'))).toBe(true);
        expect(aggregateIconCalls.some((call) => call.html.includes('40'))).toBe(true);
        expect(aggregateIconCalls.some((call) => call.html.includes('95'))).toBe(false);
    });

    it('menggabungkan all-area menjadi satu marker per area saat zoom sangat rendah', async () => {
        const makeCluster = (startId, count, baseLat, baseLng, areaName) => Array.from({ length: count }, (_, index) => ({
            id: startId + index,
            name: `${areaName} ${startId + index}`,
            latitude: (baseLat + (index * 0.00005)).toFixed(5),
            longitude: (baseLng + (index * 0.00005)).toFixed(5),
            area_name: areaName,
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        const areaCameras = [
            ...makeCluster(1, 13, -7.1500, 111.8800, 'BOJONEGORO'),
            ...makeCluster(101, 42, -7.3100, 111.6500, 'BOJONEGORO'),
            ...makeCluster(201, 40, -7.0200, 112.0300, 'BOJONEGORO'),
            ...makeCluster(301, 19, -7.2600, 112.7300, 'GRESIK'),
        ];
        const bojonegoroCameras = areaCameras.filter((camera) => camera.area_name === 'BOJONEGORO');
        const bojonegoroCenter = [
            bojonegoroCameras.reduce((sum, camera) => sum + parseFloat(camera.latitude), 0) / bojonegoroCameras.length,
            bojonegoroCameras.reduce((sum, camera) => sum + parseFloat(camera.longitude), 0) / bojonegoroCameras.length,
        ];

        setMockZoom(10);

        await act(async () => {
            render(
                <MapView
                    cameras={areaCameras}
                    areas={[
                        { name: 'BOJONEGORO', latitude: '-7.1500', longitude: '111.8800' },
                        { name: 'GRESIK', latitude: '-7.2600', longitude: '112.7300' },
                    ]}
                    showAreaFilter
                />
            );
        });

        await waitFor(() => {
            expect(screen.getAllByText('marker')).toHaveLength(2);
        });

        const aggregateIconCalls = L.divIcon.mock.calls
            .map((call) => call[0])
            .filter((call) => Array.isArray(call?.iconSize) && call.iconSize[0] === 58);

        expect(aggregateIconCalls).toHaveLength(2);
        expect(aggregateIconCalls.some((call) => call.html.includes('95'))).toBe(true);
        expect(aggregateIconCalls.some((call) => call.html.includes('19'))).toBe(true);

        const [areaMarker] = screen.getAllByText('marker');
        expect(areaMarker).toBeTruthy();

        setViewMock.mockClear();
        fitBoundsMock.mockClear();

        fireEvent.click(areaMarker);

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith(bojonegoroCenter, 15, { animate: true, duration: 0.5 });
        });

        expect(fitBoundsMock).not.toHaveBeenCalled();
    });

    it('mengabaikan child camera tanpa koordinat valid saat all-area zoom rendah', async () => {
        const validAreaCameras = Array.from({ length: 30 }, (_, index) => ({
            id: index + 1,
            name: `BOJONEGORO ${index + 1}`,
            latitude: (-7.15 + (index * 0.0001)).toFixed(5),
            longitude: (111.88 + (index * 0.0001)).toFixed(5),
            area_name: 'BOJONEGORO',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        const cameras = [
            ...validAreaCameras,
            {
                id: 999,
                name: 'Broken Coord',
                latitude: 'NaN',
                longitude: 'NaN',
                area_name: 'BOJONEGORO',
                is_online: 1,
                status: 'active',
                is_tunnel: 0,
            },
        ];

        setMockZoom(10);

        await act(async () => {
            render(
                <MapView
                    cameras={cameras}
                    areas={[{ name: 'BOJONEGORO', latitude: '-7.1500', longitude: '111.8800' }]}
                    showAreaFilter
                />
            );
        });

        await waitFor(() => {
            expect(screen.getAllByText('marker')).toHaveLength(1);
        });

        expect(screen.getByTestId(/marker-/)).toBeTruthy();
    });

    it('memusatkan cluster all-area ke centroid dan klik cluster melakukan fitBounds ke child cameras', async () => {
        const clusterCameras = [
            {
                id: 1,
                name: 'Cluster 1',
                latitude: '-7.1500',
                longitude: '111.8800',
                area_name: 'BOJONEGORO',
                is_online: 1,
                status: 'active',
                is_tunnel: 0,
            },
            {
                id: 2,
                name: 'Cluster 2',
                latitude: '-7.1400',
                longitude: '111.9000',
                area_name: 'BOJONEGORO',
                is_online: 1,
                status: 'active',
                is_tunnel: 0,
            },
            {
                id: 3,
                name: 'Cluster 3',
                latitude: '-7.1300',
                longitude: '111.9200',
                area_name: 'BOJONEGORO',
                is_online: 1,
                status: 'active',
                is_tunnel: 0,
            },
        ];

        const fillerCameras = Array.from({ length: 27 }, (_, index) => ({
            id: 100 + index,
            name: `Filler ${index + 1}`,
            latitude: (-6.5000 - (index * 0.01)).toFixed(4),
            longitude: (112.5000 + (index * 0.01)).toFixed(4),
            area_name: 'Lainnya',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        setMockZoom(11);

        await act(async () => {
            render(
                <MapView
                    cameras={[...clusterCameras, ...fillerCameras]}
                    areas={[{ name: 'BOJONEGORO', latitude: '-7.1500', longitude: '111.8800' }]}
                    showAreaFilter
                />
            );
        });

        await waitFor(() => {
            expect(screen.getAllByText('marker').length).toBeGreaterThan(1);
        });

        expect(screen.getByTestId('marker--7.14-111.9')).toBeTruthy();

        fitBoundsMock.mockClear();
        setViewMock.mockClear();

        fireEvent.click(screen.getByTestId('marker--7.14-111.9'));

        await waitFor(() => {
            expect(fitBoundsMock).toHaveBeenCalledTimes(1);
        });

        expect(setViewMock).not.toHaveBeenCalled();
        expect(fitBoundsMock).toHaveBeenCalledWith(
            expect.objectContaining({
                getSouth: expect.any(Function),
                getWest: expect.any(Function),
                getNorth: expect.any(Function),
                getEast: expect.any(Function),
            }),
            expect.objectContaining({
                maxZoom: 16,
                paddingTopLeft: [50, 80],
                paddingBottomRight: [50, 40],
            })
        );
    });

    it('tetap menormalkan nama area untuk dropdown dan focus area walau all-area memakai hotspot', async () => {
        const denseCameras = Array.from({ length: 30 }, (_, index) => ({
            id: index + 1,
            name: `Gresik ${index + 1}`,
            latitude: '-7.1234',
            longitude: '112.5432',
            area_name: ' kab gresik ',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        const denseAreas = [
            { name: 'KAB   GRESIK', latitude: '-6.9000', longitude: '112.9000' },
        ];

        setMockZoom(11);

        await act(async () => {
            render(<MapView cameras={denseCameras} areas={denseAreas} showAreaFilter />);
        });

        await waitFor(() => {
            expect(screen.getAllByText('marker')).toHaveLength(1);
        });

        expect(screen.getByRole('combobox').value).toBe('all');
        expect(screen.getByRole('option', { name: /kab gresik/i })).toBeTruthy();
    });

    it('tetap aman saat semua kamera area tidak punya koordinat valid', async () => {
        const missingCoordCameras = Array.from({ length: 30 }, (_, index) => ({
            id: index + 1,
            name: `Area Hilang ${index + 1}`,
            latitude: '0',
            longitude: '0',
            area_name: 'Area Tanpa Anchor',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        await act(async () => {
            render(<MapView cameras={missingCoordCameras} areas={[]} showAreaFilter />);
        });

        expect(screen.getByText(/koordinat kamera belum diatur/i)).toBeTruthy();
    });

    it('menahan ledakan marker individual dengan micro-bucket saat zoom tinggi sangat padat', async () => {
        const makeDenseGroup = (startId, count, latitude, longitude) => Array.from({ length: count }, (_, index) => ({
            id: startId + index,
            name: `Dense High ${startId + index}`,
            latitude,
            longitude,
            area_name: 'Dense Area',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        const denseCameras = [
            ...makeDenseGroup(1, 35, '-7.1500', '111.8800'),
            ...makeDenseGroup(101, 35, '-7.1600', '111.8900'),
            ...makeDenseGroup(201, 35, '-7.1700', '111.9000'),
            ...makeDenseGroup(301, 35, '-7.1800', '111.9100'),
        ];

        setMockZoom(16);

        await act(async () => {
            render(<MapView cameras={denseCameras} areas={[]} showAreaFilter selectedArea="Dense Area" />);
        });

        await waitFor(() => {
            expect(screen.getAllByText('marker')).toHaveLength(4);
        });

        const aggregateIconCalls = L.divIcon.mock.calls
            .map((call) => call[0])
            .filter((call) => Array.isArray(call?.iconSize) && call.iconSize[0] === 50);

        expect(aggregateIconCalls.some((call) => call.html.includes('35'))).toBe(true);
    });

    it('merender marker individual saat zoom tinggi pada area padat', async () => {
        const denseCameras = Array.from({ length: 30 }, (_, index) => ({
            id: index + 1,
            name: `Dense ${index + 1}`,
            latitude: (-7.1507 + (index * 0.0001)).toFixed(4),
            longitude: (111.8815 + (index * 0.0001)).toFixed(4),
            area_name: 'Dense Area',
            is_online: 1,
            status: 'active',
            is_tunnel: 0,
        }));

        setMockZoom(16);

        await act(async () => {
            render(<MapView cameras={denseCameras} areas={[]} showAreaFilter />);
        });

        await waitFor(() => {
            expect(screen.getAllByText('marker')).toHaveLength(30);
        });

        expect(screen.getByTestId('marker--7.1507-111.8815')).toBeTruthy();
        expect(screen.queryByTestId('map-zoom-hint')).toBeNull();
    });

    it('membedakan profile bucket marker tanpa label teks', async () => {
        const denseCameras = Array.from({ length: 30 }, (_, index) => ({
            id: index + 1,
            name: `Dense ${index + 1}`,
            latitude: '-7.1507',
            longitude: '111.8815',
            area_name: 'Dense Area',
            is_online: index % 4 === 0 ? 0 : 1,
            status: 'active',
            is_tunnel: 0,
        }));

        setMockZoom(14);

        await act(async () => {
            render(<MapView cameras={denseCameras} areas={[]} showAreaFilter selectedArea="Dense Area" />);
        });

        await waitFor(() => {
            expect(screen.getAllByText('marker')).toHaveLength(1);
        });

        const bucketIconCall = L.divIcon.mock.calls.at(-1)?.[0];
        expect(bucketIconCall?.html).not.toContain('AREA');
        expect(bucketIconCall?.html).not.toContain('GROUP');
        expect(bucketIconCall?.iconSize).toEqual([50, 50]);
    });

    it('tidak mereset viewport saat user sudah drag lalu rerender dengan area yang sama', async () => {
        const { rerender } = render(
            <MapView cameras={areaCameras} areas={areas} showAreaFilter selectedArea="Dander" />
        );

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.1507, 111.8815], 15, { animate: true, duration: 0.5 });
        });

        setViewMock.mockClear();

        act(() => {
            mapEventHandlers.dragstart?.();
            mapEventHandlers.zoomend?.();
        });

        rerender(
            <MapView cameras={areaCameras} areas={areas} showAreaFilter selectedArea="Dander" />
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(setViewMock).not.toHaveBeenCalled();
    });

    it('menjalankan reset view eksplisit ke area aktif', async () => {
        render(<MapView cameras={areaCameras} areas={areas} showAreaFilter selectedArea="Baureno" />);

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.2507, 112.0815], 15, { animate: true, duration: 0.5 });
        });

        setViewMock.mockClear();

        fireEvent.click(screen.getByTestId('map-reset-view'));

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.2507, 112.0815], 15, { animate: true, duration: 0.5 });
        });
    });

    it('menggunakan fitBounds dengan zoom kabupaten saat coverage area luas', async () => {
        const broadAreaCameras = [
            {
                id: 11,
                name: 'Barat',
                latitude: '-7.1200',
                longitude: '111.8200',
                area_name: 'Bojonegoro',
                is_online: 1,
                status: 'active',
                is_tunnel: 0,
            },
            {
                id: 12,
                name: 'Timur',
                latitude: '-7.3000',
                longitude: '112.0500',
                area_name: 'Bojonegoro',
                is_online: 1,
                status: 'active',
                is_tunnel: 0,
            },
            {
                id: 13,
                name: 'Utara',
                latitude: '-7.0000',
                longitude: '111.9500',
                area_name: 'Bojonegoro',
                is_online: 1,
                status: 'active',
                is_tunnel: 0,
            },
            {
                id: 14,
                name: 'Selatan',
                latitude: '-7.3600',
                longitude: '111.9000',
                area_name: 'Bojonegoro',
                is_online: 1,
                status: 'active',
                is_tunnel: 0,
            },
        ];
        const broadAreas = [
            {
                name: 'Bojonegoro',
                latitude: '-7.1500',
                longitude: '111.9000',
                coverage_scope: 'kabupaten_kota',
            },
        ];

        render(<MapView cameras={broadAreaCameras} areas={broadAreas} showAreaFilter selectedArea="Bojonegoro" />);

        await waitFor(() => {
            expect(fitBoundsMock).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    maxZoom: 10,
                })
            );
        });

        expect(setViewMock).not.toHaveBeenCalledWith([-7.15, 111.9], 15, { animate: true, duration: 0.5 });
    });

    it('tetap memakai marker aggregate saat zoom sangat rendah di mode all-area meski jumlah kamera sedikit', async () => {
        setMockZoom(10);

        render(
            <MapView
                cameras={[
                    {
                        id: 21,
                        name: 'Cam 1',
                        latitude: '-7.1500',
                        longitude: '111.8800',
                        area_name: 'Dander',
                        is_online: 1,
                        status: 'active',
                        is_tunnel: 0,
                    },
                    {
                        id: 22,
                        name: 'Cam 2',
                        latitude: '-7.1510',
                        longitude: '111.8810',
                        area_name: 'Dander',
                        is_online: 1,
                        status: 'active',
                        is_tunnel: 0,
                    },
                    {
                        id: 23,
                        name: 'Cam 3',
                        latitude: '-7.2900',
                        longitude: '111.7200',
                        area_name: 'Baureno',
                        is_online: 1,
                        status: 'active',
                        is_tunnel: 0,
                    },
                ]}
                areas={[
                    { name: 'Dander', latitude: '-7.1500', longitude: '111.8800' },
                    { name: 'Baureno', latitude: '-7.2900', longitude: '111.7200' },
                ]}
                showAreaFilter
                selectedArea="all"
            />
        );

        await waitFor(() => {
            const aggregateIconCalls = L.divIcon.mock.calls
                .map((call) => call[0])
                .filter((call) => Array.isArray(call?.iconSize) && call.iconSize[0] === 58);

            expect(aggregateIconCalls.some((call) => call.html.includes('2'))).toBe(true);
            expect(aggregateIconCalls.some((call) => call.html.includes('1'))).toBe(true);
        });
    });
});

