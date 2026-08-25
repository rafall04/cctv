/*
 * Purpose: Guard the camera-count line against reporting "0 kamera tersedia" during an outage.
 * Caller: Frontend Vitest suite for public landing components.
 * Deps: React Testing Library, Vitest, LandingCameraToolbar, camera context mock.
 * MainFuncs: Verifies the memuat / tak terjangkau / ada data copy.
 * SideEffects: Mocks the camera context and the toolbar's child controls.
 */
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingCameraToolbar from './LandingCameraToolbar';

const cameraContextState = { dataUnavailable: false };

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({ dataUnavailable: cameraContextState.dataUnavailable }),
}));

vi.mock('./LandingSearchBox', () => ({ default: () => <div>search-box</div> }));
vi.mock('./LandingViewModeSwitch', () => ({ default: () => <div>view-switch</div> }));

const renderToolbar = (props = {}) => render(
    <LandingCameraToolbar
        title="CCTV Publik"
        camerasCount={0}
        viewMode="grid"
        onViewModeChange={() => {}}
        searchProps={{}}
        {...props}
    />
);

describe('LandingCameraToolbar', () => {
    beforeEach(() => {
        cameraContextState.dataUnavailable = false;
    });

    it('menyebut jumlah kamera saat data memang sudah diterima', () => {
        renderToolbar({ camerasCount: 12 });

        expect(screen.getByText('12')).toBeTruthy();
        expect(screen.getByText(/kamera tersedia/)).toBeTruthy();
    });

    it('menyebut "memuat" selama pemuatan awal, bukan nol', () => {
        renderToolbar({ isLoading: true });

        expect(screen.getByText('Memuat kamera…')).toBeTruthy();
        expect(screen.queryByText('0')).toBeNull();
    });

    // A failed initial load left this line reading "0 kamera tersedia" — a factual-sounding
    // claim that the public network is empty, printed above the retry-able error state.
    it('tidak menyatakan "0 kamera tersedia" saat data gagal diambil', () => {
        cameraContextState.dataUnavailable = true;

        renderToolbar();

        expect(screen.queryByText('0')).toBeNull();
        expect(screen.queryByText(/kamera tersedia/)).toBeNull();
        expect(screen.getByText('Kami belum bisa memuat daftar kamera.')).toBeTruthy();
    });
});
