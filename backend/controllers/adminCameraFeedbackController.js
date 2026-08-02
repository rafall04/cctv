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

export async function listCameraReactionSummary(request, reply) {
    try {
        return reply.send({ success: true, data: cameraReactionService.getAdminSummary() });
    } catch (error) {
        console.error('List camera reaction summary error:', error);
        return reply.code(500).send({ success: false, message: 'Gagal memuat penilaian kamera' });
    }
}
