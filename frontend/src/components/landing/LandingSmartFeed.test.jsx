/*
 * Purpose: Verify compact smart public feed renders insight sections and opens cameras through the caller path.
 * Caller: Frontend focused public landing smart feed test gate.
 * Deps: React Testing Library, Vitest, LandingSmartFeed.
 * MainFuncs: Smart feed rendering tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingSmartFeed from './LandingSmartFeed';
import { buildPublicSmartFeedSections } from '../../utils/landingCameraInsights';

vi.mock('../../utils/landingCameraInsights', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        buildPublicSmartFeedSections: vi.fn(actual.buildPublicSmartFeedSections),
    };
});

describe('LandingSmartFeed', () => {
    it('renders smart camera sections and opens selected camera', () => {
        const onCameraClick = vi.fn();

        render(
            <LandingSmartFeed
                cameras={[
                    { id: 1, name: 'CCTV Ramai', area_name: 'Dander', is_online: 1, live_viewers: 9, total_views: 40, created_at: '2026-05-01 08:00:00' },
                    { id: 2, name: 'CCTV Baru', area_name: 'Baureno', is_online: 1, live_viewers: 0, total_views: 3, created_at: '2026-05-06 08:00:00' },
                ]}
                now={new Date('2026-05-06T12:00:00+07:00')}
                onCameraClick={onCameraClick}
            />
        );

        expect(screen.getByTestId('landing-smart-feed')).toBeTruthy();
        expect(screen.getByText('Sedang Ramai')).toBeTruthy();
        expect(screen.getByText('Kamera Terbaru')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /CCTV Ramai/i }));

        expect(onCameraClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });

    it('does not render without cameras', () => {
        const { container } = render(<LandingSmartFeed cameras={[]} />);
        expect(container.textContent).toBe('');
    });

    it('uses a tighter simple mode with only three compact sections and three cameras each', () => {
        render(
            <LandingSmartFeed
                variant="simple"
                cameras={[
                    { id: 1, name: 'Busy 1', area_name: 'A', is_online: 1, live_viewers: 9, total_views: 90 },
                    { id: 2, name: 'Busy 2', area_name: 'A', is_online: 1, live_viewers: 8, total_views: 80 },
                    { id: 3, name: 'Busy 3', area_name: 'A', is_online: 1, live_viewers: 7, total_views: 70 },
                    { id: 4, name: 'Busy 4', area_name: 'A', is_online: 1, live_viewers: 6, total_views: 60 },
                    { id: 5, name: 'Top 1', area_name: 'B', is_online: 1, live_viewers: 0, total_views: 50 },
                ]}
            />
        );

        expect(screen.getByTestId('landing-smart-feed').dataset.variant).toBe('simple');
        expect(screen.getByText('Sedang Ramai')).toBeTruthy();
        expect(screen.getByText('Paling Banyak Ditonton')).toBeTruthy();
        expect(screen.getByText('Rekomendasi Hari Ini')).toBeTruthy();
        expect(screen.queryByText('Kamera Terbaru')).toBeNull();
        const firstSection = screen.getByText('Sedang Ramai').closest('.min-w-0');
        expect(firstSection.textContent).not.toContain('Busy 4');
    });

    it('does not recompute smart sections when camera inputs are unchanged', () => {
        buildPublicSmartFeedSections.mockClear();
        const cameras = [
            { id: 1, name: 'Stable 1', area_name: 'A', is_online: 1, live_viewers: 3, total_views: 30 },
            { id: 2, name: 'Stable 2', area_name: 'B', is_online: 1, live_viewers: 0, total_views: 20 },
        ];
        const now = new Date('2026-05-06T12:00:00+07:00');
        const { rerender } = render(
            <LandingSmartFeed
                cameras={cameras}
                now={now}
                onCameraClick={vi.fn()}
            />
        );

        expect(buildPublicSmartFeedSections).toHaveBeenCalledTimes(1);

        rerender(
            <LandingSmartFeed
                cameras={cameras}
                now={now}
                onCameraClick={vi.fn()}
            />
        );

        expect(buildPublicSmartFeedSections).toHaveBeenCalledTimes(1);
    });
});
