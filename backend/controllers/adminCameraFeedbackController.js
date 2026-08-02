/**
 * Purpose: Staff view of what visitors think of each camera.
 * Caller: adminRoutes (behind authMiddleware + requireAdmin).
 * Deps: cameraReactionService.
 * MainFuncs: listCameraReactionSummary.
 * SideEffects: None — read-only.
 *
 * This is the only place the negative vote is ever shown. It is withheld from the public because a
 * visible dislike pile on a third party's feed reads as this operator's failing, and shown here
 * because "camera 25: 30 tidak, 2 suka" is a maintenance ticket nothing else in the system raises.
 */

import cameraReactionService from '../services/cameraReactionService.js';
import cameraReportService from '../services/cameraReportService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

export async function listCameraReactionSummary(request, reply) {
    try {
        return reply.send({ success: true, data: cameraReactionService.getAdminSummary() });
    } catch (error) {
        console.error('List camera reaction summary error:', error);
        return reply.code(500).send({ success: false, message: 'Gagal memuat penilaian kamera' });
    }
}

/** The operator's queue of visitor reports. Open ones first — see cameraReportService.listReports. */
export async function listCameraReports(request, reply) {
    try {
        return reply.send({ success: true, data: cameraReportService.listReports() });
    } catch (error) {
        console.error('List camera reports error:', error);
        return reply.code(500).send({ success: false, message: 'Gagal memuat laporan kamera' });
    }
}

export async function updateCameraReport(request, reply) {
    try {
        const result = cameraReportService.updateReportStatus(
            Number(request.params.id),
            request.body?.status,
        );

        /*
         * Audited because closing a report is the moment a complaint stops being visible to the
         * next operator. Who decided nothing more was needed, and when, is the only question
         * anyone asks afterwards.
         */
        logAdminAction({
            action: 'camera_report_status_changed',
            targetType: 'camera_report',
            targetId: result.id,
            adminUserId: request.user?.id,
            adminUsername: request.user?.username,
            status_after: result.status,
        }, request);

        return reply.send({ success: true, message: 'Laporan diperbarui', data: result });
    } catch (error) {
        const code = error?.statusCode || 500;
        if (code === 500) console.error('Update camera report error:', error);
        return reply.code(code).send({
            success: false,
            message: code === 500 ? 'Gagal memperbarui laporan' : error.message,
        });
    }
}
