/**
 * Purpose: Verify playback token HTTP handlers apply UTC SQL expiry semantics to cookie lifetimes.
 * Caller: Backend Vitest suite for controllers/playbackTokenController.js.
 * Deps: Vitest and mocked playbackTokenService.
 * MainFuncs: activatePlaybackToken.
 * SideEffects: None; reply cookie writes are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    validateRawTokenForCameraMock,
    createPlaybackSessionMock,
} = vi.hoisted(() => ({
    validateRawTokenForCameraMock: vi.fn(),
    createPlaybackSessionMock: vi.fn(),
}));

vi.mock('../services/playbackTokenService.js', () => ({
    PLAYBACK_TOKEN_COOKIE: 'raf_playback_token',
    PLAYBACK_TOKEN_SESSION_COOKIE: 'raf_playback_session',
    default: {
        validateRawTokenForCamera: validateRawTokenForCameraMock,
        createPlaybackSession: createPlaybackSessionMock,
    },
}));

vi.mock('../utils/authCookieOptions.js', () => ({
    isHttpsRequest: () => false,
}));

import { activatePlaybackToken } from '../controllers/playbackTokenController.js';

function buildReply() {
    return {
        cookies: [],
        setCookie(name, value, options) {
            this.cookies.push({ name, value, options });
            return this;
        },
        send: vi.fn((payload) => payload),
        code: vi.fn(function code() {
            return this;
        }),
    };
}

describe('playbackTokenController', () => {
    beforeEach(() => {
        vi.useRealTimers();
        validateRawTokenForCameraMock.mockReset();
        createPlaybackSessionMock.mockReset();
    });

    it('uses UTC SQL token expiry when calculating playback token cookie maxAge', async () => {
        vi.setSystemTime(new Date('2026-05-05T07:00:00.000Z'));
        validateRawTokenForCameraMock.mockReturnValue({
            id: 1,
            expires_at: '2026-05-05 07:10:00',
        });
        createPlaybackSessionMock.mockReturnValue({
            session_id: 'session-1',
            timeout_seconds: 60,
        });

        const reply = buildReply();
        await activatePlaybackToken({
            body: { token: 'rafpb_demo' },
            query: {},
            headers: {},
        }, reply);

        expect(reply.cookies[0]).toMatchObject({
            name: 'raf_playback_token',
            options: { maxAge: 600 },
        });
    });
});
