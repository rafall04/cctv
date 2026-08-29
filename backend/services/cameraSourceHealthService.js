/**
 * Purpose: Answer "which cameras are not coming back on their own?" — the feeds whose upstream
 *          source has been gone long enough that only the provider can fix them.
 * Caller: cameraSourceHealthController (GET /api/admin/cameras/source-health).
 * Deps: connectionPool, cameraSourceDeadPolicy.
 * MainFuncs: getDeadSources.
 * SideEffects: None — read-only.
 *
 * WHY A SEPARATE READ MODEL INSTEAD OF A COLUMN ON THE CAMERA LIST
 * `cameraService`'s runtime projection is shared by the admin list AND both public read models, so
 * a column added there would ship internal fault detail to anonymous visitors. This is staff-only
 * operational data about a third party, and it stays behind an admin route.
 *
 * The streak is only reported once it is CONFIRMED (see cameraSourceDeadPolicy). A camera that
 * 404'd for ten minutes belongs in the normal offline list, not on a page whose entire purpose is
 * "these are worth an email to the provider".
 */

import { query } from '../database/connectionPool.js';
import {
    isConfirmed,
    deadHours,
    describeReason,
    getConfirmAfterHours,
} from './cameraSourceDeadPolicy.js';

class CameraSourceHealthService {
    /**
     * @returns {{confirmAfterHours: number, cameras: Array<object>, total: number, stillPublic: number}}
     *
     * `stillPublic` is the number that are dead AND still enabled — the only actionable subset. A
     * dead camera the operator already disabled is resolved; leaving it in the count would keep the
     * badge lit forever and train people to ignore it.
     */
    getDeadSources({ now = Date.now() } = {}) {
        // Resolve the confirm window ONCE per pass — not per camera — so the loop below reads the
        // setting a single time even across a fleet of hundreds.
        const confirmAfterHours = getConfirmAfterHours();
        let rows = [];
        try {
            rows = query(`
                SELECT c.id,
                       c.name,
                       c.enabled,
                       c.camera_class,
                       a.name AS area_name,
                       crs.source_dead_since,
                       crs.source_dead_reason,
                       crs.monitoring_reason
                  FROM camera_runtime_state crs
                  JOIN cameras c ON c.id = crs.camera_id
             LEFT JOIN areas a ON a.id = c.area_id
                 WHERE crs.source_dead_since IS NOT NULL
              ORDER BY crs.source_dead_since ASC, c.id ASC
            `);
        } catch {
            // Migration has not run yet. An empty list is the honest answer, not a 500.
            return { confirmAfterHours, cameras: [], total: 0, stillPublic: 0 };
        }

        const cameras = rows
            .filter((row) => isConfirmed(row.source_dead_since, now, confirmAfterHours))
            .map((row) => ({
                id: row.id,
                name: row.name,
                areaName: row.area_name || null,
                enabled: row.enabled === 1,
                cameraClass: row.camera_class,
                reason: row.source_dead_reason,
                explanation: describeReason(row.source_dead_reason),
                since: row.source_dead_since,
                hours: deadHours(row.source_dead_since, now),
            }));

        return {
            confirmAfterHours,
            cameras,
            total: cameras.length,
            stillPublic: cameras.filter((camera) => camera.enabled).length,
        };
    }
}

export default new CameraSourceHealthService();
