// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapView from './MapView';

const {
    fitBoundsMock,
    setViewMock,
    startSessionMock,
    stopSessionMock,
    hlsInstances,
} = vi.hoisted(() => ({
    fitBoundsMock: vi.fn(),
    setViewMock: vi.fn(),
    startSessionMock: vi.fn().mockResolvedValue('session-1'),
    stopSessionMock: vi.fn().mockResolvedValue(undefined),
    hlsInstances: [],
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
    useMap: () => ({
        flyTo: vi.fn(),
        fitBounds: fitBoundsMock,
        setView: setViewMock,
        invalidateSize: vi.fn(),
    }),
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
        latLngBounds: vi.fn(() => ({
            isValid: () => true,
        })),
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

vi.mock('./CodecBadge', () => ({
    default: () => <div />,
}));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({ branding: { company_name: 'RAF NET' } }),
}));

vi.mock('../utils/snapshotHelper', () => ({
    takeSnapshot: vi.fn(),
}));

describe('MapView area filter visibility', () => {
    let playMock;
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
        playMock = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        window.URL.createObjectURL = vi.fn(() => 'blob:test');
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            writable: true,
            value: null,
        });
        fitBoundsMock.mockReset();
        setViewMock.mockReset();
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

    it('membatasi lebar modal live map desktop berdasarkan tinggi viewport yang tersedia', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });

        await act(async () => {
            render(<MapView cameras={cameras} areas={[]} showAreaFilter={false} />);
        });

        fireEvent.click(screen.getByTestId('marker--7.1507-111.8815'));

        const modal = await screen.findByTestId('map-popup-modal');

        await waitFor(() => {
            expect(modal.style.width).toBe('896px');
        });
    });
});

