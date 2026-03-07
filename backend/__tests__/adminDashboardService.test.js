import { afterEach, describe, expect, it, vi } from 'vitest';
import * as database from '../database/database.js';
import mediaMtxService from '../services/mediaMtxService.js';
import viewerSessionService from '../services/viewerSessionService.js';
import * as timezoneService from '../services/timezoneService.js';
import {
    default as adminDashboardService,
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

    it('menandai kamera internal tanpa path MediaMTX sebagai offline transport meski is_online bernilai 1', () => {
        const streams = buildDashboardStreams({
            cameras: [
                {
                    id: 7,
                    name: 'Detached Internal',
                    stream_key: 'detached-internal',
                    enabled: 1,
                    status: 'active',
                    is_online: 1,
                    stream_source: 'internal',
                    external_hls_url: null,
                },
            ],
            paths: [],
        });

        expect(streams).toEqual([
            expect.objectContaining({
                id: 7,
                streamSource: 'internal',
                operationalState: 'online',
                state: 'offline',
                ready: false,
            }),
        ]);
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

describe('adminDashboardService dashboard stats', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mengembalikan recent logs dengan tanggal penuh dan jam tanpa mengubah urutan', async () => {
        vi.spyOn(database, 'queryOne')
            .mockReturnValueOnce({ total: 3, active: 2, disabled: 1 })
            .mockReturnValueOnce({ total: 2 });

        vi.spyOn(database, 'query')
            .mockReturnValueOnce([
                {
                    id: 7,
                    name: 'Camera Alpha',
                    stream_key: 'camera-alpha',
                    enabled: 1,
                    status: 'active',
                    is_online: 1,
                    stream_source: 'internal',
                    external_hls_url: null,
                },
            ])
            .mockReturnValueOnce([
                {
                    id: 10,
                    action: 'UPDATE_CAMERA',
                    details: 'Updated camera ID: 7',
                    user_id: 1,
                    username: 'aldi',
                    created_at: '2026-03-08T11:06:05.000Z',
                },
                {
                    id: 9,
                    action: 'UPDATE_CAMERA',
                    details: 'Updated camera ID: 5',
                    user_id: 1,
                    username: 'aldi',
                    created_at: '2026-03-08T11:05:42.000Z',
                },
            ]);

        vi.spyOn(mediaMtxService, 'getStats').mockResolvedValue({ paths: [] });
        vi.spyOn(viewerSessionService, 'getViewerStats').mockReturnValue({
            activeViewers: 0,
            viewersByCamera: [],
            activeSessions: [],
            allSessions: [],
        });
        vi.spyOn(timezoneService, 'getTimezone').mockReturnValue('Asia/Jakarta');

        const stats = await adminDashboardService.getDashboardStats();

        expect(stats.recentLogs).toHaveLength(2);
        expect(stats.recentLogs[0].id).toBe(10);
        expect(stats.recentLogs[0].created_at_wib).toMatch(/\d{2}\/\d{2}\/\d{4}/);
        expect(stats.recentLogs[0].created_at_wib).toMatch(/\d{2}\.\d{2}\.\d{2}/);
        expect(stats.recentLogs[0].created_at_wib).not.toBe('18.06.05');
        expect(stats.recentLogs[1].id).toBe(9);
    });
});
