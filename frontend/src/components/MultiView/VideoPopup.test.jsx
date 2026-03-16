// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoPopup from './VideoPopup.jsx';

const {
    startSessionMock,
    stopSessionMock,
    startTimeoutMock,
    clearTimeoutMock,
    updateStageMock,
    resetFailuresMock,
} = vi.hoisted(() => ({
    startSessionMock: vi.fn().mockResolvedValue('viewer-session'),
    stopSessionMock: vi.fn().mockResolvedValue(undefined),
    startTimeoutMock: vi.fn(),
    clearTimeoutMock: vi.fn(),
    updateStageMock: vi.fn(),
    resetFailuresMock: vi.fn(),
}));

const hlsInstances = [];

vi.mock('react-router-dom', () => ({
    useSearchParams: () => [new URLSearchParams('mode=simple&view=grid')],
}));

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
    detectDeviceTier: () => 'mid',
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
        getConsecutiveFailures: () => 1,
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

vi.mock('../CodecBadge.jsx', () => ({
    default: () => <div data-testid="codec-badge" />,
}));

vi.mock('./ZoomableVideo', () => ({
    default: ({ videoRef }) => <video ref={videoRef} data-testid="grid-popup-video" />,
}));

vi.mock('../../utils/publicShareUrl', () => ({
    buildPublicCameraShareUrl: () => 'https://example.com/share',
}));

const baseCamera = {
    id: 12,
    name: 'Perempatan Jembatan Sosrodilogo',
    location: 'SIMPANG 4 RAJEKWESI - SOSRODILOGO',
    area_name: 'KEC BOJONEGORO DAN SEKITARNYA',
    description: 'MILIK PEMERINTAH',
    streams: { hls: 'https://example.com/live.m3u8' },
    stream_source: 'mediamtx',
    is_tunnel: 0,
    is_online: 1,
    status: 'active',
};

describe('VideoPopup non-live states', () => {
    beforeEach(() => {
        hlsInstances.length = 0;
        startSessionMock.mockClear();
        stopSessionMock.mockClear();
        startTimeoutMock.mockClear();
        clearTimeoutMock.mockClear();
        updateStageMock.mockClear();
        resetFailuresMock.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('merender body maintenance penuh tanpa playback controls grid', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, status: 'maintenance' }}
                onClose={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Dalam Perbaikan')).toBeTruthy();
        });

        expect(screen.getByText('PERBAIKAN')).toBeTruthy();
        expect(screen.getByTestId('grid-video-body')).toBeTruthy();
        expect(screen.queryByTitle('Zoom In')).toBeNull();
        expect(screen.queryByTitle('Fullscreen')).toBeNull();
        expect(screen.getByTitle('Tutup')).toBeTruthy();
        expect(startSessionMock).not.toHaveBeenCalled();
    });

    it('merender body offline penuh tanpa playback controls grid', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 13, is_online: 0 }}
                onClose={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Kamera Offline')).toBeTruthy();
        });

        expect(screen.getByText('OFFLINE')).toBeTruthy();
        expect(screen.getByTestId('grid-video-body')).toBeTruthy();
        expect(screen.queryByTitle('Zoom In')).toBeNull();
        expect(screen.queryByTitle('Fullscreen')).toBeNull();
        expect(screen.getByTitle('Tutup')).toBeTruthy();
        expect(startSessionMock).not.toHaveBeenCalled();
    });

    it('menampilkan status cors dan menyembunyikan control playback saat stream eksternal diblokir', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 14, stream_source: 'external' }}
                onClose={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(hlsInstances).toHaveLength(1);
        });

        hlsInstances[0]._networkErrorRecoveryCount = 5;

        await act(async () => {
            hlsInstances[0].emit('error', {}, {
                fatal: true,
                type: 'networkError',
                details: 'manifestLoadError',
            });
        });

        await waitFor(() => {
            expect(screen.getByText('Stream Eksternal Diblokir')).toBeTruthy();
        });

        expect(screen.getByText('ERROR')).toBeTruthy();
        expect(screen.queryByTitle('Zoom In')).toBeNull();
        expect(screen.queryByTitle('Fullscreen')).toBeNull();
        expect(screen.queryByRole('button', { name: /coba lagi/i })).toBeNull();
    });

    it('tetap menyediakan retry untuk network error recoverable', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 15 }}
                onClose={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(hlsInstances).toHaveLength(1);
        });

        await act(async () => {
            hlsInstances[0].emit('error', {}, {
                fatal: true,
                type: 'networkError',
                details: 'levelLoadError',
            });
        });

        await waitFor(() => {
            expect(screen.getByText('Koneksi Gagal')).toBeTruthy();
        });

        expect(screen.getByTitle('Coba Lagi')).toBeTruthy();
        expect(screen.queryByTitle('Zoom In')).toBeNull();
        expect(screen.queryByTitle('Fullscreen')).toBeNull();
    });

    it('menyesuaikan rasio body live grid dari metadata video 4:3', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 16 }}
                onClose={vi.fn()}
            />
        );

        const video = await screen.findByTestId('grid-popup-video');
        const body = screen.getByTestId('grid-video-body');

        expect(body.style.aspectRatio).toBe(String(16 / 9));

        Object.defineProperty(video, 'videoWidth', {
            configurable: true,
            value: 640,
        });
        Object.defineProperty(video, 'videoHeight', {
            configurable: true,
            value: 480,
        });

        await act(async () => {
            video.dispatchEvent(new Event('loadedmetadata'));
        });

        await waitFor(() => {
            expect(body.style.aspectRatio).toBe(String(4 / 3));
        });
    });
    it('menormalkan rasio body live grid yang padded dekat 16:9', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 17 }}
                onClose={vi.fn()}
            />
        );

        const video = await screen.findByTestId('grid-popup-video');
        const body = screen.getByTestId('grid-video-body');

        Object.defineProperty(video, 'videoWidth', {
            configurable: true,
            value: 1920,
        });
        Object.defineProperty(video, 'videoHeight', {
            configurable: true,
            value: 1088,
        });

        await act(async () => {
            video.dispatchEvent(new Event('loadedmetadata'));
        });

        await waitFor(() => {
            expect(body.style.aspectRatio).toBe(String(16 / 9));
        });
    });

    it('membatasi lebar modal live grid desktop berdasarkan tinggi viewport yang tersedia', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });

        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 18 }}
                onClose={vi.fn()}
            />
        );

        const modal = screen.getByTestId('grid-popup-modal');

        await waitFor(() => {
            expect(modal.style.width).toBe('1024px');
        });
    });

    it('merender slot iklan popup atas dan bawah saat ads config aktif', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 20 }}
                onClose={vi.fn()}
                adsConfig={{
                    enabled: true,
                    devices: { desktop: true, mobile: true },
                    slots: {
                        popupTopBanner: {
                            enabled: true,
                            script: '<div>popup top ad</div>',
                        },
                        popupBottomNative: {
                            enabled: true,
                            script: '<div>popup bottom ad</div>',
                        },
                    },
                }}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('popup top ad')).toBeTruthy();
        });

        expect(screen.getByText('popup bottom ad')).toBeTruthy();
    });
});



