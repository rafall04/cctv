// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
            expect(setViewMock).toHaveBeenCalledWith([-7.25, 112.08], 15, { animate: true, duration: 0.5 });
        });
        expect(fitBoundsMock).not.toHaveBeenCalled();
    });

    it('mengikuti area baru saat selectedArea dikontrol parent setelah modal pernah dibuka', async () => {
        const { rerender } = render(
            <MapView cameras={areaCameras} areas={areas} showAreaFilter selectedArea="Dander" />
        );

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.15, 111.88], 15, { animate: true, duration: 0.5 });
        });

        setViewMock.mockClear();

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        await waitFor(() => {
            expect(startSessionMock).toHaveBeenCalledWith(1);
        });

        rerender(<MapView cameras={areaCameras} areas={areas} showAreaFilter selectedArea="Baureno" />);

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.25, 112.08], 15, { animate: true, duration: 0.5 });
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

        expect(screen.queryByTestId('marker--7.1507-111.8815')).toBeNull();
        expect(screen.getByTestId('marker--7.14-111.89')).toBeTruthy();
        expect(screen.getByTestId('map-zoom-hint')).toBeTruthy();
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

    it('tidak mereset viewport saat user sudah drag lalu rerender dengan area yang sama', async () => {
        const { rerender } = render(
            <MapView cameras={areaCameras} areas={areas} showAreaFilter selectedArea="Dander" />
        );

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.15, 111.88], 15, { animate: true, duration: 0.5 });
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
            expect(setViewMock).toHaveBeenCalledWith([-7.25, 112.08], 15, { animate: true, duration: 0.5 });
        });

        setViewMock.mockClear();

        fireEvent.click(screen.getByTestId('map-reset-view'));

        await waitFor(() => {
            expect(setViewMock).toHaveBeenCalledWith([-7.25, 112.08], 15, { animate: true, duration: 0.5 });
        });
    });
});

