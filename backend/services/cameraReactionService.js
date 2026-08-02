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
 * WHY THE PUBLIC ONLY SEES THE POSITIVE COUNT
 * A public dislike counter would sit on 36 feeds this operator does not own — they belong to
 * Bojonegoro and Magetan — and would read as the operator's failing. Five of them are dead at the
 * source right now and would collect a visible pile of dislikes nobody here can act on. The
 * negative vote is still recorded and still counted; it is a QUALITY signal for the operator
 * (`getAdminSummary`), which is the only place it can actually cause something to happen.
 * A voter always sees their OWN vote, either way, or the button could not show its state.
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
     * @returns {{likes: number, myValue: number}} the public shape — never the dislike total.
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

    /** What a visitor may see: the fleet's positive count, plus their own vote whichever way it went. */
    getPublicSummary(cameraId, deviceHash) {
        requirePublicCamera(cameraId);
        return {
            likes: readCounts(cameraId).likes,
            myValue: readMyValue(cameraId, deviceHash),
        };
    }

    /**
     * Staff view: both sides, worst first. This is the whole point of collecting the negative vote —
     * "camera 25 has 30 dislikes and 2 likes" is a maintenance ticket that nothing else in the
     * system would ever have raised.
     */
    getAdminSummary() {
        const rows = query(`
            SELECT r.camera_id                                        AS id,
                   c.name,
                   a.name                                             AS area_name,
                   SUM(CASE WHEN r.value = 1 THEN 1 ELSE 0 END)       AS likes,
                   SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END)      AS dislikes,
                   MAX(r.updated_at)                                  AS last_vote_at
              FROM camera_reactions r
              JOIN cameras c ON c.id = r.camera_id
         LEFT JOIN areas a ON a.id = c.area_id
          GROUP BY r.camera_id, c.name, a.name
          ORDER BY dislikes DESC, likes ASC, r.camera_id ASC
        `);

        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            areaName: row.area_name || null,
            likes: Number(row.likes) || 0,
            dislikes: Number(row.dislikes) || 0,
            lastVoteAt: row.last_vote_at || null,
        }));
    }
}

export default new CameraReactionService();
