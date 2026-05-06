/*
 * Purpose: Verify compact public discovery strip tabs for shared full/simple landing modes.
 * Caller: Frontend focused landing discovery strip test gate.
 * Deps: React Testing Library, React Router, Vitest, LandingDiscoveryStrip.
 * MainFuncs: Discovery strip tab switching and click interaction tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LandingDiscoveryStrip from './LandingDiscoveryStrip';

const discovery = {
    live_now: [{ id: 1, name: 'CCTV Live', area_name: 'Area A', live_viewers: 5, total_views: 20 }],
    top_cameras: [{ id: 2, name: 'CCTV Top', area_name: 'Area B', live_viewers: 1, total_views: 90 }],
    new_cameras: [{ id: 3, name: 'CCTV Baru', area_name: 'Area C', created_at: '2026-05-06 08:00:00', total_views: 2 }],
    popular_areas: [{ id: 7, name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 12, live_viewers: 4, total_views: 120 }],
};

describe('LandingDiscoveryStrip', () => {
    it('renders compact tabs and opens cameras from the active list', () => {
        const onCameraClick = vi.fn();

        render(
            <MemoryRouter>
                <LandingDiscoveryStrip discovery={discovery} onCameraClick={onCameraClick} />
            </MemoryRouter>
        );

        expect(screen.getByRole('tab', { name: /Sedang Ramai/i })).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Paling Ditonton/i })).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Area Populer/i })).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Kamera Terbaru/i })).toBeTruthy();
        expect(screen.getByText('CCTV Live')).toBeTruthy();
        expect(screen.queryByText('CCTV Top')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: /Paling Ditonton/i }));
        fireEvent.click(screen.getByRole('button', { name: /CCTV Top/i }));

        expect(onCameraClick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    });

    it('links area discovery items without camera click handling', () => {
        render(
            <MemoryRouter>
                <LandingDiscoveryStrip discovery={discovery} />
            </MemoryRouter>
        );

        fireEvent.click(screen.getByRole('tab', { name: /Area Populer/i }));

        const areaList = screen.getByTestId('landing-discovery-strip-list');
        const areaLink = within(areaList).getByRole('link', { name: /KAB SURABAYA/i });
        expect(areaLink.getAttribute('href')).toBe('/area/kab-surabaya');
    });
});
