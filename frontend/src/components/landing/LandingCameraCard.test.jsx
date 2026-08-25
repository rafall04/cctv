/*
 * Purpose: Verify public landing camera card thumbnail priority and viewer stat display.
 * Caller: Frontend focused test gate for landing card UI.
 * Deps: vitest, testing-library/react, LandingCameraCard with UI mocks.
 * MainFuncs: LandingCameraCard behavior tests.
 * SideEffects: Renders component in jsdom only.
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingCameraCard from './LandingCameraCard.jsx';

const { thumbnailSpy, preloadPublicVideoPopup } = vi.hoisted(() => ({
    thumbnailSpy: vi.fn(() => <div data-testid="camera-thumbnail" />),
    preloadPublicVideoPopup: vi.fn(),
}));

vi.mock('../CameraThumbnail', () => ({
    default: (props) => thumbnailSpy(props),
}));

vi.mock('../CodecBadge', () => ({
    default: () => <div data-testid="codec-badge" />,
}));

vi.mock('../ui/Icons', () => ({
    Icons: {
        Check: () => <span>check</span>,
        Plus: () => <span>plus</span>,
        Play: () => <span>play</span>,
        MapPin: () => <span>pin</span>,
    },
}));

vi.mock('../../utils/animationControl', () => ({
    shouldDisableAnimations: () => true,
}));

vi.mock('../../utils/preloadPublicVideoPopup', () => ({
    preloadPublicVideoPopup,
}));

describe('LandingCameraCard', () => {
    it('prioritizes external snapshot URLs for public thumbnails', () => {
        thumbnailSpy.mockClear();

        render(
            <LandingCameraCard
                camera={{
                    id: 9,
                    name: 'Jombang',
                    is_online: 1,
                    status: 'active',
                    external_snapshot_url: 'https://example.com/snapshot.jpg',
                    thumbnail_path: '/api/thumbnails/9.jpg',
                }}
                onClick={vi.fn()}
                onAddMulti={vi.fn()}
                inMulti={false}
                isFavorite={() => false}
                onToggleFavorite={vi.fn()}
            />
        );

        expect(thumbnailSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                thumbnailPath: 'https://example.com/snapshot.jpg',
            })
        );
    });

    it('renders compact live and lifetime viewer stats', () => {
        const { getByText } = render(
            <LandingCameraCard
                camera={{
                    id: 10,
                    name: 'Viewer Stats Camera',
                    is_online: 1,
                    status: 'active',
                    viewer_stats: {
                        live_viewers: 3,
                        total_views: 12450,
                    },
                }}
                onClick={vi.fn()}
                onAddMulti={vi.fn()}
                inMulti={false}
                isFavorite={() => false}
                onToggleFavorite={vi.fn()}
            />
        );

        expect(getByText('3 live')).toBeTruthy();
        // Counts truncate, never round up: 12450 reads "12.4k" (not "12.5k"), so the
        // figure never overstates actual views. See formatCompactCount in CameraViewerStatsBadges.
        expect(getByText('12.4k views')).toBeTruthy();
    });

    it('prewarms the video popup chunk on first card intent', () => {
        preloadPublicVideoPopup.mockClear();
        const { getByText } = render(
            <LandingCameraCard
                camera={{
                    id: 11,
                    name: 'Prewarm Camera',
                    is_online: 1,
                    status: 'active',
                }}
                onClick={vi.fn()}
                onAddMulti={vi.fn()}
                inMulti={false}
                isFavorite={() => false}
                onToggleFavorite={vi.fn()}
            />
        );

        fireEvent.pointerEnter(getByText('Prewarm Camera').closest('.group\\/card'));
        fireEvent.focus(getByText('Prewarm Camera').closest('.group\\/card'));

        expect(preloadPublicVideoPopup).toHaveBeenCalledTimes(1);
    });

    it('keeps the favourite and multi-view actions usable by keyboard, outside the watch target', () => {
        const onClick = vi.fn();
        const onToggleFavorite = vi.fn();
        const { getByRole } = render(
            <LandingCameraCard
                camera={{ id: 12, name: 'Simpang Tiga', is_online: 1, status: 'active' }}
                onClick={onClick}
                onAddMulti={vi.fn()}
                inMulti={false}
                isFavorite={() => false}
                onToggleFavorite={onToggleFavorite}
            />
        );

        const watchTarget = getByRole('button', { name: 'Tonton Simpang Tiga' });
        const fav = getByRole('button', { name: 'Tambah Simpang Tiga ke favorit' });
        const multi = getByRole('button', { name: 'Tambah Simpang Tiga ke Multi-View' });

        // ARIA makes the descendants of a role="button" presentational, so nesting these
        // inside the thumbnail hid them from assistive tech entirely.
        expect(watchTarget.contains(fav)).toBe(false);
        expect(watchTarget.contains(multi)).toBe(false);
        expect(fav.tagName).toBe('BUTTON');
        expect(multi.tagName).toBe('BUTTON');

        // Enter/Space on an action must never fall through and start an HLS stream.
        fireEvent.keyDown(fav, { key: 'Enter' });
        fireEvent.keyDown(multi, { key: ' ' });
        expect(onClick).not.toHaveBeenCalled();

        fireEvent.click(fav);
        expect(onToggleFavorite).toHaveBeenCalledWith(12);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('sizes the overlay actions to the touch-target floor and spaces them apart', () => {
        const { getByRole } = render(
            <LandingCameraCard
                camera={{ id: 13, name: 'Pasar Baru', is_online: 1, status: 'active' }}
                onClick={vi.fn()}
                onAddMulti={vi.fn()}
                inMulti={false}
                isFavorite={() => false}
                onToggleFavorite={vi.fn()}
            />
        );

        for (const name of ['Tambah Pasar Baru ke favorit', 'Tambah Pasar Baru ke Multi-View']) {
            const cls = getByRole('button', { name }).className;
            // 44px phone / 40px sm+ — never back below the floor in docs/frontend-guide.md.
            expect(cls).toContain('h-11');
            expect(cls).toContain('w-11');
            expect(cls).toContain('sm:h-10');
            expect(cls).toContain('sm:w-10');
        }

        expect(getByRole('button', { name: 'Tambah Pasar Baru ke favorit' }).parentElement.className).toContain('gap-2.5');
    });
});
