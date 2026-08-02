/**
 * Purpose: Public endpoint for reporting a problem or an incident on one camera.
 * Caller: publicCameraFeedbackRoutes (/api/public/cameras/:id/report).
 * Deps: cameraReportService, voucherPass (device cookie).
 * MainFuncs: submitCameraReport, getReportCategories.
 * SideEffects: Writes camera_reports; may set the device cookie; may send a Telegram message.
 *
 * The response carries an id and nothing else. A reporter must not be able to read the queue back —
 * the moment they could, an internal ticket list becomes a public message board through the side
 * door, which is exactly what this design avoids.
 */

import cameraReportService, { CATEGORIES } from '../services/cameraReportService.js';
import {
    readVoucherDeviceHash,
    generateDeviceHash,
    setVoucherDeviceCookie,
} from '../services/voucherPass.js';

function fail(reply, error, fallbackMessage) {
    const code = error?.statusCode || 500;
    if (code === 500) console.error('[CameraReport]', error);
    return reply.code(code).send({
        success: false,
        message: code === 500 ? fallbackMessage : error.message,
    });
}

/** GET /api/public/cameras/report-categories — so the form's options and the server's agree. */
export async function getReportCategories(request, reply) {
    return reply.send({
        success: true,
        data: Object.entries(CATEGORIES).map(([key, label]) => ({ key, label })),
    });
}

/** POST /api/public/cameras/:id/report { category, message?, occurredAt? } */
export async function submitCameraReport(request, reply) {
    try {
        let deviceHash = readVoucherDeviceHash(request);
        if (!deviceHash) {
            deviceHash = generateDeviceHash();
            setVoucherDeviceCookie(request, reply, deviceHash);
        }

        const { category, message = null, occurredAt = null } = request.body || {};
        const created = cameraReportService.submitReport(Number(request.params.id), {
            category,
            message,
            occurredAt,
            deviceHash,
            ip: request.ip,
        });

        reply.header('Cache-Control', 'private, no-store');
        return reply.send({
            success: true,
            message: 'Laporan terkirim. Terima kasih.',
            data: created,
        });
    } catch (error) {
        return fail(reply, error, 'Gagal mengirim laporan');
    }
}
