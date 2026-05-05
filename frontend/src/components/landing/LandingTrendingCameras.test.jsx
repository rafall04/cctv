/*
 * Purpose: Verify public trending CCTV section rendering and interactions.
 * Caller: Frontend focused landing growth component test gate.
 * Deps: React Testing Library, vitest, LandingTrendingCameras.
 * MainFuncs: Trending camera render tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingTrendingCameras from './LandingTrendingCameras';

describe('LandingTrendingCameras', () => {
    it('renders nothing when there are no cameras', () => {
        const { container } = render(<LandingTrendingCameras cameras={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders top-viewed cameras and opens selected camera', async () => {
        const onCameraClick = vi.fn();
        render(
            <LandingTrendingCameras
                cameras={[{ id: 1, name: 'CCTV A', area_name: 'Area A', total_views: 24 }]}
                onCameraClick={onCameraClick}
            />
        );

        expect(screen.getByTestId('trending-cameras')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /CCTV A/i }));
        expect(onCameraClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });
});
