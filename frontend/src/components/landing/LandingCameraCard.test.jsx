/*
 * Purpose: Verify public landing camera card thumbnail priority and viewer stat display.
 * Caller: Frontend focused test gate for landing card UI.
 * Deps: vitest, testing-library/react, LandingCameraCard with UI mocks.
 * MainFuncs: LandingCameraCard behavior tests.
 * SideEffects: Renders component in jsdom only.
 */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingCameraCard from './LandingCameraCard.jsx';

const thumbnailSpy = vi.fn(() => <div data-testid="camera-thumbnail" />);

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
        expect(getByText('12.5k views')).toBeTruthy();
    });
});
