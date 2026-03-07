// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MapView from './MapView';

vi.mock('react-leaflet', () => ({
    MapContainer: ({ children }) => <div data-testid="map-container">{children}</div>,
    TileLayer: () => <div />,
    Marker: () => <div />,
    ZoomControl: () => <div />,
    LayersControl: Object.assign(({ children }) => <div>{children}</div>, {
        BaseLayer: ({ children }) => <div>{children}</div>,
    }),
    useMap: () => ({
        flyTo: vi.fn(),
        fitBounds: vi.fn(),
        setView: vi.fn(),
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
        latLngBounds: vi.fn(() => ({})),
    },
}));

vi.mock('hls.js', () => ({
    default: function Hls() {},
}));

vi.mock('../services/settingsService', () => ({
    settingsService: {
        getMapCenter: vi.fn().mockResolvedValue({
            success: true,
            data: { latitude: -7.15, longitude: 111.88, zoom: 11, name: 'Semua Lokasi' },
        }),
    },
}));

vi.mock('../services/viewerService', () => ({
    viewerService: {},
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
        },
    ];

    beforeEach(() => {
        window.URL.createObjectURL = vi.fn(() => 'blob:test');
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
});
