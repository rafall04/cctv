/*
 * Purpose: Verify public camera detail panel exposes trust, action, and area navigation metadata in video popups.
 * Caller: Frontend focused public popup detail test gate.
 * Deps: React Testing Library, Vitest, CameraDetailPanel.
 * MainFuncs: CameraDetailPanel rendering/action tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CameraDetailPanel from './CameraDetailPanel';

describe('CameraDetailPanel', () => {
    it('renders camera trust metadata and actions', () => {
        const onShare = vi.fn();
        const onToggleFavorite = vi.fn();

        render(
            <CameraDetailPanel
                camera={{
                    id: 12,
                    name: 'CCTV Alun Alun',
                    area_name: 'KAB BOJONEGORO',
                    location: 'Utara alun-alun',
                    description: 'Pantau area publik',
                    enable_recording: 1,
                    is_online: 1,
                    live_viewers: 8,
                    total_views: 120,
                }}
                isFavorite={false}
                onShare={onShare}
                onToggleFavorite={onToggleFavorite}
            />
        );

        expect(screen.getByTestId('camera-detail-panel')).toBeTruthy();
        expect(screen.getByText('Ramai')).toBeTruthy();
        expect(screen.getByText('8 live')).toBeTruthy();
        expect(screen.getByText('120 views')).toBeTruthy();
        expect(screen.getByText('Playback tersedia')).toBeTruthy();
        expect(screen.queryByText('Pantau area publik')).toBeNull();
        expect(screen.getByRole('link', { name: /Buka area/i }).getAttribute('href')).toBe('/area/kab-bojonegoro');

        fireEvent.click(screen.getByRole('button', { name: /Bagikan/i }));
        fireEvent.click(screen.getByRole('button', { name: /Tambah favorit/i }));

        expect(onShare).toHaveBeenCalledTimes(1);
        expect(onToggleFavorite).toHaveBeenCalledWith(12);
    });

    it('prefers canonical area slug for area navigation when available', () => {
        render(
            <CameraDetailPanel
                camera={{
                    id: 13,
                    name: 'CCTV Surabaya',
                    area_name: 'KAB SURABAYA',
                    area_slug: 'kab-surabaya',
                    total_views: 1,
                    live_viewers: 0,
                }}
                onShare={vi.fn()}
            />
        );

        expect(screen.getByRole('link', { name: /Buka area/i }).getAttribute('href')).toBe('/area/kab-surabaya');
    });
});
