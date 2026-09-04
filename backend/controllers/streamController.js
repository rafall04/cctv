import streamService from '../services/streamService.js';
import playbackTokenService from '../services/playbackTokenService.js';
import { readVoucherDeviceHash } from '../services/voucherPass.js';

export async function getStreamUrls(request, reply) {
    try {
        const { cameraId } = request.params;
        const data = streamService.getStreamUrls(
            cameraId,
            request.hostname,
            request.user || null,
            readVoucherDeviceHash(request)
        );

        return reply.send({ success: true, data });
    } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 402) {
            return reply.code(error.statusCode).send({ success: false, message: error.message });
        }
        console.error('Get stream URLs error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function getAllActiveStreams(request, reply) {
    try {
        const data = streamService.getAllActiveStreams(request.hostname);
        return reply.send({ success: true, data });
    } catch (error) {
        console.error('Get all active streams error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function generateStreamToken(request, reply) {
    try {
        const { cameraId } = request.params;
        const data = streamService.generateStreamToken(
            cameraId,
            request.hostname,
            request.user || null,
            readVoucherDeviceHash(request)
        );

        return reply.send({ success: true, data });
    } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 402) {
            return reply.code(error.statusCode).send({ success: false, message: error.message });
        }
        console.error('Generate stream token error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

/**
 * Mint a live stream_access token from a PLAYBACK token. The playback token (sent as the
 * `Authorization: Playback <token>` header or the playback cookie) is the authorization: it must
 * cover this exact camera AND carry the live entitlement (token default or per-camera override).
 * This is the only live path for a non-account holder — it reuses the playback scope gate, so a
 * token can never grant live for a camera it cannot also play back.
 */
export async function generateLiveGrant(request, reply) {
    try {
        const { cameraId } = request.params;
        const id = Number.parseInt(cameraId, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return reply.code(400).send({ success: false, message: 'Kamera tidak valid' });
        }
        // The playback token (cookie/header) is the authorization: validateRequestForCamera runs the
        // full existence/revoked/expired/in-scope check (throws 401/403), and effective_allow_live is
        // the per-camera live decision resolved by that same gate — so live can never exceed playback.
        // requireSession:false — live is bounded by the short stream_access JWT, not a playback slot.
        const token = playbackTokenService.validateRequestForCamera(request, id, { requireSession: false });
        if (!token || token.effective_allow_live !== true) {
            return reply.code(403).send({ success: false, message: 'Token ini tidak mengizinkan akses live untuk kamera ini' });
        }
        const data = streamService.mintStreamAccessToken(id, request.hostname);
        return reply.send({ success: true, data });
    } catch (error) {
        const code = error.statusCode || 500;
        if ([400, 401, 402, 403, 404].includes(code)) {
            return reply.code(code).send({ success: false, message: error.message });
        }
        console.error('Generate live grant error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
