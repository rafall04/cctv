/**
 * Purpose: Record and read the one thing a visitor can say about a camera without typing —
 *          whether it is any good.
 * Caller: cameraReactionController (public vote/read), adminCameraFeedbackController (quality view).
 * Deps: connectionPool.
 * MainFuncs: setReaction, getPublicSummary, getAdminSummary.
 * SideEffects: Writes camera_reactions.
 *
 * WHY REACTIONS AND NOT COMMENTS
 * There are no public accounts here — a visitor is a device cookie. Free text from anonymous
 * devices under a live feed of a real street invites plate numbers and accusations about
 * identifiable people, and the operator carries that liability, not the author. A vote carries no
 * text, so there is nothing to moderate and nothing to take down.
 *
 * BOTH COUNTS ARE PUBLIC — AN OWNER'S DECISION, 2026-08-02
 * The first cut published likes only, reasoning that a visible dislike pile on feeds this operator
 * does not own would read as their failing. The owner overruled it: the page should say what
 * visitors actually reported. That is the stronger argument. A camera whose picture has gone
 * useless is a fact about what a visitor is being offered, and hiding it while still showing the
 * praise makes the counter an advertisement rather than a measurement — the same dishonesty the
 * playback coverage guard exists to prevent elsewhere in this codebase.
 *
 * `getAdminSummary` therefore adds ranking and camera names for maintenance triage, not secrecy.
 * If public dislikes are ever reconsidered, note what actually changes: brigading a specific feed
 * becomes worth someone's time, and five cameras that are dead at the SOURCE will accumulate
 * blame that nobody reading the page can act on.
 */

import { query, queryOne, execute } from '../database/connectionPool.js';

/** +1 like, -1 dislike, 0 withdraw. Anything else is a client bug, not a vote. */
const ALLOWED_VALUES = new Set([1, -1, 0]);

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    err.expose = true;
    return err;
}

function notFound() {
    const err = new Error('Kamera tidak ditemukan');
    err.statusCode = 404;
    return err;
}

/**
 * Public surface is community-only (see the invariant in AGENTS.md). Resolved here rather than
 * trusted from the caller so a future route cannot accidentally open voting on a rented or private
 * camera — and so an unknown id and a non-community id answer identically, keeping the endpoint
 * from becoming an existence oracle for cameras the visitor may not know about.
 */
function requirePublicCamera(cameraId) {
    const camera = queryOne(
        `SELECT id FROM cameras
          WHERE id = ? AND camera_class = 'community' AND enabled = 1`,
        [cameraId]
    );
    if (!camera) throw notFound();
    return camera;
}

function readCounts(cameraId) {
    const row = queryOne(
        `SELECT SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END)  AS likes,
                SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS dislikes
           FROM camera_reactions
          WHERE camera_id = ?`,
        [cameraId]
    );
    return {
        likes: Number(row?.likes) || 0,
        dislikes: Number(row?.dislikes) || 0,
    };
}

function readMyValue(cameraId, deviceHash) {
    if (!deviceHash) return 0;
    const row = queryOne(
        'SELECT value FROM camera_reactions WHERE camera_id = ? AND device_hash = ?',
        [cameraId, deviceHash]
    );
    return Number(row?.value) || 0;
}

class CameraReactionService {
    /**
     * Cast, change, or withdraw this device's vote.
     * @returns {{likes: number, dislikes: number, myValue: number}} the public shape.
     */
    setReaction(cameraId, deviceHash, value) {
        if (!deviceHash) throw badRequest('Perangkat tidak dikenali');

        const vote = Number(value);
        if (!ALLOWED_VALUES.has(vote)) throw badRequest('Nilai reaksi tidak valid');

        requirePublicCamera(cameraId);

        if (vote === 0) {
            execute('DELETE FROM camera_reactions WHERE camera_id = ? AND device_hash = ?', [cameraId, deviceHash]);
        } else {
            /*
             * Plain INSERT … ON CONFLICT DO UPDATE. The replace-on-conflict variant would DELETE
             * the existing row first, silently resetting created_at and losing when this device
             * first voted — and it is banned outright by the data-safety rule in AGENTS.md.
             */
            execute(
                `INSERT INTO camera_reactions (camera_id, device_hash, value)
                 VALUES (?, ?, ?)
                 ON CONFLICT(camera_id, device_hash) DO UPDATE SET
                     value = excluded.value,
                     updated_at = datetime('now')`,
                [cameraId, deviceHash, vote]
            );
        }

        return this.getPublicSummary(cameraId, deviceHash);
    }

    /** Both totals as voted, plus this device's own vote so the buttons can show their state. */
    getPublicSummary(cameraId, deviceHash) {
        requirePublicCamera(cameraId);
        const counts = readCounts(cameraId);
        return {
            likes: counts.likes,
            dislikes: counts.dislikes,
            myValue: readMyValue(cameraId, deviceHash),
        };
    }

    /**
     * Staff view: the same two numbers the public sees, but for the WHOLE community fleet and
     * ranked worst-first.
     *
     * LEFT JOIN from cameras, not an inner join from reactions. A camera nobody has voted on is a
     * real answer — "36 cameras, 4 have ever been rated" is the fact an operator needs before
     * drawing any conclusion from a leaderboard of three. Starting from the reactions table would
     * silently drop every unrated camera and make a thin sample look like a complete picture.
     *
     * Ordering puts unrated cameras last: they carry no verdict, so they belong below the ones that
     * do rather than tied at the top with zero complaints.
     */
    getAdminSummary() {
        const rows = query(`
            SELECT c.id,
                   c.name,
                   c.enabled,
                   a.name                                              AS area_name,
                   SUM(CASE WHEN r.value = 1 THEN 1 ELSE 0 END)        AS likes,
                   SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END)       AS dislikes,
                   COUNT(r.device_hash)                                AS total,
                   MAX(r.updated_at)                                   AS last_vote_at
              FROM cameras c
         LEFT JOIN areas a ON a.id = c.area_id
         LEFT JOIN camera_reactions r ON r.camera_id = c.id
             WHERE c.camera_class = 'community'
          GROUP BY c.id, c.name, c.enabled, a.name
          ORDER BY (COUNT(r.device_hash) = 0) ASC,
                   dislikes DESC,
                   likes ASC,
                   c.id ASC
        `);

        const cameras = rows.map((row) => ({
            id: row.id,
            name: row.name,
            areaName: row.area_name || null,
            enabled: row.enabled === 1,
            likes: Number(row.likes) || 0,
            dislikes: Number(row.dislikes) || 0,
            total: Number(row.total) || 0,
            lastVoteAt: row.last_vote_at || null,
        }));

        return {
            cameras,
            totals: {
                cameras: cameras.length,
                rated: cameras.filter((camera) => camera.total > 0).length,
                likes: cameras.reduce((sum, camera) => sum + camera.likes, 0),
                dislikes: cameras.reduce((sum, camera) => sum + camera.dislikes, 0),
            },
        };
    }
}

export default new CameraReactionService();
