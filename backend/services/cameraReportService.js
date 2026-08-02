/**
 * Purpose: Accept a specific, categorised report about one camera from an anonymous visitor, and
 *          hand it to the operator — never to another visitor.
 * Caller: cameraReportController (public submit), adminCameraFeedbackController (queue, resolve).
 * Deps: connectionPool, telegramService.
 * MainFuncs: submitReport, listReports, updateReportStatus, CATEGORIES.
 * SideEffects: Writes camera_reports; fires a Telegram message when the feedback bot is configured.
 *
 * WHY FREE TEXT IS SAFE HERE AND NOT IN A COMMENT BOX
 * Nothing written here is ever rendered on a public surface. The audience is the operator's queue
 * and a private Telegram group. A comment box's danger is not the typing, it is the publishing:
 * anonymous text about identifiable people, displayed under a live feed of a real street, with the
 * host carrying the liability. Remove the publishing and the danger goes with it.
 *
 * WHY CATEGORIES RATHER THAN A BARE TEXTAREA
 * "Buram", "gelap", "mati", "arah berubah" are the four things that actually go wrong with a
 * third-party feed, and each maps to a different action — chase the provider, adjust the camera,
 * or unpublish it. A free-text pile would have to be read and classified by a human before any of
 * that could happen, every single time.
 */

import { query, queryOne, execute } from '../database/connectionPool.js';
import { sendFeedbackMessage, isFeedbackConfigured } from './telegramService.js';

/** Fixed set: an unknown category is a client bug, and a growing set is a classification problem. */
export const CATEGORIES = Object.freeze({
    buram: 'Gambar buram',
    gelap: 'Gambar gelap',
    mati: 'Tidak tampil / mati',
    arah: 'Arah kamera berubah',
    kejadian: 'Ada kejadian di rekaman',
    lainnya: 'Lainnya',
});

export const STATUSES = Object.freeze(['baru', 'dibaca', 'selesai']);

/**
 * One device may file 5 reports an hour. Not a security boundary — the device hash is a cookie and
 * can be discarded — but it stops a stuck finger or a retry loop from filling the operator's queue
 * with the same complaint fifty times, which is the realistic failure here.
 */
const MAX_REPORTS_PER_HOUR = 5;

const MAX_MESSAGE_LENGTH = 500;

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    err.expose = true;
    return err;
}

function requirePublicCamera(cameraId) {
    const camera = queryOne(
        `SELECT id, name FROM cameras
          WHERE id = ? AND camera_class = 'community' AND enabled = 1`,
        [cameraId]
    );
    if (!camera) {
        const err = new Error('Kamera tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }
    return camera;
}

class CameraReportService {
    /**
     * @param {number} cameraId
     * @param {{category: string, message?: string, occurredAt?: string, deviceHash?: string, ip?: string}} input
     * @returns {{id: number}} — deliberately nothing else. The reporter gets an acknowledgement,
     *          not a readable queue; letting them fetch the row back would make this a public
     *          message board through the side door.
     */
    submitReport(cameraId, { category, message = null, occurredAt = null, deviceHash = null, ip = null } = {}) {
        const camera = requirePublicCamera(cameraId);

        const key = String(category || '').trim();
        if (!CATEGORIES[key]) throw badRequest('Jenis laporan tidak dikenali');

        const text = message ? String(message).trim() : '';
        if (text.length > MAX_MESSAGE_LENGTH) {
            throw badRequest(`Keterangan maksimal ${MAX_MESSAGE_LENGTH} karakter`);
        }
        // "Lainnya" without a description is an empty ticket — it names no problem to act on.
        if (key === 'lainnya' && !text) {
            throw badRequest('Pilih "Lainnya" hanya kalau kamu menuliskan keterangannya');
        }

        if (deviceHash) {
            const recent = queryOne(
                `SELECT COUNT(*) AS n FROM camera_reports
                  WHERE device_hash = ? AND created_at >= datetime('now', '-1 hour')`,
                [deviceHash]
            );
            if ((Number(recent?.n) || 0) >= MAX_REPORTS_PER_HOUR) {
                const err = new Error('Terlalu banyak laporan dari perangkat ini. Coba lagi nanti.');
                err.statusCode = 429;
                err.expose = true;
                throw err;
            }
        }

        const result = execute(
            `INSERT INTO camera_reports (camera_id, device_hash, category, message, occurred_at, ip_address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [cameraId, deviceHash, key, text || null, occurredAt || null, ip || null]
        );

        this._notify(camera, key, text, occurredAt);

        return { id: result.lastInsertRowid };
    }

    /*
     * Fire-and-forget. A Telegram outage must not turn into a failed report — the row is already
     * committed by this point, and the queue in the admin panel is the source of truth either way.
     */
    _notify(camera, category, message, occurredAt) {
        if (!isFeedbackConfigured()) return;

        const lines = [
            `<b>Laporan kamera</b>`,
            `Kamera: ${camera.name} (#${camera.id})`,
            `Jenis: ${CATEGORIES[category]}`,
        ];
        if (occurredAt) lines.push(`Waktu kejadian: ${occurredAt}`);
        if (message) lines.push(`Keterangan: ${message}`);

        sendFeedbackMessage(lines.join('\n')).catch((error) => {
            console.error('[CameraReport] Telegram notify failed:', error.message);
        });
    }

    /**
     * Operator queue.
     *
     * @param {{status?: string, category?: string, cameraId?: number, page?: number,
     *          limit?: number, sort?: 'newest'|'oldest'}} input
     *
     * `status: 'open'` is a pseudo-value meaning "anything not finished". The compact panel on the
     * camera page and the "belum ditutup" tab both want that, and expressing it as two separate
     * requests (baru + dibaca) would make the counts disagree the moment a third status appears.
     *
     * The summary is computed over the UNFILTERED table on purpose: an operator filtering to
     * "buram" still needs to see that 12 reports are open overall, or the filter quietly becomes a
     * blindfold.
     */
    listReports({ status = null, category = null, cameraId = null, page = 1, limit = 25, sort = 'newest' } = {}) {
        const where = [];
        const params = [];

        if (status === 'open') {
            where.push("r.status != 'selesai'");
        } else if (STATUSES.includes(status)) {
            where.push('r.status = ?');
            params.push(status);
        }
        if (CATEGORIES[category]) {
            where.push('r.category = ?');
            params.push(category);
        }
        if (Number.isInteger(Number(cameraId)) && Number(cameraId) > 0) {
            where.push('r.camera_id = ?');
            params.push(Number(cameraId));
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 200));
        const safePage = Math.max(1, Number(page) || 1);
        const offset = (safePage - 1) * safeLimit;
        const total = Number(queryOne(`SELECT COUNT(*) AS n FROM camera_reports r ${whereSql}`, params)?.n) || 0;

        /*
         * Unfinished always sorts above finished, whichever direction the operator picked. Date is
         * how they scan WITHIN that split; a resolved report floating to the top because it happens
         * to be the newest would bury the work that still needs doing.
         */
        const rows = query(
            `SELECT r.id, r.camera_id, r.category, r.message, r.occurred_at, r.status, r.created_at,
                    c.name AS camera_name, a.name AS area_name
               FROM camera_reports r
          LEFT JOIN cameras c ON c.id = r.camera_id
          LEFT JOIN areas a ON a.id = c.area_id
             ${whereSql}
           ORDER BY CASE WHEN r.status = 'selesai' THEN 1 ELSE 0 END ASC,
                    r.created_at ${sort === 'oldest' ? 'ASC' : 'DESC'},
                    r.id ${sort === 'oldest' ? 'ASC' : 'DESC'}
              LIMIT ? OFFSET ?`,
            [...params, safeLimit, offset]
        );

        return {
            reports: rows.map((row) => ({
                id: row.id,
                cameraId: row.camera_id,
                cameraName: row.camera_name || `#${row.camera_id}`,
                areaName: row.area_name || null,
                category: row.category,
                categoryLabel: CATEGORIES[row.category] || row.category,
                message: row.message || null,
                occurredAt: row.occurred_at || null,
                status: row.status,
                createdAt: row.created_at,
            })),
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                totalPages: Math.max(1, Math.ceil(total / safeLimit)),
            },
            summary: this.getSummary(),
        };
    }

    /** Counts across the whole table — never narrowed by the caller's filter. */
    getSummary() {
        const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
        for (const row of query('SELECT status, COUNT(*) AS n FROM camera_reports GROUP BY status')) {
            if (row.status in byStatus) byStatus[row.status] = Number(row.n) || 0;
        }

        const byCategory = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0]));
        for (const row of query('SELECT category, COUNT(*) AS n FROM camera_reports GROUP BY category')) {
            if (row.category in byCategory) byCategory[row.category] = Number(row.n) || 0;
        }

        const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
        return { total, open: total - byStatus.selesai, byStatus, byCategory };
    }

    /** The cameras that have ever been reported — the filter list, so it names no empty options. */
    listReportedCameras() {
        return query(`
            SELECT r.camera_id AS id, c.name, COUNT(*) AS reports
              FROM camera_reports r
         LEFT JOIN cameras c ON c.id = r.camera_id
          GROUP BY r.camera_id, c.name
          ORDER BY reports DESC, c.name ASC
        `).map((row) => ({
            id: row.id,
            name: row.name || `#${row.id}`,
            reports: Number(row.reports) || 0,
        }));
    }

    updateReportStatus(id, status) {
        if (!STATUSES.includes(status)) throw badRequest('Status tidak valid');

        const existing = queryOne('SELECT id FROM camera_reports WHERE id = ?', [id]);
        if (!existing) {
            const err = new Error('Laporan tidak ditemukan');
            err.statusCode = 404;
            throw err;
        }

        execute('UPDATE camera_reports SET status = ? WHERE id = ?', [status, id]);
        return { id: Number(id), status };
    }
}

export default new CameraReportService();
