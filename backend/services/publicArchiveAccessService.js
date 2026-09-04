/**
 * Purpose: Decide whether a PUBLIC playback-token holder may read one archived (Telegram) segment.
 * Caller: routes/publicArchiveRoutes.js.
 * Deps: connectionPool, playbackTokenService.
 * MainFuncs: resolveSegmentForRequest.
 * SideEffects: none — read-only decision. Streaming itself is done by telegramArchiveLibraryService.
 *
 * WHY THIS FILE IS SEPARATE FROM THE ADMIN LIBRARY
 * Every existing archive route is guarded by requireAdmin. Opening the same handlers to the public
 * by relaxing that guard would leave the *rest* of those handlers (listing, summary, routing config)
 * one config mistake away from public. This file exposes exactly one capability — read one segment —
 * and re-derives every check itself, so a future change to the admin surface cannot widen it.
 *
 * FOUR GATES, ALL OF WHICH MUST PASS
 *  1. The segment exists, uploaded ok, and still has a Telegram file_id.
 *  2. The camera is camera_class='community'. The project invariant is that owner_private and
 *     subscriber footage NEVER appears on a public surface; an archived copy is still that footage.
 *  3. The playback token covers this camera — decided by playbackTokenService with the REAL camera
 *     row, because area-scoped tokens need area_id and a synthesised stub would deny them.
 *  4. The segment is inside the token's playback window. This is the gate that is easy to forget:
 *     without it a 1-hour trial token could stream a month-old segment simply by knowing its id,
 *     since gates 1-3 all still pass. The window is what the buyer actually paid for.
 *
 * Failures are deliberately shaped so the endpoint is not an existence oracle: an unknown segment and
 * a non-community segment both answer 404, so nobody can enumerate ids to learn what exists.
 */

import { queryOne } from '../database/connectionPool.js';
import playbackTokenService from './playbackTokenService.js';
import { resolveAccessBounds } from './playbackRangePolicy.js';

function httpError(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function parseTimestampMs(value) {
    if (!value) return null;
    const text = String(value).trim();
    // recorded_at and the resolved bounds are UTC. A zoneless "YYYY-MM-DD HH:MM:SS" would otherwise be
    // read as process-local, drifting the archive gate by the tz offset on a non-UTC host (the same
    // defect toIso had). Pin a zoneless value to UTC; leave anything already carrying a zone untouched.
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)
        ? `${text.replace(' ', 'T')}Z`
        : text;
    const ms = Date.parse(normalized);
    return Number.isFinite(ms) ? ms : null;
}

class PublicArchiveAccessService {
    /**
     * Returns the archive row when every gate passes; throws with a statusCode otherwise.
     * Never returns the Telegram file URL or bot token — only ids the caller streams through us.
     */
    resolveSegmentForRequest(segmentId, request) {
        const id = Number.parseInt(segmentId, 10);
        if (!Number.isInteger(id) || id <= 0) {
            throw httpError('Segment tidak ditemukan', 404);
        }

        // Gate 1 + 2 in one read: the join makes a segment whose camera was deleted unreachable too.
        const row = queryOne(
            `SELECT u.segment_id, u.camera_id, u.filename, u.file_size, u.file_id, u.recorded_at,
                    c.id AS camera_id_ref, c.area_id, c.camera_class, c.public_playback_mode
               FROM telegram_archive_uploads u
               JOIN cameras c ON c.id = u.camera_id
              WHERE u.segment_id = ? AND u.status = 'ok'`,
            [id]
        );

        if (!row || !row.file_id) {
            throw httpError('Segment tidak ditemukan', 404);
        }

        // Gate 2. 404 rather than 403 on purpose — a 403 would confirm the segment exists.
        if (row.camera_class !== 'community') {
            throw httpError('Segment tidak ditemukan', 404);
        }

        // Gate 3. The real camera row goes in: resolveCameraAccess reads area_id for area-scoped
        // tokens and denies when it is absent, so a stub here would break area tokens entirely.
        const access = playbackTokenService.validateRequestForCamera(request, row.camera_id, {
            camera: {
                id: row.camera_id,
                area_id: row.area_id,
                camera_class: row.camera_class,
                public_playback_mode: row.public_playback_mode,
            },
            requireSession: false,
            touch: false,
            eventType: 'access_archive_segment',
        });

        // validateRequestForCamera throws for an invalid/expired/revoked token and returns null when
        // no credential was sent at all. Both mean "no access" here.
        if (!access) {
            throw httpError('Token playback diperlukan', 401);
        }

        // Gate 4: recorded_at must fall inside the token's entitlement — the rolling window (floor
        // now−N) OR an absolute [from, to] range (which also caps the ceiling). Bounds unify both.
        const windowHours = access.effective_playback_window_hours ?? access.playback_window_hours;
        const { fromIso, toIso } = resolveAccessBounds({
            playbackWindowHours: windowHours,
            playbackFrom: access.playback_from,
            playbackTo: access.playback_to,
        });
        if (fromIso || toIso) {
            const recordedAtMs = parseTimestampMs(row.recorded_at);
            if (recordedAtMs === null) {
                // Unknown recording time cannot be proven inside the entitlement — deny.
                throw httpError('Segment di luar jangkauan token ini', 403);
            }
            // Half-open [from, to): the upper bound is EXCLUSIVE on the segment start (recorded_at), so a
            // segment starting exactly at toIso is refused — same rule as the local stream gate, so the
            // archived-stream path cannot serve the one-segment overshoot the list gate now drops.
            if ((fromIso && recordedAtMs < Date.parse(fromIso)) || (toIso && recordedAtMs >= Date.parse(toIso))) {
                throw httpError('Segment di luar jangkauan token ini', 403);
            }
        }

        return {
            segmentId: row.segment_id,
            cameraId: row.camera_id,
            filename: row.filename,
            fileSize: row.file_size,
            recordedAt: row.recorded_at,
            windowHours: windowHours || null,
        };
    }
}

export default new PublicArchiveAccessService();
