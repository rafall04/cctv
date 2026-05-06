// @vitest-environment jsdom

/*
 * Purpose: Verify public landing result grid progressive rendering and thumbnail priority behavior.
 * Caller: Frontend focused landing optimization test gate.
 * Deps: React Testing Library, Vitest, LandingResultsGrid with mocked camera card.
 * MainFuncs: LandingResultsGrid optimization tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingResultsGrid from './LandingResultsGrid';

vi.mock('./LandingCameraCard', () => ({
    default: ({ camera, thumbnailPriority }) => (
        <div data-testid="camera-card" data-priority={thumbnailPriority ? 'true' : 'false'}>
            {camera.name}
        </div>
    ),
}));

function makeCameras(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        name: `Camera ${index + 1}`,
    }));
}

describe('LandingResultsGrid optimization', () => {
    it('renders public camera cards progressively instead of mounting every card at once', () => {
        render(
            <LandingResultsGrid
                cameras={makeCameras(30)}
                initialVisibleCount={12}
                loadMoreCount={8}
                onCameraClick={vi.fn()}
                onAddMulti={vi.fn()}
                multiCameras={[]}
            />
        );

        expect(screen.getAllByTestId('camera-card')).toHaveLength(12);
        expect(screen.queryByText('Camera 13')).toBeNull();
        expect(screen.getByText(/Menampilkan 12 dari 30/i)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Tampilkan 8 kamera lagi/i }));

        expect(screen.getAllByTestId('camera-card')).toHaveLength(20);
        expect(screen.getByText('Camera 20')).toBeTruthy();
    });

    it('marks only the first visible thumbnails as priority for faster first paint', () => {
        render(
            <LandingResultsGrid
                cameras={makeCameras(8)}
                initialVisibleCount={8}
                priorityThumbnailCount={3}
                onCameraClick={vi.fn()}
                onAddMulti={vi.fn()}
                multiCameras={[]}
            />
        );

        const cards = screen.getAllByTestId('camera-card');
        expect(cards.slice(0, 3).every((card) => card.dataset.priority === 'true')).toBe(true);
        expect(cards.slice(3).every((card) => card.dataset.priority === 'false')).toBe(true);
    });
});
