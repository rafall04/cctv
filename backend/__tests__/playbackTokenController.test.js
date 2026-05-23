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
    touchTokenUsageMock,
    logFailedActivationMock,
    stopPlaybackSessionMock,
} = vi.hoisted(() => ({
    validateRawTokenForCameraMock: vi.fn(),
    createPlaybackSessionMock: vi.fn(),
    touchTokenUsageMock: vi.fn(),
    logFailedActivationMock: vi.fn(),
    stopPlaybackSessionMock: vi.fn(),
}));

vi.mock('../services/playbackTokenService.js', () => ({
    PLAYBACK_TOKEN_COOKIE: 'raf_playback_token',
    PLAYBACK_TOKEN_SESSION_COOKIE: 'raf_playback_session',
    default: {
        validateRawTokenForCamera: validateRawTokenForCameraMock,
        createPlaybackSession: createPlaybackSessionMock,
        touchTokenUsage: touchTokenUsageMock,
        logFailedActivation: logFailedActivationMock,
        stopPlaybackSession: stopPlaybackSessionMock,
    },
}));

vi.mock('../utils/authCookieOptions.js', () => ({
    isHttpsRequest: () => false,
}));

import {
    activatePlaybackToken,
    clearPlaybackToken,
} from '../controllers/playbackTokenController.js';

function buildReply() {
    return {
        cookies: [],
        clearedCookies: [],
        setCookie(name, value, options) {
            this.cookies.push({ name, value, options });
            return this;
        },
        clearCookie(name, options) {
            this.clearedCookies.push({ name, options });
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
        touchTokenUsageMock.mockReset();
        logFailedActivationMock.mockReset();
        stopPlaybackSessionMock.mockReset();
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

    it('returns allowed camera metadata after playback token activation', async () => {
        validateRawTokenForCameraMock.mockReturnValue({
            id: 2,
            expires_at: null,
            scope_type: 'selected',
            allowed_camera_ids: [7],
            camera_rules: [{ camera_id: 7, enabled: true, playback_window_hours: 24 }],
            default_camera_id: 7,
        });
        createPlaybackSessionMock.mockReturnValue({
            session_id: 'session-2',
            timeout_seconds: 60,
        });

        const reply = buildReply();
        const payload = await activatePlaybackToken({
            body: { share_key: 'CLIENT88', camera_id: 7, client_id: 'client-1' },
            query: {},
            headers: {},
        }, reply);

        // Validation runs WITHOUT touch — touchTokenUsage runs separately,
        // AFTER createPlaybackSession succeeds, so a 429 from the device
        // limit no longer leaves a phantom 'activated_share' audit row.
        expect(validateRawTokenForCameraMock).toHaveBeenCalledWith('CLIENT88', 7, expect.objectContaining({
            touch: false,
            requireSession: false,
        }));
        expect(touchTokenUsageMock).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), expect.objectContaining({
            eventType: 'activated_share',
            cameraId: 7,
        }));
        const validateCallOrder = validateRawTokenForCameraMock.mock.invocationCallOrder[0];
        const sessionCallOrder = createPlaybackSessionMock.mock.invocationCallOrder[0];
        const touchCallOrder = touchTokenUsageMock.mock.invocationCallOrder[0];
        expect(validateCallOrder).toBeLessThan(sessionCallOrder);
        expect(sessionCallOrder).toBeLessThan(touchCallOrder);

        expect(payload.data).toMatchObject({
            scope_type: 'selected',
            allowed_camera_ids: [7],
            camera_rules: [{ camera_id: 7, enabled: true, playback_window_hours: 24 }],
            default_camera_id: 7,
        });
    });

    it('does not touch token usage or audit when device-limit blocks activation', async () => {
        validateRawTokenForCameraMock.mockReturnValue({
            id: 9,
            expires_at: null,
            scope_type: 'all',
        });
        const deviceLimitError = new Error('Batas perangkat aktif untuk token ini sudah penuh');
        deviceLimitError.statusCode = 429;
        createPlaybackSessionMock.mockImplementation(() => {
            throw deviceLimitError;
        });

        const reply = buildReply();
        const payload = await activatePlaybackToken({
            body: { token: 'rafpb_demo' },
            query: {},
            headers: {},
            ip: '10.0.0.5',
        }, reply);

        expect(touchTokenUsageMock).not.toHaveBeenCalled();
        expect(logFailedActivationMock).not.toHaveBeenCalled();
        expect(reply.code).toHaveBeenCalledWith(429);
        expect(payload).toMatchObject({ success: false });
    });

    it('logs and rate-limits invalid public activation attempts', async () => {
        const invalidError = new Error('Token playback tidak valid');
        invalidError.statusCode = 401;
        validateRawTokenForCameraMock.mockImplementation(() => {
            throw invalidError;
        });

        // Burn through the per-IP failure budget (10/min). Each request
        // should be audited as activation_failed and rejected 401, then the
        // 11th call should be blocked 429 by the throttle.
        const ip = '10.99.99.7';
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const reply = buildReply();
            await activatePlaybackToken({
                body: { share_key: `BAD${attempt}` },
                query: {},
                headers: {},
                ip,
            }, reply);
        }

        expect(logFailedActivationMock).toHaveBeenCalledTimes(10);
        expect(logFailedActivationMock.mock.calls[0][0]).toMatchObject({
            reason: 'Token playback tidak valid',
            mode: 'activated_share',
        });

        const throttledReply = buildReply();
        const throttledPayload = await activatePlaybackToken({
            body: { share_key: 'BAD_FINAL' },
            query: {},
            headers: {},
            ip,
        }, throttledReply);

        expect(throttledReply.code).toHaveBeenCalledWith(429);
        expect(throttledPayload).toMatchObject({ success: false });
        // The throttled call must not run validation or write a new audit row.
        expect(validateRawTokenForCameraMock).toHaveBeenCalledTimes(10);
        expect(logFailedActivationMock).toHaveBeenCalledTimes(10);
    });

    it('clearPlaybackToken keeps returning 200 even when stopPlaybackSession throws', async () => {
        stopPlaybackSessionMock.mockImplementation(() => {
            throw new Error('database is locked');
        });

        const reply = buildReply();
        const payload = await clearPlaybackToken({
            cookies: { raf_playback_session: 'sess-1' },
            headers: {},
        }, reply);

        expect(payload).toMatchObject({ success: true });
        // Both cookies still get cleared even when the DB write throws — the
        // handler must not 500 on a best-effort cleanup.
        expect(reply.clearedCookies.map((entry) => entry.name)).toEqual([
            'raf_playback_token',
            'raf_playback_session',
        ]);
    });
});
