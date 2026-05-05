/**
 * Purpose: Verify live viewer session closure precision and analytics writes.
 * Caller: Backend Vitest suite for services/viewerSessionService.js.
 * Deps: Vitest, mocked connectionPool, mocked timezone/cache/analytics services.
 * MainFuncs: endSession, cleanupStaleSessions, archiveOldHistory.
 * SideEffects: None; database and stats writes are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    queryMock,
    queryOneMock,
    executeMock,
    recordCompletedLiveViewMock,
} = vi.hoisted(() => ({
    queryMock: vi.fn(),
    queryOneMock: vi.fn(),
    executeMock: vi.fn(),
    recordCompletedLiveViewMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
}));

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

vi.mock('../services/viewerAnalyticsService.js', () => ({
    default: {
        getAnalytics: vi.fn(() => ({})),
    },
}));

vi.mock('../services/cacheService.js', () => ({
    CacheNamespace: { STATS: 'stats' },
    CacheTTL: { SHORT: 1 },
    cacheGetOrSetSync: (_key, factory) => factory(),
    cacheKey: (...parts) => parts.join(':'),
}));

vi.mock('../services/cameraViewStatsService.js', () => ({
    default: {
        recordCompletedLiveView: recordCompletedLiveViewMock,
    },
}));

import viewerSessionService from '../services/viewerSessionService.js';

function mockActiveSession(overrides = {}) {
    queryOneMock.mockImplementation((sql) => {
        if (sql.includes('FROM viewer_sessions')) {
            return {
                session_id: 'session-1',
                camera_id: 12,
                ip_address: '127.0.0.1',
                user_agent: 'vitest',
                device_type: 'desktop',
                started_at: '2026-05-05 00:00:00',
                ...overrides,
            };
        }

        if (sql.includes('FROM cameras')) {
            return { name: 'Camera Test' };
        }

        return null;
    });
}

describe('viewerSessionService', () => {
    beforeEach(() => {
        queryMock.mockReset();
        queryOneMock.mockReset();
        executeMock.mockReset();
        executeMock.mockReturnValue({ changes: 1 });
        recordCompletedLiveViewMock.mockReset();
        viewerSessionService.lastRetentionRunAt = Date.now();
    });

    it('uses the explicit end time for history duration and live view stats', () => {
        mockActiveSession();

        const ended = viewerSessionService.endSession('session-1', {
            endedAtMs: new Date(2026, 4, 5, 0, 0, 10).getTime(),
        });

        expect(ended).toBe(true);
        expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE viewer_sessions'), [
            '2026-05-05 00:00:10',
            10,
            'session-1',
        ]);
        expect(recordCompletedLiveViewMock).toHaveBeenCalledWith({
            cameraId: 12,
            durationSeconds: 10,
            viewedAt: '2026-05-05 00:00:10',
        });
    });

    it('closes stale sessions at their last heartbeat time instead of cleanup time', () => {
        queryMock.mockReturnValue([
            { session_id: 'session-stale', last_heartbeat: '2026-05-05 00:00:20' },
        ]);
        mockActiveSession({ session_id: 'session-stale' });

        viewerSessionService.cleanupStaleSessions();

        expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE viewer_sessions'), [
            '2026-05-05 00:00:20',
            20,
            'session-stale',
        ]);
        expect(recordCompletedLiveViewMock).toHaveBeenCalledWith(expect.objectContaining({
            durationSeconds: 20,
            viewedAt: '2026-05-05 00:00:20',
        }));
    });

    it('archives live history using a configured local SQL cutoff instead of SQLite UTC now', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-05T17:30:00.000Z'));

        viewerSessionService.archiveOldHistory(90);

        expect(executeMock).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO viewer_session_history_archive'), [
            '2026-02-05 00:30:00',
        ]);
        expect(executeMock).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM viewer_session_history'), [
            '2026-02-05 00:30:00',
        ]);

        vi.useRealTimers();
    });
});
