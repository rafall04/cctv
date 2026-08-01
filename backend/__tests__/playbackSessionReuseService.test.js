/**
 * Purpose: Prove a refreshing browser is recognised as the SAME device, not a new one.
 * Caller: Backend Vitest suite for services/playbackSessionReuseService.js.
 * Deps: Vitest with a mocked connection pool.
 * MainFuncs: findLiveSession.
 * SideEffects: None; SQL is captured, not executed.
 *
 * Production showed the failure this guards: three reloads of one browser produced sessions
 * 2 -> 3 -> 4, so a single viewer appeared in the admin list as four devices.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryOneMock, executeMock } = vi.hoisted(() => ({
    queryOneMock: vi.fn(),
    executeMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    queryOne: queryOneMock,
    execute: executeMock,
}));

import { findLiveSession } from '../services/playbackSessionReuseService.js';

const TOKEN = { id: 9, session_timeout_seconds: 120 };
const withCookie = (sessionId) => ({ cookies: { raf_playback_session: sessionId } });

describe('findLiveSession', () => {
    beforeEach(() => {
        queryOneMock.mockReset();
        executeMock.mockReset();
    });

    it('matches the live session and returns the caller its own session id', () => {
        queryOneMock.mockReturnValue({ id: 55, token_id: 9 });

        expect(findLiveSession({ request: withCookie('sess-abc'), token: TOKEN }))
            .toMatchObject({ id: 55, session_id: 'sess-abc' });
    });

    it('scopes the lookup to this token, so another token\'s cookie cannot grant reuse', () => {
        queryOneMock.mockReturnValue(null);

        findLiveSession({ request: withCookie('sess-abc'), token: TOKEN });

        const [sql, params] = queryOneMock.mock.calls[0];
        expect(sql).toContain('token_id = ?');
        expect(params[0]).toBe(9);
        // The id is stored hashed; a raw session id must never reach the query.
        expect(params[1]).not.toBe('sess-abc');
        expect(params[1]).toMatch(/^[a-f0-9]{64}$/);
    });

    it('only counts a session that is neither ended nor expired', () => {
        queryOneMock.mockReturnValue(null);

        findLiveSession({ request: withCookie('sess-abc'), token: TOKEN });

        const [sql] = queryOneMock.mock.calls[0];
        expect(sql).toContain('ended_at IS NULL');
        expect(sql).toContain('expires_at > CURRENT_TIMESTAMP');
    });

    it('extends the expiry, so a viewer who only refreshes does not lapse mid-session', () => {
        queryOneMock.mockReturnValue({ id: 55, token_id: 9 });

        findLiveSession({ request: withCookie('sess-abc'), token: TOKEN });

        const [sql, params] = executeMock.mock.calls[0];
        expect(sql).toContain('last_seen_at = CURRENT_TIMESTAMP');
        expect(params[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        expect(params[1]).toBe(55);
    });

    it('returns null and touches nothing when no session matches', () => {
        queryOneMock.mockReturnValue(null);

        expect(findLiveSession({ request: withCookie('sess-stale'), token: TOKEN })).toBeNull();
        expect(executeMock).not.toHaveBeenCalled();
    });

    it('does not query at all without a cookie or a usable token', () => {
        expect(findLiveSession({ request: { cookies: {} }, token: TOKEN })).toBeNull();
        expect(findLiveSession({ request: withCookie('sess-abc'), token: { id: 0 } })).toBeNull();
        expect(findLiveSession({})).toBeNull();
        expect(queryOneMock).not.toHaveBeenCalled();
    });
});
