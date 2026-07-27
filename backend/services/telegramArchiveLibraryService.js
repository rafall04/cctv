/*
 * Purpose: Serve the Telegram recording archive back to the web — list what was uploaded, and
 *          stream a segment down from Telegram without ever exposing a Telegram URL.
 * Caller: routes/telegramArchiveRoutes.js (admin-only).
 * Deps: database/connectionPool (telegram_archive_uploads + cameras), node:fs, global fetch.
 * MainFuncs: listUploads, getUpload, openSegmentStream.
 * SideEffects: Calls the LOCAL Bot API server's getFile; reads the resulting file from disk.
 *
 * Why the stream is proxied rather than linked: a Telegram file URL contains the bot token and is
 * fetchable by anyone who has the string. Handing one to a browser would leak both the token and
 * unrestricted access to every archived recording. Everything goes through this backend, behind
 * the same admin guard as the rest of the surface.
 *
 * The local Bot API server (`--local`) returns an absolute PATH in getFile rather than a download
 * URL, and is not bound by the cloud API's 20 MB getFile ceiling — which matters when segments run
 * to 200 MB. We handle both shapes so a cloud-mode deployment still works.
 */

import fs from 'fs';
import { query, queryOne } from '../database/connectionPool.js';

const API_BASE = (process.env.TG_API_BASE || 'http://127.0.0.1:8092').replace(/\/+$/, '');
const TOKEN = process.env.TG_BOT_TOKEN || '';

/** Rows the archive page lists, newest first, optionally narrowed to one camera. */
export function listUploads({ cameraId = null, status = 'ok', limit = 100, offset = 0 } = {}) {
    const where = ['u.status = ?'];
    const params = [status];
    if (cameraId) {
        where.push('u.camera_id = ?');
        params.push(cameraId);
    }
    // Only rows that actually carry a file_id can be played back; the rest predate the uploader
    // recording it and are listed by the caller separately if wanted.
    const rows = query(
        `SELECT u.segment_id, u.camera_id, u.filename, u.file_size, u.status,
                u.file_id, u.recorded_at, u.uploaded_at, u.targets,
                c.name AS camera_name, a.name AS area_name
         FROM telegram_archive_uploads u
         LEFT JOIN cameras c ON c.id = u.camera_id
         LEFT JOIN areas a ON a.id = c.area_id
         WHERE ${where.join(' AND ')}
         ORDER BY u.uploaded_at DESC
         LIMIT ? OFFSET ?`,
        [...params, Math.min(Number(limit) || 100, 500), Number(offset) || 0],
    );

    return rows.map((row) => ({
        segmentId: row.segment_id,
        cameraId: row.camera_id,
        cameraName: row.camera_name || `Kamera ${row.camera_id}`,
        areaName: row.area_name || null,
        filename: row.filename,
        fileSize: row.file_size,
        status: row.status,
        // The web player needs a file_id; say so plainly rather than rendering a dead play button.
        playable: Boolean(row.file_id),
        recordedAt: row.recorded_at,
        uploadedAt: row.uploaded_at,
        groups: safeTargets(row.targets).map((t) => t.label).filter(Boolean),
    }));
}

/** Per-camera counts + total bytes, for the page header. */
export function getSummary() {
    const totals = queryOne(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN file_id IS NOT NULL THEN 1 ELSE 0 END) AS playable,
                COALESCE(SUM(file_size), 0) AS bytes
         FROM telegram_archive_uploads WHERE status = 'ok'`,
    ) || {};
    const cameras = query(
        `SELECT u.camera_id, COALESCE(c.name, 'Kamera ' || u.camera_id) AS camera_name,
                COUNT(*) AS segments
         FROM telegram_archive_uploads u
         LEFT JOIN cameras c ON c.id = u.camera_id
         WHERE u.status = 'ok'
         GROUP BY u.camera_id
         ORDER BY segments DESC`,
    );
    return {
        total: totals.total || 0,
        playable: totals.playable || 0,
        bytes: totals.bytes || 0,
        cameras: cameras.map((row) => ({
            id: row.camera_id,
            name: row.camera_name,
            segments: row.segments,
        })),
    };
}

export function getUpload(segmentId) {
    const row = queryOne(
        'SELECT segment_id, camera_id, filename, file_size, file_id FROM telegram_archive_uploads WHERE segment_id = ?',
        [segmentId],
    );
    if (!row) {
        const err = new Error('Segmen tidak ada di arsip');
        err.statusCode = 404;
        throw err;
    }
    return row;
}

/**
 * Resolve a stored file_id to a readable stream.
 * @returns {Promise<{stream: import('stream').Readable, size: number, filename: string}>}
 */
export async function openSegmentStream(segmentId) {
    const row = getUpload(segmentId);
    if (!row.file_id) {
        // Segments uploaded before the sidecar recorded file_id cannot be fetched back: Telegram
        // offers no way to ask for the file_id of an already-sent message.
        const err = new Error('Segmen ini terarsip sebelum file_id dicatat, jadi tidak bisa diputar dari web');
        err.statusCode = 409;
        throw err;
    }
    if (!TOKEN) {
        const err = new Error('TG_BOT_TOKEN belum diset di backend');
        err.statusCode = 503;
        throw err;
    }

    const response = await fetch(`${API_BASE}/bot${TOKEN}/getFile?file_id=${encodeURIComponent(row.file_id)}`);
    const body = await response.json().catch(() => ({}));
    if (!body?.ok || !body.result?.file_path) {
        const err = new Error(body?.description || 'Telegram menolak permintaan berkas');
        err.statusCode = 502;
        throw err;
    }

    const filePath = body.result.file_path;
    const size = body.result.file_size || row.file_size || 0;

    // Local Bot API server: an absolute path on disk. Cloud API: a relative path to download.
    if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
        return { stream: fs.createReadStream(filePath), size, filename: row.filename };
    }
    const download = await fetch(`${API_BASE}/file/bot${TOKEN}/${filePath}`);
    if (!download.ok || !download.body) {
        const err = new Error('Gagal mengunduh berkas dari Telegram');
        err.statusCode = 502;
        throw err;
    }
    return { stream: download.body, size, filename: row.filename };
}

function safeTargets(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export default { listUploads, getSummary, getUpload, openSegmentStream };
