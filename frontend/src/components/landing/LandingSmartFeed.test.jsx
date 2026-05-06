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
});
