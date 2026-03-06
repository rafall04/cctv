// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestRouter } from '../test/renderWithRouter';
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
    default: ({ selectedSegment, videoRef, isBuffering }) => (
        <div>
            <div data-testid="video-segment">{selectedSegment?.id ?? 'none'}</div>
            <div data-testid="buffering-state">{String(isBuffering)}</div>
            <video data-testid="playback-video" ref={videoRef} />
        </div>
    ),
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

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            headers: {
                get: (header) => {
                    if (header === 'content-type') {
                        return 'video/mp4';
                    }
                    if (header === 'content-length') {
                        return `${2 * 1024 * 1024}`;
                    }
                    return null;
                },
            },
        }));

        Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
            configurable: true,
            get() {
                return this._paused ?? true;
            },
            set(value) {
                this._paused = value;
            },
        });

        Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
            configurable: true,
            get() {
                return this._readyState ?? 4;
            },
            set(value) {
                this._readyState = value;
            },
        });

        Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
            configurable: true,
            get() {
                return this._duration ?? 600;
            },
            set(value) {
                this._duration = value;
            },
        });

        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
            configurable: true,
            get() {
                return this._currentTime ?? 0;
            },
            set(value) {
                this._currentTime = value;
            },
        });

        HTMLMediaElement.prototype.play = vi.fn().mockImplementation(function () {
            this.paused = false;
            return Promise.resolve();
        });
        HTMLMediaElement.prototype.pause = vi.fn().mockImplementation(function () {
            this.paused = true;
        });
        HTMLMediaElement.prototype.load = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('fallback ke segmen terdekat saat timestamp share tidak persis masuk rentang', async () => {
        const closestSegmentTimestamp = Date.parse('2026-03-05T10:18:00.000Z').toString();

        render(
            <TestRouter initialEntries={[`/playback?cam=1&t=${closestSegmentTimestamp}`]}>
                <Playback
                    cameras={[
                        { id: 1, name: 'Lobby', enable_recording: 1 },
                    ]}
                />
            </TestRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('video-segment').textContent).toBe('seg-2');
        });

        expect(screen.getByTestId('list-segment').textContent).toBe('seg-2');
    });

    it('stall awal tidak langsung me-reload video dan timeout dibersihkan saat playback pulih', async () => {
        render(
            <TestRouter initialEntries={['/playback?cam=1']}>
                <Playback
                    cameras={[
                        { id: 1, name: 'Lobby', enable_recording: 1 },
                    ]}
                />
            </TestRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('video-segment').textContent).toBe('seg-2');
        });

        const video = screen.getByTestId('playback-video');
        const initialLoadCalls = HTMLMediaElement.prototype.load.mock.calls.length;

        video.readyState = 2;
        fireEvent.stalled(video);

        await new Promise((resolve) => setTimeout(resolve, 2000));
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(initialLoadCalls);

        video.readyState = 4;
        fireEvent.playing(video);

        await new Promise((resolve) => setTimeout(resolve, 7000));
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(initialLoadCalls);
        expect(screen.getByTestId('buffering-state').textContent).toBe('false');
    }, 15000);
});
