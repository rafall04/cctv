// @vitest-environment jsdom

/*
Purpose: Verify runtime stability for one multi-view HLS tile.
Caller: Vitest frontend component suite.
Deps: React Testing Library, mocked HLS/viewer/stream utilities, MultiViewVideoItem.
MainFuncs: MultiViewVideoItem runtime tests.
SideEffects: Mounts component in jsdom and advances timers.
*/

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MultiViewVideoItem from './MultiViewVideoItem.jsx';

const {
    startSessionMock,
    stopSessionMock,
    startTimeoutMock,
    clearTimeoutMock,
    updateStageMock,
    resetFailuresMock,
    enqueueMock,
} = vi.hoisted(() => ({
    startSessionMock: vi.fn().mockResolvedValue('viewer-session'),
    stopSessionMock: vi.fn().mockResolvedValue(undefined),
    startTimeoutMock: vi.fn(),
    clearTimeoutMock: vi.fn(),
    updateStageMock: vi.fn(),
    resetFailuresMock: vi.fn(),
    enqueueMock: vi.fn((initFn) => initFn()),
}));

const hlsInstances = [];

vi.mock('hls.js', () => {
    class HlsMock {
        static isSupported() {
            return true;
        }

        static Events = {
            MANIFEST_PARSED: 'manifestParsed',
            FRAG_LOADED: 'fragLoaded',
            FRAG_BUFFERED: 'fragBuffered',
            ERROR: 'error',
        };

        static ErrorTypes = {
            NETWORK_ERROR: 'networkError',
            MEDIA_ERROR: 'mediaError',
        };

        constructor() {
            this.handlers = {};
            hlsInstances.push(this);
        }

        loadSource = vi.fn();
        attachMedia = vi.fn();
        startLoad = vi.fn();
        recoverMediaError = vi.fn();
        destroy = vi.fn();
        on(event, handler) {
            this.handlers[event] = handler;
        }
        emit(event, ...args) {
            this.handlers[event]?.(...args);
        }
    }

    return { default: HlsMock };
});

vi.mock('../../utils/deviceDetector', () => ({
    detectDeviceTier: () => 'high',
}));

vi.mock('../../utils/animationControl', () => ({
    shouldDisableAnimations: () => true,
}));

vi.mock('../../utils/fallbackHandler', () => ({
    createFallbackHandler: () => ({
        handleError: () => ({ action: 'manual-retry-required' }),
        destroy: vi.fn(),
        clearPendingRetry: vi.fn(),
        reset: vi.fn(),
    }),
}));

vi.mock('../../utils/hlsConfig', () => ({
    getHLSConfig: () => ({}),
}));

vi.mock('../../hooks/useStreamTimeout', () => ({
    useStreamTimeout: () => ({
        startTimeout: startTimeoutMock,
        clearTimeout: clearTimeoutMock,
        updateStage: updateStageMock,
        resetFailures: resetFailuresMock,
    }),
}));

vi.mock('../../utils/streamInitQueue', () => ({
    shouldUseQueuedInit: () => true,
    getGlobalStreamInitQueue: () => ({
        enqueue: enqueueMock,
    }),
}));

vi.mock('../../services/viewerService', () => ({
    viewerService: {
        startSession: startSessionMock,
        stopSession: stopSessionMock,
    },
}));

vi.mock('../../utils/snapshotHelper', () => ({
    takeSnapshot: vi.fn(),
}));

vi.mock('../../contexts/BrandingContext', () => ({
    useBranding: () => ({
        branding: {
            company_name: 'RAF NET',
            watermark_enabled: 'false',
        },
    }),
}));

vi.mock('./ZoomableVideo', () => ({
    default: ({ videoRef }) => <video ref={videoRef} data-testid="multi-view-video" />,
}));

const baseCamera = {
    id: 31,
    name: 'CCTV Simpang Multi',
    streams: { hls: 'https://example.com/live/index.m3u8' },
    stream_source: 'mediamtx',
    is_online: 1,
    status: 'active',
};

async function waitForInitialHls() {
    await waitFor(() => {
        expect(hlsInstances).toHaveLength(1);
    });

    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
    });
}

describe('MultiViewVideoItem runtime stability', () => {
    beforeEach(() => {
        hlsInstances.length = 0;
        enqueueMock.mockClear();
        startSessionMock.mockReset();
        startSessionMock.mockResolvedValue('viewer-session');
        stopSessionMock.mockClear();
        startTimeoutMock.mockClear();
        clearTimeoutMock.mockClear();
        updateStageMock.mockClear();
        resetFailuresMock.mockClear();
        vi.useRealTimers();
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders and initializes an HLS tile without crashing after page reload', async () => {
        render(
            <MultiViewVideoItem
                camera={baseCamera}
                onRemove={vi.fn()}
                onError={vi.fn()}
                onStatusChange={vi.fn()}
            />
        );

        expect(screen.getByTestId('multi-view-video')).toBeTruthy();
        await waitForInitialHls();

        expect(hlsInstances[0].loadSource).toHaveBeenCalledWith('https://example.com/live/index.m3u8');
        expect(hlsInstances[0].attachMedia).toHaveBeenCalledWith(screen.getByTestId('multi-view-video'));
    });

    it('treats internal manifest 404 as warmup and retries before showing tile error', async () => {
        const onError = vi.fn();

        render(
            <MultiViewVideoItem
                camera={baseCamera}
                onRemove={vi.fn()}
                onError={onError}
                onStatusChange={vi.fn()}
            />
        );

        await waitForInitialHls();

        await act(async () => {
            hlsInstances[0].emit('error', {}, {
                fatal: true,
                type: 'networkError',
                details: 'manifestLoadError',
                response: { code: 404 },
            });
        });

        expect(onError).not.toHaveBeenCalled();
        expect(screen.queryByText('Tidak Terkoneksi')).toBeNull();

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 1300));
        });

        await waitFor(() => {
            expect(hlsInstances.length).toBeGreaterThanOrEqual(2);
        });
    }, 10000);

    it('stops a viewer session that resolves after the tile unmounts during reload', async () => {
        let resolveSession;
        startSessionMock.mockReturnValue(new Promise((resolve) => {
            resolveSession = resolve;
        }));

        const { unmount } = render(
            <MultiViewVideoItem
                camera={baseCamera}
                onRemove={vi.fn()}
                onError={vi.fn()}
                onStatusChange={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(startSessionMock).toHaveBeenCalledWith(31);
        });

        unmount();

        await act(async () => {
            resolveSession('late-session');
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(stopSessionMock).toHaveBeenCalledWith('late-session');
        });
    });
});
