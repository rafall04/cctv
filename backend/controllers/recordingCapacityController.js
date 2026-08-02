/**
 * Purpose: Admin HTTP handler for the retention-versus-disk projection.
 * Caller: adminRoutes (behind authMiddleware + requireAdmin).
 * Deps: recordingCapacityService.
 * MainFuncs: getRecordingCapacity.
 * SideEffects: None to the database; the service shells out once to read free disk bytes.
 */

import recordingCapacityService from '../services/recordingCapacityService.js';

export async function getRecordingCapacity(request, reply) {
    try {
        return reply.send({ success: true, data: await recordingCapacityService.getCapacity() });
    } catch (error) {
        console.error('Recording capacity projection error:', error);
        return reply.code(500).send({ success: false, message: 'Gagal menghitung kebutuhan penyimpanan' });
    }
}
