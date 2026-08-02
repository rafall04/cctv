/**
 * Purpose: Measure how far back the system can ACTUALLY serve footage, so the sales catalogue can be
 *          checked against reality instead of against whatever number was typed into window_hours.
 * Caller: playbackProductService (annotates the admin + public catalogue), playbackProductController.
 * Deps: connectionPool, recordingIntervalsPolicy.
 * MainFuncs: getCoverage, clearCache.
 * SideEffects: None — read-only. Results are cached for 60s.
 *
 * WHY THIS EXISTS
 * `window_hours` is a PROMISE, not a fact. On 2026-08-02 production was selling "Bulanan — 30 hari
 * ke belakang" for Rp75.000 while the Telegram archive only reached back to 2026-07-31: the buyer
 * would have paid for 30 days and found ~2. Nothing in the code could notice, because no module
 * compared the catalogue against the footage. This one does.
 *
 * TWO SOURCES, AND THEY ARE NOT INTERCHANGEABLE
 *   local    `cameras.recording_duration_hours` — a rolling window that is always FULL. It is a
 *            forward promise: whatever happens, the last N hours will be on disk.
 *   archive  `telegram_archive_uploads` — grows from the day it was switched on and never shortens.
 *            It is a backward FACT: it reaches exactly as far as it has been running, no further.
 * Coverage is the deeper of the two, because playback merges both (archivedSegmentSourceService).
 *
 * THE CONTINUITY RULE IS THE SUBTLE PART
 * An archive that STOPPED is not a shorter archive — it is an archive with a hole. If uploads
 * halted 2 days ago and local retention is 4 hours, everything between "4 hours ago" and "2 days
 * ago" exists nowhere. Claiming the archive's full depth then would be worse than claiming nothing,
 * so a stale archive contributes 0 and says why. The threshold is not arbitrary: while the gap is
 * still shorter than local retention, local disk is covering it and there is no hole yet.
 */

import { queryOne } from '../database/connectionPool.js';
import { RECORDING_DEFAULT_RETENTION_HOURS } from './recordingIntervalsPolicy.js';

const CACHE_MS = 60 * 1000;

let cached = null;
let cachedAt = 0;

const MS_PER_HOUR = 60 * 60 * 1000;

/** Whole hours only. A package sold in hours is never made honest by a fractional remainder. */
function hoursSince(iso, nowMs) {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return 0;
    return Math.max(0, Math.floor((nowMs - then) / MS_PER_HOUR));
}

/**
 * The rolling window every recording community camera is guaranteed to hold.
 *
 * MIN, not average: a package covers `scope_type='all'`, so its depth is only true if it is true
 * for the SHALLOWEST camera in the fleet. Averaging would let one camera set to 30 days paper over
 * thirty-five set to four hours.
 */
function readLocal() {
    const row = queryOne(
        `SELECT MIN(COALESCE(NULLIF(recording_duration_hours, 0), ?)) AS min_hours,
                COUNT(*) AS cameras
           FROM cameras
          WHERE camera_class = 'community'
            AND enable_recording = 1
            AND enabled = 1`,
        [RECORDING_DEFAULT_RETENTION_HOURS]
    );

    return {
        hours: Math.max(0, Number(row?.min_hours) || 0),
        cameras: Number(row?.cameras) || 0,
    };
}

/**
 * How far back the archive reaches for EVERY camera it holds.
 *
 * `MAX(oldest)` inside the per-camera grouping, not `MIN(recorded_at)` across the table: a camera
 * added to the fleet yesterday has one day of archive, and the fleet-wide promise cannot be deeper
 * than that camera's shallowest point. Cameras with no archive row at all are excluded rather than
 * counted as zero — on production those are the five feeds that are 404 at the source, which have
 * no footage anywhere and would otherwise drag coverage to nothing.
 */
function readArchive(nowMs) {
    const absent = { hours: 0, cameras: 0, start: null, continuous: false, staleHours: null, present: false };

    let row;
    try {
        row = queryOne(
            `SELECT MAX(oldest) AS guaranteed_start,
                    MAX(newest) AS last_upload,
                    COUNT(*)    AS cameras
               FROM (SELECT camera_id,
                            MIN(recorded_at) AS oldest,
                            MAX(recorded_at) AS newest
                       FROM telegram_archive_uploads
                      WHERE status = 'ok'
                        AND file_id IS NOT NULL
                      GROUP BY camera_id)`
        );
    } catch {
        // No archive table yet (fresh install, or a test DB that does not need one). Not an error.
        return absent;
    }

    if (!row?.guaranteed_start || !row?.cameras) return absent;

    return {
        hours: hoursSince(row.guaranteed_start, nowMs),
        cameras: Number(row.cameras) || 0,
        start: row.guaranteed_start,
        lastUpload: row.last_upload,
        staleHours: hoursSince(row.last_upload, nowMs),
        continuous: true,
        present: true,
    };
}

class PlaybackCoverageService {
    /**
     * @returns {{
     *   coverageHours: number, localHours: number, archiveHours: number,
     *   archiveContinuous: boolean, archiveStaleHours: number|null, archiveStart: string|null,
     *   camerasRecording: number, camerasArchived: number, measurable: boolean, measuredAt: string
     * }}
     */
    getCoverage({ now = Date.now() } = {}) {
        if (cached && now - cachedAt < CACHE_MS) return cached;

        const local = readLocal();
        const archive = readArchive(now);

        /*
         * A gap longer than local retention means the two sources no longer touch. Until then the
         * disk is still covering the tail and the archive's depth is safe to claim.
         */
        const archiveContinuous = archive.present && archive.staleHours <= local.hours;
        const archiveHours = archiveContinuous ? archive.hours : 0;

        cached = {
            coverageHours: Math.max(local.hours, archiveHours),
            localHours: local.hours,
            archiveHours,
            archiveContinuous,
            archiveStaleHours: archive.present && !archiveContinuous ? archive.staleHours : null,
            archiveStart: archiveContinuous ? archive.start : null,
            camerasRecording: local.cameras,
            camerasArchived: archive.cameras,
            /*
             * Nothing recording means nothing to measure — NOT "coverage is zero". Callers must
             * treat this as "unknown" and skip the check, or a fresh install would flag every
             * package in the catalogue as over-promising before a single camera exists.
             */
            measurable: local.cameras > 0,
            measuredAt: new Date(now).toISOString(),
        };
        cachedAt = now;
        return cached;
    }

    /** Retention edits and fresh uploads should not wait out the cache in a test or an admin save. */
    clearCache() {
        cached = null;
        cachedAt = 0;
    }
}

export default new PlaybackCoverageService();
