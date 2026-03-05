// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Playback from './Playback';

const { getSegments } = vi.hoisted(() => ({
    getSegments: vi.fn(),
}));

vi.mock('../services/recordingService', () => ({
    default: {
        getSegments,
        getSegmentStreamUrl: vi.fn(() => '/segment.mp4'),
    },
}));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({
        branding: { company_name: 'Test CCTV' },
    }),
}));

vi.mock('../components/playback/PlaybackHeader', () => ({
    default: () => <div>playback-header</div>,
}));

vi.mock('../components/playback/PlaybackVideo', () => ({
    default: ({ selectedSegment }) => <div data-testid="video-segment">{selectedSegment?.id ?? 'none'}</div>,
}));

vi.mock('../components/playback/PlaybackTimeline', () => ({
    default: () => <div>timeline</div>,
}));

vi.mock('../components/playback/PlaybackSegmentList', () => ({
    default: ({ selectedSegment }) => <div data-testid="list-segment">{selectedSegment?.id ?? 'none'}</div>,
}));

describe('Playback', () => {
    beforeEach(() => {
        getSegments.mockReset();
        getSegments.mockResolvedValue({
            success: true,
            data: {
                segments: [
                    {
                        id: 'seg-1',
                        filename: 'seg-1.mp4',
                        start_time: '2026-03-05T10:00:00.000Z',
                        end_time: '2026-03-05T10:10:00.000Z',
                        duration: 600,
                    },
                    {
                        id: 'seg-2',
                        filename: 'seg-2.mp4',
                        start_time: '2026-03-05T10:20:00.000Z',
                        end_time: '2026-03-05T10:30:00.000Z',
                        duration: 600,
                    },
                ],
            },
        });
    });

    it('fallback ke segmen terdekat saat timestamp share tidak persis masuk rentang', async () => {
        const closestSegmentTimestamp = Date.parse('2026-03-05T10:18:00.000Z').toString();

        render(
            <MemoryRouter initialEntries={[`/playback?cam=1&t=${closestSegmentTimestamp}`]}>
                <Playback
                    cameras={[
                        { id: 1, name: 'Lobby', enable_recording: 1 },
                    ]}
                />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('video-segment').textContent).toBe('seg-2');
        });

        expect(screen.getByTestId('list-segment').textContent).toBe('seg-2');
    });
});
