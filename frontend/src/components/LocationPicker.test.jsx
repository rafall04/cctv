// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LocationPicker from './LocationPicker';

const { setViewMock } = vi.hoisted(() => ({
    setViewMock: vi.fn(),
}));

vi.mock('../services/settingsService', () => ({
    settingsService: {
        getMapCenter: vi.fn().mockResolvedValue({
            success: true,
            data: { latitude: -7.15, longitude: 111.88, zoom: 11 },
        }),
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
    },
}));

vi.mock('react-leaflet', () => ({
    MapContainer: ({ children, className }) => <div data-testid="location-picker-map" className={className}>{children}</div>,
    TileLayer: ({ url }) => <div data-testid="location-picker-tile-url">{url}</div>,
    Marker: ({ position }) => (
        <div data-testid="location-picker-marker">
            {position[0]},{position[1]}
        </div>
    ),
    useMapEvents: () => null,
    useMap: () => ({
        setView: setViewMock,
        getZoom: () => 13,
    }),
}));

describe('LocationPicker basemap toggle', () => {
    beforeEach(() => {
        setViewMock.mockReset();
    });

    it('menggunakan hybrid sebagai basemap default saat map dibuka', async () => {
        render(<LocationPicker latitude="" longitude="" onLocationChange={vi.fn()} />);

        expect(screen.getByText('Belum ada koordinat').className)
            .toContain('dark:text-gray-400');
        expect(screen.getByTestId('location-picker-collapsed-panel').className)
            .toContain('dark:bg-gray-900/40');
        expect(screen.getByRole('button', { name: 'Pilih di Peta' }).className)
            .toContain('bg-sky-600');
        expect(screen.getByRole('button', { name: 'GPS' }).className)
            .toContain('dark:text-emerald-300');
        expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /pilih di peta/i }));

        await waitFor(() => {
            expect(screen.getByTestId('location-picker-map-type')).toBeTruthy();
        });

        expect(screen.getByText('Klik peta untuk pilih lokasi').className).toContain('dark:text-gray-200');
        expect(screen.getByTestId('location-picker-tile-url').textContent)
            .toBe('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}');
        expect(screen.getByRole('button', { name: 'Hybrid' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Street' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Street' }).className)
            .toContain('dark:text-gray-300');
    });

    it('berpindah ke street tanpa mengubah koordinat yang sudah dipilih', async () => {
        render(
            <LocationPicker
                latitude="-7.150700"
                longitude="111.881500"
                onLocationChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /edit peta/i }));

        await waitFor(() => {
            expect(screen.getByTestId('location-picker-marker')).toBeTruthy();
        });

        expect(screen.getByText(/Lat: -7.150700/)).toBeTruthy();
        expect(screen.getByText(/Lng: 111.881500/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Street' }));

        expect(screen.getByTestId('location-picker-tile-url').textContent)
            .toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
        expect(screen.getByText(/Lat: -7.150700/)).toBeTruthy();
        expect(screen.getByText(/Lng: 111.881500/)).toBeTruthy();
        expect(screen.getByTestId('location-picker-marker').textContent)
            .toContain('-7.1507,111.8815');
    });

    it('menampilkan aksi hapus hanya saat koordinat tersedia dan hierarchy action tetap konsisten', () => {
        render(
            <LocationPicker
                latitude="-7.150700"
                longitude="111.881500"
                onLocationChange={vi.fn()}
            />
        );

        expect(screen.getByRole('button', { name: 'Hapus' }).className)
            .toContain('dark:text-red-400');
        expect(screen.getByRole('button', { name: 'GPS' }).className)
            .toContain('border-emerald-200');
        expect(screen.getByRole('button', { name: 'Edit Peta' }).className)
            .toContain('bg-sky-600');
        expect(screen.getByTestId('location-picker-actions').className)
            .toContain('flex-wrap');
    });

    it('menjaga pilihan basemap saat map ditutup lalu dibuka kembali dalam sesi yang sama', async () => {
        render(<LocationPicker latitude="" longitude="" onLocationChange={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /pilih di peta/i }));

        await waitFor(() => {
            expect(screen.getByTestId('location-picker-map-type')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Street' }));
        fireEvent.click(screen.getByRole('button', { name: /tutup peta/i }));
        fireEvent.click(screen.getByRole('button', { name: /pilih di peta/i }));

        await waitFor(() => {
            expect(screen.getByTestId('location-picker-tile-url').textContent)
                .toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
        });
    });

    it('tetap mengikuti koordinat baru dari props meski basemap sudah diganti', async () => {
        const { rerender } = render(
            <LocationPicker
                latitude="-7.150700"
                longitude="111.881500"
                onLocationChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /edit peta/i }));

        await waitFor(() => {
            expect(screen.getByTestId('location-picker-marker')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Street' }));

        rerender(
            <LocationPicker
                latitude="-7.250000"
                longitude="112.080000"
                onLocationChange={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.getByText(/Lat: -7.250000/)).toBeTruthy();
        });

        expect(screen.getByText(/Lng: 112.080000/)).toBeTruthy();
        expect(screen.getByTestId('location-picker-tile-url').textContent)
            .toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
        expect(screen.getByTestId('location-picker-marker').textContent)
            .toContain('-7.25,112.08');
    });
});
