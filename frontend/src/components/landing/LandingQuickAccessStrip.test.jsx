/*
 * Purpose: Verify public quick access strip renders favorites and recent cameras and opens selected cameras.
 * Caller: Frontend focused landing quick access test gate.
 * Deps: React Testing Library, Vitest, LandingQuickAccessStrip.
 * MainFuncs: Quick access rendering tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingQuickAccessStrip from './LandingQuickAccessStrip';

describe('LandingQuickAccessStrip', () => {
    it('renders favorite and recent cameras with the same camera click path', () => {
        const onCameraClick = vi.fn();

        render(
            <LandingQuickAccessStrip
                favoriteCameras={[{ id: 1, name: 'CCTV Favorit', area_name: 'Dander' }]}
                recentCameras={[{ id: 2, name: 'CCTV Terakhir', area_name: 'Baureno' }]}
                onCameraClick={onCameraClick}
            />
        );

        expect(screen.getByRole('heading', { name: /Favorit/i })).toBeTruthy();
        expect(screen.getByRole('heading', { name: /Terakhir Dilihat/i })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /CCTV Favorit/i }));
        fireEvent.click(screen.getByRole('button', { name: /CCTV Terakhir/i }));

        expect(onCameraClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
        expect(onCameraClick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    });

    it('does not render when there are no quick access cameras', () => {
        const { container } = render(<LandingQuickAccessStrip />);
        expect(container.textContent).toBe('');
    });

    it('can render an empty favorite target for mobile dock users', () => {
        render(<LandingQuickAccessStrip forceVisible favoriteCameras={[]} recentCameras={[]} />);

        expect(screen.getByTestId('landing-quick-access')).toBeTruthy();
        expect(screen.getByText(/Belum ada kamera favorit/i)).toBeTruthy();
    });
});
