/**
 * Purpose: HTTP handlers for admin playback token management and public token activation.
 * Caller: playbackTokenRoutes and adminRoutes.
 * Deps: playbackTokenService and auth cookie option helper.
 * MainFuncs: listPlaybackTokens, listPlaybackTokenAuditLogs, createPlaybackToken, sharePlaybackToken, revokePlaybackToken, activatePlaybackToken, clearPlaybackToken.
 * SideEffects: Creates/revokes tokens and sets/clears HttpOnly playback token cookies.
 */

import playbackTokenService, { PLAYBACK_TOKEN_COOKIE } from '../services/playbackTokenService.js';
import { isHttpsRequest } from '../utils/authCookieOptions.js';

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

    const remainingSeconds = Math.floor((new Date(tokenData.expires_at).getTime() - Date.now()) / 1000);
    return Math.max(60, Math.min(remainingSeconds, 30 * 24 * 60 * 60));
}

export async function listPlaybackTokens(request, reply) {
    try {
        return reply.send({ success: true, data: playbackTokenService.listTokens() });
    } catch (error) {
        console.error('List playback tokens error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function listPlaybackTokenAuditLogs(request, reply) {
    try {
        const data = playbackTokenService.listAuditLogs(request.query || {});
        return reply.send({ success: true, data });
    } catch (error) {
        console.error('List playback token audit logs error:', error);
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
        console.error('Create playback token error:', error);
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
        console.error('Share playback token error:', error);
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
        console.error('Revoke playback token error:', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}

export async function activatePlaybackToken(request, reply) {
    try {
        const token = String(request.body?.token || request.body?.share_key || '').trim();
        if (!token) {
            return reply.code(400).send({ success: false, message: 'Token atau kode share wajib diisi' });
        }

        const cameraId = request.body?.camera_id || request.query?.cameraId || 0;
        const data = playbackTokenService.validateRawTokenForCamera(token, cameraId || 0, {
            touch: true,
            eventType: request.body?.share_key ? 'activated_share' : 'activated_token',
            request,
        });

        reply.setCookie(
            PLAYBACK_TOKEN_COOKIE,
            token,
            getPlaybackTokenCookieOptions(request, resolveCookieMaxAge(data))
        );

        return reply.send({ success: true, message: 'Token playback aktif', data });
    } catch (error) {
        console.error('Activate playback token error:', error);
        return reply.code(error.statusCode || 500).send({
            success: false,
            message: error.statusCode ? error.message : 'Internal server error',
        });
    }
}

export async function clearPlaybackToken(request, reply) {
    reply.clearCookie(PLAYBACK_TOKEN_COOKIE, { path: '/' });
    return reply.send({ success: true, message: 'Token playback dibersihkan' });
}
