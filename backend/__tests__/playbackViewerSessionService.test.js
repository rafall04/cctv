/**
 * Purpose: Verify playback viewer session timing uses configured local SQL semantics.
 * Caller: Backend Vitest suite for services/playbackViewerSessionService.js.
 * Deps: Vitest, mocked connectionPool, mocked timezone/cache services.
 * MainFuncs: endSession, archiveOldHistory.
 * SideEffects: None; database writes are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    queryMock,
    queryOneMock,
    executeMock,
} = vi.hoisted(() => ({
    queryMock: vi.fn(),
    queryOneMock: vi.fn(),
    executeMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
}));

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: () => 'Asia/Jakarta',
}));

vi.mock('../services/cacheService.js', () => ({
    CacheNamespace: { STATS: 'stats' },
    CacheTTL: { SHORT: 1 },
    cacheGetOrSetSync: (_key, factory) => factory(),
    cacheKey: (...parts) => parts.join(':'),
}));

import playbackViewerSessionService from '../services/playbackViewerSessionService.js';

describe('playbackViewerSessionService', () => {
    beforeEach(() => {
        queryMock.mockReset();
        queryOneMock.mockReset();
        executeMock.mockReset();
        executeMock.mockReturnValue({ changes: 1 });
        playbackViewerSessionService.lastRetentionRunAt = Date.now();
    });

    it('calculates playback history duration from local SQL timestamps', () => {
        queryOneMock.mockReturnValue({
            session_id: 'playback-session-1',
            camera_id: 7,
            camera_name: 'Playback Camera',
            segment_filename: 'seg-1.mp4',
            segment_started_at: '2026-05-05T07:00:00.000Z',
            playback_access_mode: 'public_preview',
            ip_address: '127.0.0.1',
            user_agent: 'vitest',
            device_type: 'desktop',
            admin_user_id: null,
            admin_username: null,
            started_at: '2026-05-05 14:00:00',
        });

        const ended = playbackViewerSessionService.endSession('playback-session-1', {
            endedAt: '2026-05-05 14:00:30',
        });

        expect(ended).toBe(true);
        expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE playback_viewer_sessions'), [
            '2026-05-05 14:00:30',
            30,
            'playback-session-1',
        ]);
    });

    it('archives playback history using a configured local SQL cutoff instead of SQLite UTC now', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-05T17:30:00.000Z'));

        playbackViewerSessionService.archiveOldHistory(90);

        expect(executeMock).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO playback_viewer_session_history_archive'), [
            '2026-02-05 00:30:00',
        ]);
        expect(executeMock).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM playback_viewer_session_history'), [
            '2026-02-05 00:30:00',
        ]);

        vi.useRealTimers();
    });
});
