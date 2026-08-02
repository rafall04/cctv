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

    /** Operator queue: open reports first, newest first within each group. */
    listReports({ limit = 50 } = {}) {
        const rows = query(
            `SELECT r.id, r.camera_id, r.category, r.message, r.occurred_at, r.status, r.created_at,
                    c.name AS camera_name, a.name AS area_name
               FROM camera_reports r
          LEFT JOIN cameras c ON c.id = r.camera_id
          LEFT JOIN areas a ON a.id = c.area_id
           ORDER BY CASE WHEN r.status = 'selesai' THEN 1 ELSE 0 END ASC,
                    r.created_at DESC
              LIMIT ?`,
            [Math.max(1, Math.min(Number(limit) || 50, 200))]
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
            openCount: Number(
                queryOne("SELECT COUNT(*) AS n FROM camera_reports WHERE status != 'selesai'")?.n
            ) || 0,
        };
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
