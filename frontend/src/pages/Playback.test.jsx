// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { TestRouter } from '../test/renderWithRouter';
import Playback from './Playback';

const { getSegments, getSegmentStreamUrl } = vi.hoisted(() => ({
    getSegments: vi.fn(),
    getSegmentStreamUrl: vi.fn(),
}));

vi.mock('../services/recordingService', () => ({
    default: {
        getSegments,
        getSegmentStreamUrl,
    },
}));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({
        branding: { company_name: 'Test CCTV' },
    }),
}));

vi.mock('../components/playback/PlaybackHeader', () => ({
    default: ({ cameras, onCameraChange, onShare }) => (
        <div>
            <div>playback-header</div>
            {cameras[1] && (
                <button onClick={() => onCameraChange(cameras[1])} type="button">
                    ganti-kamera
                </button>
            )}
            {onShare && (
                <button onClick={onShare} type="button">
                    bagikan-header
                </button>
            )}
        </div>
    ),
}));

vi.mock('../components/playback/PlaybackVideo', () => ({
    default: ({ selectedSegment, videoRef, isBuffering, autoPlayNotification }) => (
        <div>
            <div data-testid="video-segment">{selectedSegment?.id ?? 'none'}</div>
            <div data-testid="buffering-state">{String(isBuffering)}</div>
            <div data-testid="autoplay-note">{autoPlayNotification?.message ?? ''}</div>
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

function createDeferred() {
    let resolve;
    const promise = new Promise((resolver) => {
        resolve = resolver;
    });

    return { promise, resolve };
}

function buildSegments(prefix) {
    return [
        {
            id: `${prefix}-1`,
            filename: `${prefix}-1.mp4`,
            start_time: '2026-03-05T10:00:00.000Z',
            end_time: '2026-03-05T10:10:00.000Z',
            duration: 600,
        },
        {
            id: `${prefix}-2`,
            filename: `${prefix}-2.mp4`,
            start_time: '2026-03-05T10:20:00.000Z',
            end_time: '2026-03-05T10:30:00.000Z',
            duration: 600,
        },
    ];
}

describe('Playback', () => {
    beforeEach(() => {
        getSegments.mockReset();
        getSegmentStreamUrl.mockReset();
        localStorage.clear();
        getSegments.mockResolvedValue({
            success: true,
            data: {
                segments: buildSegments('seg'),
            },
        });
        getSegmentStreamUrl.mockImplementation((cameraId, filename) => `/stream/${cameraId}/${filename}`);

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

        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
        Object.defineProperty(window.navigator, 'share', {
            configurable: true,
            value: vi.fn().mockResolvedValue(undefined),
        });
        Object.defineProperty(window.navigator, 'canShare', {
            configurable: true,
            value: vi.fn(() => false),
        });
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

        await waitFor(() => {
            expect(video.getAttribute('src')).toBe('/stream/1/seg-2.mp4');
        });

        await act(async () => {
            await Promise.resolve();
        });

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

        act(() => {
            fireEvent.playing(video);
        });

        expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(initialLoadCalls);
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

    it('share playback mempertahankan simple mode pada link publik', async () => {
        render(
            <TestRouter initialEntries={['/playback?mode=simple&view=playback&cam=1']}>
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
        video.currentTime = 15;

        fireEvent.click(screen.getByText('Bagikan Link Playback'));

        await waitFor(() => {
            expect(window.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
        });

        const sharedUrl = window.navigator.clipboard.writeText.mock.calls[0][0];
        expect(sharedUrl).toContain('/?mode=simple&view=playback');
        expect(sharedUrl).toContain('cam=1-lobby');
        expect(sharedUrl).toContain('t=');
    });

    it('share playback mempertahankan full mode pada link publik', async () => {
        render(
            <TestRouter initialEntries={['/playback?mode=full&view=playback&cam=1']}>
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

        fireEvent.click(screen.getByText('Bagikan Link Playback'));

        await waitFor(() => {
            expect(window.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
        });

        const sharedUrl = window.navigator.clipboard.writeText.mock.calls[0][0];
        expect(sharedUrl).toContain('/?mode=full&view=playback');
        expect(sharedUrl).toContain('cam=1-lobby');
    });

    it('ganti kamera tidak pernah membangun source dengan kamera baru dan filename lama', async () => {
        const cameraTwoDeferred = createDeferred();

        getSegments
            .mockResolvedValueOnce({
                success: true,
                data: {
                    segments: buildSegments('seg'),
                },
            })
            .mockImplementationOnce(() => cameraTwoDeferred.promise);

        render(
            <TestRouter initialEntries={['/playback?mode=full&view=playback&cam=1']}>
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

        getSegmentStreamUrl.mockClear();

        fireEvent.click(screen.getByText('ganti-kamera'));

        expect(getSegmentStreamUrl).not.toHaveBeenCalled();

        await act(async () => {
            cameraTwoDeferred.resolve({
                success: true,
                data: {
                    segments: buildSegments('gate'),
                },
            });
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(screen.getByTestId('video-segment').textContent).toBe('gate-2');
        });

        expect(getSegmentStreamUrl).toHaveBeenCalledWith(2, 'gate-2.mp4');
        expect(getSegmentStreamUrl.mock.calls).not.toContainEqual([2, 'seg-2.mp4']);
    });

    it('mengabaikan respons segmen lama yang datang terlambat setelah user pindah kamera', async () => {
        const firstCameraDeferred = createDeferred();

        getSegments
            .mockImplementationOnce(() => firstCameraDeferred.promise)
            .mockResolvedValueOnce({
                success: true,
                data: {
                    segments: buildSegments('gate'),
                },
            });

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

        fireEvent.click(screen.getByText('ganti-kamera'));

        await waitFor(() => {
            expect(screen.getByTestId('video-segment').textContent).toBe('gate-2');
        });

        await act(async () => {
            firstCameraDeferred.resolve({
                success: true,
                data: {
                    segments: buildSegments('seg'),
                },
            });
            await Promise.resolve();
        });

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByTestId('video-segment').textContent).toBe('gate-2');
        expect(screen.getByTestId('location-search').textContent).toContain('cam=2-gate');
    });

    it('autoplay tetap berjalan saat metadata baru tersedia setelah jeda lebih dari 500ms', async () => {
        render(
            <TestRouter initialEntries={['/playback?mode=full&view=playback&cam=1']}>
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
        HTMLMediaElement.prototype.play.mockClear();

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 700));
        });

        expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

        act(() => {
            fireEvent.loadedMetadata(video);
        });

        await waitFor(() => {
            expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
        });
    });

    it('autoplay rejection menghentikan buffering dan menampilkan pesan manual play', async () => {
        HTMLMediaElement.prototype.play = vi.fn().mockRejectedValue(new Error('Autoplay blocked'));

        render(
            <TestRouter initialEntries={['/playback?mode=full&view=playback&cam=1']}>
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
        act(() => {
            fireEvent.loadedMetadata(video);
        });

        await waitFor(() => {
            expect(screen.getByTestId('buffering-state').textContent).toBe('false');
        });

        expect(screen.getByTestId('autoplay-note').textContent).toContain('Auto-play gagal');
    });

});
