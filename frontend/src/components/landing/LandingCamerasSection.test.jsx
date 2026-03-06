// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingCamerasSection from './LandingCamerasSection';

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({
        cameras: [
            { id: 1, name: 'Lobby', area_name: 'Dander', latitude: '-7.1', longitude: '111.8', is_tunnel: 0, status: 'active', enable_recording: 1 },
            { id: 2, name: 'Gate', area_name: 'Dander', latitude: '-7.2', longitude: '111.9', is_tunnel: 1, status: 'active', enable_recording: 1 },
        ],
        areas: [{ id: 1, name: 'Dander' }],
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
    default: () => <div>results-grid</div>,
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
        expect(screen.getByText('Filter Area:')).toBeTruthy();
        expect(screen.queryByText(/Stabil \(/)).toBeNull();
    });

    it('mode playback tidak menampilkan filter area global', () => {
        render(<LandingCamerasSection {...commonProps} viewMode="playback" />);
        expect(screen.queryByText('Filter Area:')).toBeNull();
        expect(screen.getByText('playback-panel')).toBeTruthy();
    });
});
