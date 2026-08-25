/*
 * Purpose: Regression test for public landing stats modal scroll locking and keyboard dismissal.
 * Caller: Frontend Vitest suite for public landing components.
 * Deps: React Testing Library, Vitest, LandingStatsBar, camera and animation mocks.
 * MainFuncs: Verifies modal open/close behavior and body scroll state.
 * SideEffects: Mocks camera and animation helpers during test execution.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingStatsBar from './LandingStatsBar';

const HEALTHY_CAMERAS = [
    { id: 1, name: 'CCTV Online', status: 'active', is_online: true, area_name: 'Area 1', location: 'Lokasi A' },
    { id: 2, name: 'CCTV Offline', status: 'active', is_online: false },
    { id: 3, name: 'CCTV Maintenance', status: 'maintenance', is_online: false },
];

const cameraContextState = {
    cameras: HEALTHY_CAMERAS,
    loading: false,
    dataUnavailable: false,
};

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({
        cameras: cameraContextState.cameras,
        areas: [{ id: 10, name: 'Area 1' }],
        loading: cameraContextState.loading,
        dataUnavailable: cameraContextState.dataUnavailable,
        refreshData: () => {},
    }),
}));

vi.mock('../../utils/animationControl', () => ({
    shouldDisableAnimations: () => true,
}));

describe('LandingStatsBar', () => {
    beforeEach(() => {
        cameraContextState.cameras = HEALTHY_CAMERAS;
        cameraContextState.loading = false;
        cameraContextState.dataUnavailable = false;
    });

    it('mengunci scroll dan menutup modal dengan Escape', async () => {
        render(<LandingStatsBar onCameraClick={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /kamera online/i }));

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
        });
        expect(screen.getByText('Kamera Online')).toBeTruthy();
        expect(screen.getByText('CCTV Online')).toBeTruthy();
        expect(document.body.style.overflow).toBe('hidden');

        fireEvent.keyDown(window, { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
        });
        expect(document.body.style.overflow).toBe('');
    });

    /*
     * Outage honesty, and parity with Simple mode. Full mode used to answer a failed initial
     * load by vanishing (`if (cameras.length === 0) return null`) while Simple mode answered
     * the SAME failure with a confident "0" — two public modes, two different stories.
     */
    it('menyatakan "belum diketahui", bukan nol, saat data gagal diambil', () => {
        cameraContextState.cameras = [];
        cameraContextState.dataUnavailable = true;

        render(<LandingStatsBar onCameraClick={vi.fn()} />);

        expect(screen.queryAllByText('0')).toHaveLength(0);
        expect(screen.getAllByText('…').length).toBe(5);
        expect(screen.getByText('Kami belum bisa mengambil data kamera saat ini.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
        // The board is still there (Simple mode shows it too) but nothing is drillable.
        expect(screen.queryByRole('button', { name: /kamera online/i })).toBeNull();
        expect([...document.querySelectorAll('[class*="status-live"]')]).toHaveLength(0);
    });
});
