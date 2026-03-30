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

const flvPlayers = [];

vi.mock('flv.js', () => {
    const Events = {
        ERROR: 'error',
    };

    return {
        default: {
            Events,
            isSupported: () => true,
            createPlayer: vi.fn(() => {
                const handlers = {};
                const player = {
                    attachMediaElement: vi.fn(),
                    load: vi.fn(),
                    destroy: vi.fn(),
                    on: vi.fn((event, handler) => {
                        handlers[event] = handler;
                    }),
                    emit: (event, ...args) => handlers[event]?.(...args),
                };
                flvPlayers.push(player);
                return player;
            }),
        },
    };
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
        flvPlayers.length = 0;
        startSessionMock.mockClear();
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

    it('memperlakukan 404 manifest internal sebagai warmup sementara sebelum retry ulang', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 19 }}
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
                details: 'manifestLoadError',
                response: { code: 404 },
            });
        });

        expect(screen.queryByText('Koneksi Gagal')).toBeNull();

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 1300));
        });

        await waitFor(() => {
            expect(hlsInstances.length).toBeGreaterThanOrEqual(2);
        });
    }, 10000);

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

    it('tetap memprioritaskan slot popup bawah pada desktop meski preferensi diset ke top', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 20 }}
                onClose={vi.fn()}
                adsConfig={{
                    enabled: true,
                    devices: { desktop: true, mobile: true },
                    popup: {
                        enabled: true,
                        preferredSlot: 'top',
                        maxHeight: {
                            desktop: 160,
                            mobile: 220,
                        },
                    },
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
            expect(screen.getByText('popup bottom ad')).toBeTruthy();
        });

        expect(screen.queryByText('popup top ad')).toBeNull();
    });

    it('menempatkan sponsor bawah setelah panel kontrol popup', async () => {
        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 22 }}
                onClose={vi.fn()}
                adsConfig={{
                    enabled: true,
                    devices: { desktop: true, mobile: true },
                    popup: {
                        enabled: true,
                        preferredSlot: 'bottom',
                        maxHeight: {
                            desktop: 160,
                            mobile: 220,
                        },
                    },
                    slots: {
                        popupBottomNative: {
                            enabled: true,
                            script: '<div>popup bottom order ad</div>',
                        },
                    },
                }}
            />
        );

        const footer = screen.getByTitle('Tutup').closest('.shrink-0');

        await waitFor(() => {
            expect(screen.getByText('popup bottom order ad')).toBeTruthy();
        });

        const adSlot = screen.getByTestId('ad-slot-popup-bottom-native');
        expect(footer).toBeTruthy();
        expect(
            footer.compareDocumentPosition(adSlot) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it('mengizinkan kedua slot popup tampil pada viewport mobile', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });

        render(
            <VideoPopup
                camera={{ ...baseCamera, id: 21 }}
                onClose={vi.fn()}
                adsConfig={{
                    enabled: true,
                    devices: { desktop: true, mobile: true },
                    popup: {
                        enabled: true,
                        preferredSlot: 'bottom',
                        maxHeight: {
                            desktop: 160,
                            mobile: 220,
                        },
                    },
                    slots: {
                        popupTopBanner: {
                            enabled: true,
                            script: '<div>popup top ad mobile</div>',
                        },
                        popupBottomNative: {
                            enabled: true,
                            script: '<div>popup bottom ad mobile</div>',
                        },
                    },
                }}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('popup top ad mobile')).toBeTruthy();
        });

        expect(screen.getByText('popup bottom ad mobile')).toBeTruthy();
    });

    it('merender body MJPEG eksternal tanpa memulai HLS internal', async () => {
        render(
            <VideoPopup
                camera={{
                    ...baseCamera,
                    id: 23,
                    delivery_type: 'external_mjpeg',
                    stream_source: 'external',
                    streams: {},
                    external_stream_url: 'https://example.com/zm/cgi-bin/nph-zms',
                }}
                onClose={vi.fn()}
            />
        );

        expect(screen.getByTestId('external-mjpeg-body')).toBeTruthy();
        expect(screen.queryByTestId('grid-popup-video')).toBeNull();
        expect(hlsInstances).toHaveLength(0);

        await waitFor(() => {
            expect(startSessionMock).toHaveBeenCalledWith(23);
        });
    });

    it('merender fallback sumber resmi untuk custom websocket tanpa mencoba HLS', async () => {
        render(
            <VideoPopup
                camera={{
                    ...baseCamera,
                    id: 24,
                    delivery_type: 'external_custom_ws',
                    stream_source: 'external',
                    streams: {},
                    external_stream_url: 'wss://example.com/custom-stream',
                }}
                onClose={vi.fn()}
            />
        );

        expect(screen.getByTestId('external-source-fallback')).toBeTruthy();
        expect(screen.getByText('wss://example.com/custom-stream')).toBeTruthy();
        expect(hlsInstances).toHaveLength(0);

        await waitFor(() => {
            expect(startSessionMock).toHaveBeenCalledWith(24);
        });
    });

    it('memutar external FLV secara native tanpa menginisialisasi HLS', async () => {
        render(
            <VideoPopup
                camera={{
                    ...baseCamera,
                    id: 25,
                    delivery_type: 'external_flv',
                    stream_source: 'external',
                    streams: {},
                    external_stream_url: 'https://surakarta.atcsindonesia.info:8086/camera/BalaiKota.flv',
                    external_embed_url: 'https://example.com/fallback-player',
                }}
                onClose={vi.fn()}
            />
        );

        expect(screen.getByTestId('grid-popup-video')).toBeTruthy();
        expect(hlsInstances).toHaveLength(0);

        await waitFor(() => {
            expect(flvPlayers).toHaveLength(1);
        });

        expect(flvPlayers[0].attachMediaElement).toHaveBeenCalled();
        expect(flvPlayers[0].load).toHaveBeenCalled();
    });
});



