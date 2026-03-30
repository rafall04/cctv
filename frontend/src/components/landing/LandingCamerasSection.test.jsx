// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingCamerasSection from './LandingCamerasSection';

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({
        cameras: [
            { id: 1, name: 'Lobby', area_name: 'Dander', latitude: '-7.1', longitude: '111.8', is_tunnel: 0, status: 'active', enable_recording: 1 },
            { id: 2, name: 'Gate', area_name: 'Dander', latitude: '-7.2', longitude: '111.9', is_tunnel: 1, status: 'active', enable_recording: 1 },
            { id: 3, name: 'Square', area_name: 'Baureno', latitude: '-7.3', longitude: '112.0', is_tunnel: 0, status: 'active', enable_recording: 1 },
        ],
        areas: [
            { id: 1, name: 'Dander', show_on_grid_default: 1 },
            { id: 2, name: 'Baureno', show_on_grid_default: 0 },
        ],
        loading: false,
    }),
}));

vi.mock('./LandingMapPanel', () => ({
    default: () => <div>map-panel</div>,
}));

vi.mock('./LandingPlaybackPanel', () => ({
    default: () => <div>playback-panel</div>,
}));

vi.mock('./LandingResultsGrid', () => ({
    default: ({ cameras }) => <div>results-grid:{cameras.map((camera) => camera.name).join(',')}</div>,
}));

describe('LandingCamerasSection controls', () => {
    const commonProps = {
        onCameraClick: vi.fn(),
        onAddMulti: vi.fn(),
        multiCameras: [],
        setViewMode: vi.fn(),
        favorites: [],
        onToggleFavorite: vi.fn(),
        isFavorite: vi.fn(() => false),
    };

    beforeEach(() => {
        commonProps.onCameraClick.mockReset();
        commonProps.onAddMulti.mockReset();
        commonProps.setViewMode.mockReset();
    });

    it('mode map hanya menampilkan filter area tanpa connection tabs', () => {
        render(<LandingCamerasSection {...commonProps} viewMode="map" />);
        expect(screen.getByText('Area')).toBeTruthy();
        expect(screen.queryByText(/Stabil \(/)).toBeNull();
        expect(screen.queryByText(/Filter area diterapkan/i)).toBeNull();
    });

    it('mode playback tidak menampilkan filter area global', () => {
        render(<LandingCamerasSection {...commonProps} viewMode="playback" />);
        expect(screen.queryByText('Area')).toBeNull();
        expect(screen.getByText('playback-panel')).toBeTruthy();
        expect(screen.queryByText(/Pilih area lalu sempitkan/i)).toBeNull();
    });

    it('menutup dropdown search saat query kembali kosong', () => {
        render(<LandingCamerasSection {...commonProps} viewMode="map" />);

        const input = screen.getByPlaceholderText(/Cari kamera berdasarkan nama/i);
        fireEvent.change(input, { target: { value: 'kamera-tidak-ada' } });
        fireEvent.focus(input);

        expect(screen.getByText(/Tidak ditemukan kamera/i)).toBeTruthy();

        fireEvent.change(input, { target: { value: '' } });

        expect(screen.queryByText(/Tidak ditemukan kamera/i)).toBeNull();
        expect(screen.queryByText('Lobby')).toBeNull();
        expect(screen.queryByText('Gate')).toBeNull();
    });

    it('grid default hanya memuat area yang diizinkan sampai user memilih area lain', () => {
        render(<LandingCamerasSection {...commonProps} viewMode="grid" />);

        expect(screen.getByText('results-grid:Lobby,Gate')).toBeTruthy();
        expect(screen.queryByText(/Square/)).toBeNull();

        fireEvent.change(screen.getByRole('combobox'), {
            target: { value: 'Baureno' },
        });

        expect(screen.getByText('results-grid:Square')).toBeTruthy();
    });
});
