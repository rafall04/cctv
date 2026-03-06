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
});
