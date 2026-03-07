// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
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
    default: ({ cameras, onCameraChange }) => (
        <div>
            <div>playback-header</div>
            {cameras[1] && (
                <button onClick={() => onCameraChange(cameras[1])} type="button">
                    ganti-kamera
                </button>
            )}
        </div>
    ),
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
    default: ({ selectedSegment, segments, onSegmentClick }) => (
        <div>
            <div data-testid="list-segment">{selectedSegment?.id ?? 'none'}</div>
            {segments[0] && (
                <button onClick={() => onSegmentClick(segments[0])} type="button">
                    pilih-segmen-pertama
                </button>
            )}
        </div>
    ),
}));

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location-search">{location.search}</div>;
}

describe('Playback', () => {
    beforeEach(() => {
        getSegments.mockReset();
        localStorage.clear();
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
            <TestRouter initialEntries={[`/playback?mode=full&view=playback&cam=1&t=${closestSegmentTimestamp}`]}>
                <LocationProbe />
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
            <TestRouter initialEntries={['/playback?mode=full&view=playback&cam=1']}>
                <LocationProbe />
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

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        const video = screen.getByTestId('playback-video');
        const initialLoadCalls = HTMLMediaElement.prototype.load.mock.calls.length;

        video.readyState = 2;
        act(() => {
            fireEvent.stalled(video);
        });

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
        });
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(initialLoadCalls);

        video.readyState = 4;
        act(() => {
            fireEvent.playing(video);
        });

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 7000));
        });
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(initialLoadCalls);
        expect(screen.getByTestId('buffering-state').textContent).toBe('false');
    }, 15000);

    it('refresh prop cameras dengan id kamera aktif yang sama tidak me-reset playback', async () => {
        const initialCameras = [
            { id: 1, name: 'Lobby', enable_recording: 1, location: 'Area A' },
        ];

        const { rerender } = render(
            <TestRouter initialEntries={['/playback?mode=simple&view=playback&cam=1']}>
                <LocationProbe />
                <Playback cameras={initialCameras} />
            </TestRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('video-segment').textContent).toBe('seg-2');
        });

        const initialGetSegmentsCalls = getSegments.mock.calls.length;
        const initialLoadCalls = HTMLMediaElement.prototype.load.mock.calls.length;

        rerender(
            <TestRouter initialEntries={['/playback?mode=simple&view=playback&cam=1']}>
                <LocationProbe />
                <Playback
                    cameras={[
                        { id: 1, name: 'Lobby Refresh', enable_recording: 1, location: 'Area B' },
                    ]}
                />
            </TestRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('video-segment').textContent).toBe('seg-2');
        });

        expect(screen.getByTestId('list-segment').textContent).toBe('seg-2');
        expect(getSegments).toHaveBeenCalledTimes(initialGetSegmentsCalls);
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(initialLoadCalls);
        expect(screen.getByTestId('location-search').textContent).toContain('view=playback');
        expect(screen.getByTestId('location-search').textContent).toContain('mode=simple');
    });

    it('tetap di playback saat ganti kamera dan pilih segmen', async () => {
        render(
            <TestRouter initialEntries={['/playback?mode=full&view=playback&cam=1']}>
                <LocationProbe />
                <Playback
                    cameras={[
                        { id: 1, name: 'Lobby', enable_recording: 1, location: 'Area A' },
                        { id: 2, name: 'Gate', enable_recording: 1, location: 'Area B' },
                    ]}
                />
            </TestRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('video-segment').textContent).toBe('seg-2');
        });

        fireEvent.click(screen.getByText('ganti-kamera'));

        await waitFor(() => {
            expect(screen.getByTestId('location-search').textContent).toContain('view=playback');
        });

        expect(screen.getByTestId('location-search').textContent).toContain('mode=full');
        expect(screen.getByTestId('location-search').textContent).toContain('cam=2-gate');

        fireEvent.click(screen.getByText('pilih-segmen-pertama'));

        await waitFor(() => {
            expect(screen.getByTestId('location-search').textContent).toContain('view=playback');
        });

        expect(screen.getByTestId('location-search').textContent).toContain('mode=full');
        expect(screen.getByTestId('location-search').textContent).toContain('t=');
    });

});
