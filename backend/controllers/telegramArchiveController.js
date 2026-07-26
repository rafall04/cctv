/**
 * Purpose: Admin handlers for Telegram recording-archive routing (/api/admin/telegram-archive).
 * Caller: routes/telegramArchiveRoutes.js.
 * Deps: telegramArchiveService.
 * MainFuncs: getOverview, postRoute, putRoute, removeRoute, getActivity, postVerifyChat.
 */

import telegramArchiveService from '../services/telegramArchiveService.js';

function sendError(reply, error, label) {
    console.error(`${label}:`, error);
    const code = error.statusCode || 500;
    return reply.code(code).send({
        success: false,
        message: code === 500 ? 'Internal server error' : error.message,
    });
}

export async function getOverview(request, reply) {
    try {
        return reply.send({ success: true, data: telegramArchiveService.overview() });
    } catch (error) {
        return sendError(reply, error, 'Get telegram archive overview error');
    }
}

export async function postRoute(request, reply) {
    try {
        const data = telegramArchiveService.createRoute(request.body || {});
        return reply.code(201).send({
            success: true,
            message: 'Rute ditambahkan. Berlaku dalam ±1 menit tanpa restart.',
            data,
        });
    } catch (error) {
        return sendError(reply, error, 'Create telegram archive route error');
    }
}

export async function putRoute(request, reply) {
    try {
        const data = telegramArchiveService.updateRoute(request.params.id, request.body || {});
        return reply.send({
            success: true,
            message: 'Rute diperbarui. Berlaku dalam ±1 menit tanpa restart.',
            data,
        });
    } catch (error) {
        return sendError(reply, error, 'Update telegram archive route error');
    }
}

export async function removeRoute(request, reply) {
    try {
        const data = telegramArchiveService.deleteRoute(request.params.id);
        return reply.send({
            success: true,
            message: 'Rute dihapus. Kamera ini berhenti dikirim ke Telegram.',
            data,
        });
    } catch (error) {
        return sendError(reply, error, 'Delete telegram archive route error');
    }
}

export async function getActivity(request, reply) {
    try {
        return reply.send({ success: true, data: telegramArchiveService.activity() });
    } catch (error) {
        return sendError(reply, error, 'Get telegram archive activity error');
    }
}

export async function postVerifyChat(request, reply) {
    try {
        const data = await telegramArchiveService.verifyChat(request.body?.chatId);
        return reply.send({ success: true, data });
    } catch (error) {
        return sendError(reply, error, 'Verify telegram chat error');
    }
}
