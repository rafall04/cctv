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

    it('writes the explicit end time as UTC for history duration and live view stats', () => {
        mockActiveSession();

        // started_at (mock) is UTC; the end instant is given in UTC so the stored value is
        // tz-runner-independent. Both endpoints are UTC now, so the duration is exact.
        const ended = viewerSessionService.endSession('session-1', {
            endedAtMs: Date.UTC(2026, 4, 5, 0, 0, 10),
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

    it('erases a cancelled session instead of writing a 0-second ghost to history', () => {
        mockActiveSession();

        const ended = viewerSessionService.endSession('session-1', { cancelled: true });

        expect(ended).toBe(true);
        expect(executeMock).toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM viewer_sessions'),
            ['session-1'],
        );
        expect(executeMock).not.toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO viewer_session_history'),
            expect.anything(),
        );
        expect(recordCompletedLiveViewMock).not.toHaveBeenCalled();
    });

    it('still records a genuine short bounce in history when the stop is not a cancellation', () => {
        mockActiveSession();

        const ended = viewerSessionService.endSession('session-1', {
            endedAtMs: Date.UTC(2026, 4, 5, 0, 0, 2),
        });

        expect(ended).toBe(true);
        expect(executeMock).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO viewer_session_history'),
            expect.arrayContaining([12, '2026-05-05 00:00:00', '2026-05-05 00:00:02', 2]),
        );
        expect(executeMock).not.toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM viewer_sessions'),
            expect.anything(),
        );
        expect(recordCompletedLiveViewMock).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 12,
            durationSeconds: 2,
        }));
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

    it('archives live history against SQLite\'s own UTC clock (no configured-tz cutoff param)', () => {
        viewerSessionService.archiveOldHistory(90);

        // Cutoff is now expressed inline as datetime('now','-90 days') (UTC) so it can never drift
        // from the UTC-stored started_at — no bound cutoff param travels with it.
        expect(executeMock).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("datetime('now', '-90 days')"),
            [],
        );
        expect(executeMock).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('DELETE FROM viewer_session_history'),
            [],
        );
    });
});
