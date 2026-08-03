/**
 * Purpose: HTTP handlers for admin playback token management and public token activation.
 * Caller: playbackTokenRoutes and adminRoutes.
 * Deps: playbackTokenService, timeService, and auth cookie option helper.
 * MainFuncs: listPlaybackTokens, listPlaybackTokenAuditLogs, createPlaybackToken, updatePlaybackToken, sharePlaybackToken, revokePlaybackToken, activatePlaybackToken, heartbeatPlaybackToken, clearPlaybackToken, clearPlaybackTokenSessions.
 * SideEffects: Creates/revokes tokens and sets/clears HttpOnly playback token/session cookies.
 */

import playbackTokenService, {
    PLAYBACK_TOKEN_COOKIE,
    PLAYBACK_TOKEN_SESSION_COOKIE,
} from '../services/playbackTokenService.js';
import { deletePlaybackToken } from '../services/playbackTokenDeletionService.js';
import { findLiveSession } from '../services/playbackSessionReuseService.js';
import { parseUtcSql } from '../services/timeService.js';
import { isHttpsRequest } from '../utils/authCookieOptions.js';
import { logControllerError } from '../utils/controllerErrorLog.js';

function getPlaybackTokenCookieOptions(request, maxAge = 30 * 24 * 60 * 60) {
    const isHttps = isHttpsRequest(request);
    return {
        httpOnly: true,
        secure: isHttps,
        sameSite: isHttps ? 'none' : 'lax',
        path: '/',
        maxAge,
    };
}

function resolveCookieMaxAge(tokenData) {
    if (!tokenData?.expires_at) {
        return 30 * 24 * 60 * 60;
    }

    const expiresAt = parseUtcSql(tokenData.expires_at);
    const remainingSeconds = expiresAt
        ? Math.floor((expiresAt.getTime() - Date.now()) / 1000)
        : 60;
    return Math.max(60, Math.min(remainingSeconds, 30 * 24 * 60 * 60));
}

// In-memory per-IP throttle for failed public activation attempts. Cheap
// defence against brute-forcing the share-key namespace; combined with the
// `activation_failed` audit row this turns silent guessing into both visible
// and rate-limited behavior. The map is process-local — good enough for a
// single-process backend; multi-instance deployments would need Redis.
const ACTIVATION_FAILURE_WINDOW_MS = 60_000;
const ACTIVATION_FAILURE_LIMIT = 10;
const ACTIVATION_BUCKET_GC_THRESHOLD = 1000;
const activationFailureBuckets = new Map();

function getRequestClientIp(request) {
    const forwardedFor = request?.headers?.['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }
    return request?.ip || request?.socket?.remoteAddress || '';
}

function checkActivationThrottle(ip) {
    if (!ip) {
        return { allowed: true, retryInSeconds: 0 };
    }
    const now = Date.now();
    const bucket = activationFailureBuckets.get(ip);
    if (!bucket || (now - bucket.windowStart) > ACTIVATION_FAILURE_WINDOW_MS) {
        return { allowed: true, retryInSeconds: 0 };
    }
    if (bucket.count >= ACTIVATION_FAILURE_LIMIT) {
        return {
            allowed: false,
            retryInSeconds: Math.max(1, Math.ceil((bucket.windowStart + ACTIVATION_FAILURE_WINDOW_MS - now) / 1000)),
        };
    }
    return { allowed: true, retryInSeconds: 0 };
}

function recordActivationFailure(ip) {
    if (!ip) {
        return;
    }
    const now = Date.now();
    const bucket = activationFailureBuckets.get(ip);
    if (!bucket || (now - bucket.windowStart) > ACTIVATION_FAILURE_WINDOW_MS) {
        activationFailureBuckets.set(ip, { count: 1, windowStart: now });
    } else {
        bucket.count += 1;
    }

    // Lazy GC so the Map can't grow without bound under sustained attack.
    if (activationFailureBuckets.size > ACTIVATION_BUCKET_GC_THRESHOLD) {
        for (const [key, value] of activationFailureBuckets) {
            if ((now - value.windowStart) > ACTIVATION_FAILURE_WINDOW_MS) {
                activationFailureBuckets.delete(key);
            }
        }
    }
}

export async function listPlaybackTokens(request, reply) {
    try {
        return reply.send({ success: true, data: playbackTokenService.listTokens() });
    } catch (error) {
        logControllerError('List playback tokens', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function listPlaybackTokenAuditLogs(request, reply) {
    try {
        const data = playbackTokenService.listAuditLogs(request.query || {});
        return reply.send({ success: true, data });
    } catch (error) {
        logControllerError('List playback token audit logs', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function createPlaybackToken(request, reply) {
    try {
        const result = playbackTokenService.createToken(request.body || {}, request);
        return reply.send({
            success: true,
            message: 'Token playback dibuat',
            data: result.data,
            token: result.token,
            share_key: result.share_key,
            share_text: result.share_text,
        });
    } catch (error) {
        logControllerError('Create playback token', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}

export async function updatePlaybackToken(request, reply) {
    try {
        const data = playbackTokenService.updateTokenSettings(request.params.id, request.body || {}, request);
        return reply.send({ success: true, message: 'Token playback diperbarui', data });
    } catch (error) {
        logControllerError('Update playback token', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}

export async function sharePlaybackToken(request, reply) {
    try {
        const result = playbackTokenService.buildRepeatShareText(request.params.id, request);
        return reply.send({
            success: true,
            message: 'Teks share token dibuat',
            data: result.data,
            share_text: result.share_text,
        });
    } catch (error) {
        logControllerError('Share playback token', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}

export async function revokePlaybackToken(request, reply) {
    try {
        const data = playbackTokenService.revokeToken(request.params.id, request);
        return reply.send({ success: true, message: 'Token playback dicabut', data });
    } catch (error) {
        logControllerError('Revoke playback token', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}

export async function deletePlaybackTokenById(request, reply) {
    try {
        const data = deletePlaybackToken(request.params.id, request);
        // The message names the token, because after a delete there is nothing left on screen to
        // confirm which one went — and says plainly when a LIVE one was just cut off.
        const message = data.wasActive
            ? `Token "${data.label}" dihapus permanen — akses yang memakainya langsung terputus`
            : `Token "${data.label}" dihapus permanen`;
        return reply.send({ success: true, message, data });
    } catch (error) {
        logControllerError('Delete playback token', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}

export async function activatePlaybackToken(request, reply) {
    const clientIp = getRequestClientIp(request);
    const mode = request.body?.share_key ? 'activated_share' : 'activated_token';

    // Reject before validation when this IP has burned its failure budget.
    // Both prevents wall-clock brute force and keeps the audit log from being
    // flooded by a single attacker.
    const throttle = checkActivationThrottle(clientIp);
    if (!throttle.allowed) {
        return reply.code(429).send({
            success: false,
            message: `Terlalu banyak percobaan gagal. Coba lagi dalam ${throttle.retryInSeconds} detik.`,
            retry_after_seconds: throttle.retryInSeconds,
        });
    }

    try {
        const token = String(request.body?.token || request.body?.share_key || '').trim();
        if (!token) {
            return reply.code(400).send({ success: false, message: 'Token atau kode share wajib diisi' });
        }

        const cameraId = request.body?.camera_id || request.query?.cameraId || 0;

        // Validate first WITHOUT touching usage/audit. We don't want a token
        // to look "used" in the audit/use_count when activation actually
        // fails later (e.g. device-limit 429 from createPlaybackSession).
        let data;
        try {
            data = playbackTokenService.validateRawTokenForCamera(token, cameraId || 0, {
                touch: false,
                request,
                requireSession: false,
            });
        } catch (validationError) {
            // Credential-class errors (invalid/revoked/expired/out-of-scope)
            // get audited + counted against the throttle. Anything else is a
            // server fault and shouldn't punish the client IP.
            const statusCode = validationError?.statusCode;
            if (statusCode === 401 || statusCode === 403) {
                playbackTokenService.logFailedActivation({
                    request,
                    reason: validationError.message,
                    mode,
                });
                recordActivationFailure(clientIp);
            }
            throw validationError;
        }

        /*
         * A reload is not a new device.
         *
         * The share key now stays in the URL so a link survives a lost cookie, which means this
         * endpoint is hit on every refresh. createPlaybackSession unconditionally INSERTs, so the
         * same browser would burn one device slot per refresh and lock ITSELF out with 429 on any
         * token that caps sessions. assertPlaybackSession only matches a live row for THIS token,
         * so a stale cookie or another token's session correctly falls through to a fresh session.
         */
        const live = findLiveSession({ request, token: data });
        let session = live
            ? { session_id: live.session_id, timeout_seconds: data.session_timeout_seconds, reused: true }
            : null;

        if (!session) {
            session = playbackTokenService.createPlaybackSession({
                token: data,
                clientId: request.body?.client_id || '',
                request,
            });
        }

        // Only record activation success after session creation succeeds, so
        // the audit log + use_count match reality (cookies set below).
        playbackTokenService.touchTokenUsage(data, {
            eventType: mode,
            cameraId: Number.parseInt(cameraId, 10) > 0 ? Number.parseInt(cameraId, 10) : null,
            request,
            detail: { scope_type: data.scope_type, mode },
        });

        reply.setCookie(
            PLAYBACK_TOKEN_COOKIE,
            token,
            getPlaybackTokenCookieOptions(request, resolveCookieMaxAge(data))
        );
        reply.setCookie(
            PLAYBACK_TOKEN_SESSION_COOKIE,
            session.session_id,
            getPlaybackTokenCookieOptions(request, session.timeout_seconds)
        );

        return reply.send({ success: true, message: 'Token playback aktif', data, session });
    } catch (error) {
        logControllerError('Activate playback token', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}

export async function heartbeatPlaybackToken(request, reply) {
    try {
        const cameraId = request.body?.camera_id || request.query?.cameraId || 0;

        /*
         * The playback page calls this once on mount to ask "does this browser already
         * hold a token?". For a visitor who never had one there is nothing to
         * authenticate, so "no" is a valid ANSWER, not a failure — answering 401 made
         * every anonymous visit print a red console error on a page that was working
         * perfectly, because a browser logs a failed response regardless of the JS
         * `catch` around it.
         *
         * A cookie that IS present but no longer validates stays 401: that genuinely is
         * an expired session, and the periodic heartbeat relies on it to clear the UI.
         */
        if (!request.cookies?.[PLAYBACK_TOKEN_COOKIE]) {
            return reply.send({ success: true, data: null });
        }

        const data = playbackTokenService.validateRequestForCamera(request, cameraId || 0, {
            touch: false,
            requireSession: false,
        });
        if (!data) {
            return reply.code(401).send({ success: false, message: 'Token playback tidak aktif' });
        }

        const session = playbackTokenService.assertPlaybackSession({ request, token: data, touch: true });
        const sessionCookie = request.cookies?.[PLAYBACK_TOKEN_SESSION_COOKIE];
        if (sessionCookie) {
            reply.setCookie(
                PLAYBACK_TOKEN_SESSION_COOKIE,
                sessionCookie,
                getPlaybackTokenCookieOptions(request, data.session_timeout_seconds)
            );
        }

        return reply.send({ success: true, data, session });
    } catch (error) {
        logControllerError('Heartbeat playback token', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}

export async function clearPlaybackToken(request, reply) {
    // Match the catch-and-return contract used by every other handler in this
    // file. `stopPlaybackSession` already swallows the missing-schema case,
    // but anything else (locked DB, IO error) should not 500 raw — clearing
    // cookies is best-effort and must always respond cleanly.
    try {
        playbackTokenService.stopPlaybackSession(request, 'stopped');
    } catch (error) {
        console.warn('Clear playback token: stopPlaybackSession failed:', error.message);
    }
    reply.clearCookie(PLAYBACK_TOKEN_COOKIE, { path: '/' });
    reply.clearCookie(PLAYBACK_TOKEN_SESSION_COOKIE, { path: '/' });
    return reply.send({ success: true, message: 'Token playback dibersihkan' });
}

export async function clearPlaybackTokenSessions(request, reply) {
    try {
        const cleared = playbackTokenService.clearTokenSessions(request.params.id, request);
        return reply.send({ success: true, message: 'Session token dibersihkan', data: { cleared } });
    } catch (error) {
        logControllerError('Clear playback token sessions', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}
