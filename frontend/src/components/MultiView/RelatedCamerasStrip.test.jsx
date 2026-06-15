/*
 * Purpose: Verify related public cameras can be opened from the video popup context.
 * Caller: Frontend focused public popup related camera test gate.
 * Deps: React Testing Library, Vitest, RelatedCamerasStrip.
 * MainFuncs: Related camera rendering tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RelatedCamerasStrip from './RelatedCamerasStrip';

describe('RelatedCamerasStrip', () => {
    it('renders related cameras and opens selected related camera', () => {
        const onCameraClick = vi.fn();

        render(
            <RelatedCamerasStrip
                cameras={[
                    { id: 2, name: 'CCTV Selatan', area_name: 'KAB BOJONEGORO', live_viewers: 3, total_views: 44 },
                    { id: 3, name: 'CCTV Utara', area_name: 'KAB BOJONEGORO', live_viewers: 0, total_views: 12 },
                    { id: 4, name: 'CCTV Barat', area_name: 'KAB BOJONEGORO', live_viewers: 1, total_views: 10 },
                    { id: 5, name: 'CCTV Timur', area_name: 'KAB BOJONEGORO', live_viewers: 2, total_views: 9 },
                ]}
                onCameraClick={onCameraClick}
            />
        );

        expect(screen.getByTestId('related-cameras-strip')).toBeTruthy();
        expect(screen.getByText('Terkait')).toBeTruthy();
        expect(screen.queryByText('CCTV Timur')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /CCTV Selatan/i }));

        expect(onCameraClick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    });

    it('renders a distance label when the camera carries _distanceMeters', () => {
        render(
            <RelatedCamerasStrip
                cameras={[
                    { id: 2, name: 'CCTV Dekat', live_viewers: 0, total_views: 5, _distanceMeters: 354 },
                    { id: 3, name: 'CCTV Jauh', live_viewers: 0, total_views: 5, _distanceMeters: 1234 },
                ]}
                onCameraClick={() => {}}
            />
        );

        expect(screen.getByText('350 m')).toBeTruthy();
        expect(screen.getByText('1,2 km')).toBeTruthy();
    });

    it('omits the distance label when _distanceMeters is absent', () => {
        render(
            <RelatedCamerasStrip
                cameras={[{ id: 2, name: 'CCTV Tanpa Koordinat', live_viewers: 0, total_views: 5 }]}
                onCameraClick={() => {}}
            />
        );

        expect(screen.queryByText(/km$/)).toBeNull();
        expect(screen.queryByText(/\bm$/)).toBeNull();
    });

    it('does not render without related cameras', () => {
        const { container } = render(<RelatedCamerasStrip cameras={[]} />);
        expect(container.textContent).toBe('');
    });
});
