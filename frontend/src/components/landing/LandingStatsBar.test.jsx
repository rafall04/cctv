/*
 * Purpose: Regression test for public landing stats modal scroll locking and keyboard dismissal.
 * Caller: Frontend Vitest suite for public landing components.
 * Deps: React Testing Library, Vitest, LandingStatsBar, camera and animation mocks.
 * MainFuncs: Verifies modal open/close behavior and body scroll state.
 * SideEffects: Mocks camera and animation helpers during test execution.
 */
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingStatsBar from './LandingStatsBar';

vi.mock('../../contexts/CameraContext', () => ({
    useCameras: () => ({
        cameras: [
            { id: 1, name: 'CCTV Online', status: 'active', is_online: true, area_name: 'Area 1', location: 'Lokasi A' },
            { id: 2, name: 'CCTV Offline', status: 'active', is_online: false },
            { id: 3, name: 'CCTV Maintenance', status: 'maintenance', is_online: false },
        ],
        areas: [{ id: 10, name: 'Area 1' }],
    }),
}));

vi.mock('../../utils/animationControl', () => ({
    shouldDisableAnimations: () => true,
}));

describe('LandingStatsBar', () => {
    it('mengunci scroll dan menutup modal dengan Escape', async () => {
        render(<LandingStatsBar onCameraClick={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /Online Kamera/i }));

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
        });
        expect(document.body.style.overflow).toBe('hidden');

        fireEvent.keyDown(window, { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
        });
        expect(document.body.style.overflow).toBe('');
    });
});
