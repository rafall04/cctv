import { afterEach, describe, expect, it, vi } from 'vitest';
import * as database from '../database/connectionPool.js';
import mediaMtxService from '../services/mediaMtxService.js';
import viewerSessionService from '../services/viewerSessionService.js';
import * as timezoneService from '../services/timezoneService.js';
import { localDayUtcRange } from '../services/timeService.js';
import {
    default as adminDashboardService,
    buildDashboardStreams,
    getCameraOperationalState,
    getCameraStatusBreakdown,
} from '../services/adminDashboardService.js';

describe('adminDashboardService period filters are bound, not interpolated', () => {
    /*
     * This service (and viewerAnalyticsService) were the last two places pasting date
     * values straight into SQL text. The fix was deferred for months with the note "these
     * analytics services have no tests to verify a rewrite" — so the values below are the
     * verification that was missing: the SQL must carry placeholders, and the dates must
     * arrive as bound parameters in the right order.
     */
    const dayOffset = (days) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    };

    async function captureSessionQueries(period) {
        vi.spyOn(timezoneService, 'getTimezone').mockReturnValue('Asia/Jakarta');
        vi.spyOn(viewerSessionService, 'getViewerStats').mockReturnValue({ activeViewers: 0, sessions: [] });
        const calls = [];
        vi.spyOn(database, 'query').mockImplementation((sql, params) => {
            calls.push({ sql, params });
            return [];
        });
        vi.spyOn(database, 'queryOne').mockReturnValue({});

        await adminDashboardService.getTodayStats(period);
        return calls.filter((c) => c.sql.includes('viewer_session_history'));
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const dayRange = (days) => localDayUtcRange(dayOffset(days), 'Asia/Jakarta');

    it.each([
        ['today', () => [
            [dayRange(0).startUtcSql, dayRange(0).endUtcSql],
            [dayRange(-1).startUtcSql, dayRange(-1).endUtcSql],
        ]],
        ['yesterday', () => [
            [dayRange(-1).startUtcSql, dayRange(-1).endUtcSql],
            [dayRange(-2).startUtcSql, dayRange(-2).endUtcSql],
        ]],
        ['7days', () => [
            [dayRange(-7).startUtcSql],
            [dayRange(-14).startUtcSql, dayRange(-7).startUtcSql],
        ]],
        ['30days', () => [
            [dayRange(-30).startUtcSql],
            [dayRange(-60).startUtcSql, dayRange(-30).startUtcSql],
        ]],
    ])('period %s binds the right UTC bounds', async (period, expected) => {
        const [currentQuery, previousQuery] = await captureSessionQueries(period);
        const [currentParams, previousParams] = expected();

        expect(currentQuery.params).toEqual(currentParams);
        expect(previousQuery.params).toEqual(previousParams);

        // The dates must not also be sitting in the SQL text.
        for (const { sql, params } of [currentQuery, previousQuery]) {
            for (const p of params) {
                expect(sql).not.toContain(p);
            }
            expect(sql).toContain('?');
        }
    });

    it('an unknown period falls back to today rather than dropping the filter', async () => {
        const [currentQuery] = await captureSessionQueries('nonsense');
        expect(currentQuery.params).toEqual([dayRange(0).startUtcSql, dayRange(0).endUtcSql]);
    });
});

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
            .mockReturnValueOnce({ total: 2 })
                // Terminal default: without it vi.spyOn falls through to the REAL database.
                .mockReturnValue(undefined);

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
            ])
                // Terminal default: without it vi.spyOn falls through to the REAL database.
                .mockReturnValue([]);

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

describe('dashboard stream table split', () => {
    /*
     * The stream table is ~98% of the stats payload (~142KB of ~145KB) and the page only
     * reads it for the "all streams" drawer, so /stats?streams=0 must return everything EXCEPT
     * the table and /stats/streams must return exactly the table — built from the same inputs.
     */
    function stubSources({ cameras = [], paths = [], sessions = [], viewersByCamera = [] } = {}) {
        vi.spyOn(timezoneService, 'getTimezone').mockReturnValue('Asia/Jakarta');
        vi.spyOn(mediaMtxService, 'getStats').mockResolvedValue({ paths });
        vi.spyOn(viewerSessionService, 'getViewerStats').mockReturnValue({
            activeViewers: sessions.length,
            viewersByCamera,
            activeSessions: sessions,
            allSessions: [],
        });
        vi.spyOn(database, 'query').mockImplementation((sql) => {
            if (sql.includes('FROM cameras')) return cameras;
            return []; // recentLogs
        });
        vi.spyOn(database, 'queryOne')
            .mockReturnValueOnce({ total: cameras.length, active: cameras.length, disabled: 0 })
            .mockReturnValueOnce({ count: 1 })
            // Terminal default: without it vi.spyOn falls through to the REAL database.
            .mockReturnValue(undefined);
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('omits the stream table when includeStreams is false but keeps everything else', async () => {
        stubSources({
            cameras: [{ id: 1, name: 'Cam', stream_key: 'cam', enabled: 1, status: 'active', is_online: 1 }],
            paths: [{ name: 'cam', bytesSent: 100, bytesReceived: 50 }],
        });

        const stats = await adminDashboardService.getDashboardStats({ includeStreams: false });

        expect(stats.streams).toEqual([]);
        // Everything the summary cards/sidebar need still ships in the lite response.
        expect(stats.summary).toMatchObject({ totalCameras: 1, activeCameras: 1 });
        expect(stats.cameraStatusBreakdown).toMatchObject({ online: 1 });
        expect(stats.topCameras).toEqual([{ id: 1, name: 'Cam', viewers: 0 }]);
        expect(stats.mtxConnected).toBe(true);
        expect(stats.system).toBeTruthy();
        expect(Array.isArray(stats.recentLogs)).toBe(true);
        expect(Array.isArray(stats.allSessions)).toBe(true);
    });

    it('includes the stream table by default (backward compatible)', async () => {
        stubSources({
            cameras: [{ id: 1, name: 'Cam', stream_key: 'cam', enabled: 1, status: 'active', is_online: 1 }],
            paths: [{ name: 'cam', bytesSent: 100, bytesReceived: 50 }],
            viewersByCamera: [{ camera_id: 1, viewer_count: 3 }],
        });

        const stats = await adminDashboardService.getDashboardStats();

        expect(stats.streams).toHaveLength(1);
        expect(stats.streams[0]).toMatchObject({ id: 1, name: 'Cam', viewers: 3 });
    });

    it('getDashboardStreams returns the full table from the same inputs', async () => {
        stubSources({
            cameras: [
                { id: 1, name: 'Cam A', stream_key: 'cam-a', enabled: 1, status: 'active', is_online: 1 },
                { id: 2, name: 'Cam B', stream_key: 'cam-b', enabled: 1, status: 'active', is_online: 0 },
            ],
            paths: [{ name: 'cam-a', bytesSent: 100, bytesReceived: 50 }],
            viewersByCamera: [{ camera_id: 1, viewer_count: 2 }],
            sessions: [{ session_id: 's1', camera_id: 1, ip_address: '10.0.0.1', device_type: 'desktop', started_at: 'x', duration_seconds: 5 }],
        });

        const { streams } = await adminDashboardService.getDashboardStreams();

        expect(streams).toHaveLength(2);
        const camA = streams.find((s) => s.id === 1);
        const camB = streams.find((s) => s.id === 2);
        expect(camA).toMatchObject({ name: 'Cam A', viewers: 2, bytesSent: 100 });
        expect(camA.sessions).toHaveLength(1);
        expect(camA.sessions[0]).toMatchObject({ sessionId: 's1', ipAddress: '10.0.0.1' });
        expect(camB).toMatchObject({ name: 'Cam B', operationalState: 'offline' });
    });
});
