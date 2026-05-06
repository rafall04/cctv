/*
 * Purpose: Verify public discovery sections for live ranking, top cameras, popular areas, and new cameras.
 * Caller: Frontend focused public landing discovery test gate.
 * Deps: React Testing Library, vitest, LandingPublicDiscovery.
 * MainFuncs: Public discovery render and interaction tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import LandingPublicDiscovery from './LandingPublicDiscovery';

const discovery = {
    live_now: [{ id: 1, name: 'CCTV Live', area_name: 'Area A', live_viewers: 5, total_views: 20 }],
    top_cameras: [{ id: 2, name: 'CCTV Top', area_name: 'Area B', live_viewers: 1, total_views: 90 }],
    new_cameras: [{ id: 3, name: 'CCTV Baru', area_name: 'Area C', created_at: '2026-05-06 08:00:00', total_views: 2 }],
    popular_areas: [{ id: 7, name: 'KAB SURABAYA', slug: 'kab-surabaya', camera_count: 12, live_viewers: 4, total_views: 120 }],
};

describe('LandingPublicDiscovery', () => {
    it('renders public discovery sections and opens selected cameras', () => {
        const onCameraClick = vi.fn();

        render(
            <MemoryRouter>
                <LandingPublicDiscovery discovery={discovery} onCameraClick={onCameraClick} />
            </MemoryRouter>
        );

        expect(screen.getByText('Sedang Ramai')).toBeTruthy();
        expect(screen.getByText('Area Populer')).toBeTruthy();
        expect(screen.getByText('Kamera Terbaru')).toBeTruthy();
        expect(screen.getByText('CCTV Live')).toBeTruthy();
        expect(screen.getByRole('link', { name: /KAB SURABAYA/i }).getAttribute('href')).toBe('/area/kab-surabaya');

        fireEvent.click(screen.getByRole('button', { name: /CCTV Top/i }));
        expect(onCameraClick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    });

    it('renders nothing when all discovery sections are empty', () => {
        const { container } = render(
            <MemoryRouter>
                <LandingPublicDiscovery discovery={{ live_now: [], top_cameras: [], new_cameras: [], popular_areas: [] }} />
            </MemoryRouter>
        );

        expect(container.firstChild).toBeNull();
    });
});
