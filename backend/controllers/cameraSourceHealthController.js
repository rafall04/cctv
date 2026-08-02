/**
 * Purpose: Admin HTTP handler for the "dead at source" camera list.
 * Caller: adminRoutes (behind authMiddleware + requireAdmin).
 * Deps: cameraSourceHealthService.
 * MainFuncs: listDeadSources.
 * SideEffects: None — read-only.
 *
 * Staff-only on purpose: this describes a third party's outage in detail, and it belongs in front
 * of the operator who can email them — not on any public surface.
 */

import cameraSourceHealthService from '../services/cameraSourceHealthService.js';

export async function listDeadSources(request, reply) {
    try {
        return reply.send({ success: true, data: cameraSourceHealthService.getDeadSources() });
    } catch (error) {
        console.error('List dead camera sources error:', error);
        return reply.code(500).send({ success: false, message: 'Gagal memuat status sumber kamera' });
    }
}
