import { describe, expect, it } from 'vitest';
import {
    buildDashboardStreams,
    getCameraOperationalState,
    getCameraStatusBreakdown,
} from '../services/adminDashboardService.js';

describe('adminDashboardService camera status helpers', () => {
    it('menghitung kamera external online dari is_online tanpa path MediaMTX', () => {
        const cameras = [
            {
                id: 1,
                enabled: 1,
                status: 'active',
                is_online: 1,
                stream_source: 'external',
                external_hls_url: 'https://example.com/live/index.m3u8',
            },
            {
                id: 2,
                enabled: 1,
                status: 'active',
                is_online: 0,
                stream_source: 'internal',
                external_hls_url: null,
            },
        ];

        expect(getCameraStatusBreakdown(cameras)).toEqual({
            online: 1,
            offline: 1,
            maintenance: 0,
        });
    });

    it('memprioritaskan maintenance di atas is_online', () => {
        expect(getCameraOperationalState({
            enabled: 1,
            status: 'maintenance',
            is_online: 1,
        })).toBe('maintenance');
    });

    it('membangun stream dashboard untuk kamera internal dan external', () => {
        const streams = buildDashboardStreams({
            cameras: [
                {
                    id: 1,
                    name: 'Internal Cam',
                    stream_key: 'internal-cam',
                    enabled: 1,
                    status: 'active',
                    is_online: 1,
                    stream_source: 'internal',
                    external_hls_url: null,
                },
                {
                    id: 2,
                    name: 'External Cam',
                    stream_key: null,
                    enabled: 1,
                    status: 'active',
                    is_online: 1,
                    stream_source: 'external',
                    external_hls_url: 'https://example.com/live/index.m3u8',
                },
                {
                    id: 3,
                    name: 'Maintenance Cam',
                    stream_key: null,
                    enabled: 1,
                    status: 'maintenance',
                    is_online: 1,
                    stream_source: 'external',
                    external_hls_url: 'https://example.com/maintenance/index.m3u8',
                },
            ],
            paths: [
                {
                    name: 'internal-cam',
                    ready: true,
                    sourceReady: true,
                    readers: [],
                    bytesReceived: 1200,
                    bytesSent: 800,
                },
            ],
            viewersByCamera: {
                1: 2,
                2: 1,
            },
            sessionsByCamera: {
                1: [{ sessionId: 'internal-session' }],
                2: [{ sessionId: 'external-session' }],
            },
        });

        expect(streams).toHaveLength(3);
        expect(streams).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 1,
                name: 'Internal Cam',
                state: 'ready',
                ready: true,
                streamSource: 'internal',
                bytesReceived: 1200,
            }),
            expect.objectContaining({
                id: 2,
                name: 'External Cam',
                state: 'ready',
                ready: true,
                streamSource: 'external',
                bytesReceived: 0,
            }),
            expect.objectContaining({
                id: 3,
                name: 'Maintenance Cam',
                state: 'maintenance',
                ready: false,
            }),
        ]));
    });

    it('menandai kamera external tanpa HLS sebagai invalid stream dan offline', () => {
        const streams = buildDashboardStreams({
            cameras: [
                {
                    id: 10,
                    name: 'Broken External',
                    stream_key: null,
                    enabled: 1,
                    status: 'active',
                    is_online: 0,
                    stream_source: 'external',
                    external_hls_url: null,
                },
            ],
            paths: [],
        });

        expect(streams[0]).toEqual(expect.objectContaining({
            state: 'invalid',
            ready: false,
        }));
    });
});
