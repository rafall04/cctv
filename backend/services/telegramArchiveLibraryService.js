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
import path from 'path';
import { query, queryOne } from '../database/connectionPool.js';

/*
 * The bot token lives in the SIDECAR's .env, not the backend's. Read it from there rather than
 * asking an operator to paste the same secret into a second file — telegramArchiveService.js
 * already reads that file for the same reason, and duplicating a credential is how the two copies
 * drift until one of them silently stops working.
 *
 * Resolved per call, not at import: the backend boots before anyone edits the sidecar config, and
 * a value cached at import would keep serving 503 long after the token was set.
 */
const BASE_DIR = process.env.TG_ARCHIVE_DIR || '/opt/tg-archive';
const ENV_FILE = process.env.TG_ARCHIVE_ENV_FILE || path.join(BASE_DIR, '.env');

function sidecarEnv() {
    try {
        return fs.readFileSync(ENV_FILE, 'utf8').split('\n').reduce((acc, line) => {
            const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
            if (match) acc[match[1]] = match[2].replace(/^["']|["']$/g, '');
            return acc;
        }, {});
    } catch {
        return {};
    }
}

function telegramConfig() {
    const env = sidecarEnv();
    return {
        apiBase: (process.env.TG_API_BASE || env.TG_API_BASE || 'http://127.0.0.1:8092').replace(/\/+$/, ''),
        token: process.env.TG_BOT_TOKEN || env.TG_BOT_TOKEN || '',
    };
}

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
                u.file_id, u.recorded_at, u.recorded_until, u.duration_seconds, u.uploaded_at, u.targets,
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
        recordedUntil: row.recorded_until,
        durationSeconds: row.duration_seconds,
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
    const { apiBase, token } = telegramConfig();
    if (!token) {
        const err = new Error(`Token bot Telegram tidak ditemukan di ${ENV_FILE}`);
        err.statusCode = 503;
        throw err;
    }

    const response = await fetch(`${apiBase}/bot${token}/getFile?file_id=${encodeURIComponent(row.file_id)}`);
    const body = await response.json().catch(() => ({}));
    if (!body?.ok || !body.result?.file_path) {
        const err = new Error(body?.description || 'Telegram menolak permintaan berkas');
        err.statusCode = 502;
        throw err;
    }

    const filePath = body.result.file_path;
    const size = body.result.file_size || row.file_size || 0;

    /*
     * Two shapes come back here, and BOTH are absolute paths in local mode:
     *   - the original recording, when it is still on disk (we uploaded it by file:// reference);
     *   - a copy inside the server's own --dir, when the recording was pruned and the server
     *     RE-DOWNLOADED it from Telegram. Verified on prod with a 120 MB file, far past the cloud
     *     API's 20 MB getFile ceiling — which is exactly why this feature is possible at all.
     *
     * Read from disk when the host can see the path (zero copy), and fall back to fetching it over
     * HTTP from the local server when it cannot. The fallback matters: the server's --dir must be
     * bind-mounted to the same host path (see sidecar/tg-archive/docker-compose.yml), and if that
     * mount is ever missing we serve the file slowly rather than not at all.
     */
    if (filePath.startsWith('/') || /^[A-Za-z]:[\/]/.test(filePath)) {
        if (fs.existsSync(filePath)) {
            return { stream: fs.createReadStream(filePath), size, filename: row.filename };
        }
        // Path is real but not visible from this process — ask the local server to serve it.
        const relative = filePath.replace(/^.*\/var\/lib\/telegram-bot-api\//, '');
        const viaHttp = await fetch(`${apiBase}/file/bot${token}/${relative}`);
        if (viaHttp.ok && viaHttp.body) {
            return { stream: viaHttp.body, size, filename: row.filename };
        }
        const err = new Error(
            `Berkas ada di server Bot API tapi tidak terbaca dari backend (${filePath}). `
            + 'Pastikan --dir server Bot API di-bind ke path host yang sama.',
        );
        err.statusCode = 502;
        throw err;
    }

    const download = await fetch(`${apiBase}/file/bot${token}/${filePath}`);
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
