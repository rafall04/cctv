/*
 * Purpose: Serve the Telegram recording archive back to the web — list what was uploaded, and
 *          stream a segment down from Telegram without ever exposing a Telegram URL.
 * Caller: routes/telegramArchiveRoutes.js (admin-only).
 * Deps: database/connectionPool (telegram_archive_uploads + cameras), node:fs, global fetch.
 * MainFuncs: listUploads, getUpload, openSegmentStream.
 * SideEffects: Calls the LOCAL Bot API server's getFile and the MTProto sidecar's /segment;
 *          reads the resulting file from disk; prefetches a whole-segment copy VIA BOT API
 *          (never the sidecar — a full download there starves live slices) into the managed
 *          transit dir (archiveCacheService) after the first MTProto slice is served.
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
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { query, queryOne } from '../database/connectionPool.js';
import archiveCache from './archiveCacheService.js';
import { sanitizeCameraThumbnailList } from './thumbnailPathService.js';

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

/**
 * Shared WHERE for listing and counting, so the "load more" button can never disagree with the
 * rows it is paging through.
 *
 * `from`/`to` filter on recorded_at — when the footage happened, which is what an operator is
 * actually looking for. It is stored as a fixed-format ISO-8601 UTC string, so a plain string
 * comparison against ISO bounds orders correctly. The CALLER converts the operator's local date
 * into those UTC bounds; doing it here would silently assume the server's timezone.
 */
function buildDateClause({ from = null, to = null } = {}) {
    const parts = [];
    const params = [];
    if (from) {
        parts.push('u.recorded_at >= ?');
        params.push(from);
    }
    if (to) {
        parts.push('u.recorded_at <= ?');
        params.push(to);
    }
    // '1' rather than an empty string: this clause is also embedded inside a CASE WHEN, where a
    // blank would be a syntax error instead of "no restriction".
    return { clause: parts.length ? parts.join(' AND ') : '1', params };
}

function buildUploadFilter({ cameraId = null, status = 'ok', from = null, to = null } = {}) {
    const where = ['u.status = ?'];
    const params = [status];
    if (cameraId) {
        where.push('u.camera_id = ?');
        params.push(cameraId);
    }
    const dates = buildDateClause({ from, to });
    if (dates.clause !== '1') {
        where.push(dates.clause);
        params.push(...dates.params);
    }
    return { clause: where.join(' AND '), params };
}

/**
 * How many rows match — the page needs it to know whether "load more" has anything left, and to
 * tell the operator how deep the archive actually goes. Without it the UI can only guess, which is
 * exactly how the list silently stopped at the newest 100 rows while 4,932 sat behind it.
 */
export function countUploads(filters = {}) {
    const { clause, params } = buildUploadFilter(filters);
    const row = queryOne(
        `SELECT COUNT(*) AS total FROM telegram_archive_uploads u WHERE ${clause}`,
        params,
    );
    return row?.total ?? 0;
}

/** Rows the archive page lists, newest first, optionally narrowed to one camera and date range. */
export function listUploads({
    cameraId = null, status = 'ok', limit = 100, offset = 0, from = null, to = null,
} = {}) {
    const { clause, params } = buildUploadFilter({ cameraId, status, from, to });
    // Only rows that actually carry a file_id can be played back; the rest predate the uploader
    // recording it and are listed by the caller separately if wanted.
    const rows = query(
        `SELECT u.segment_id, u.camera_id, u.filename, u.file_size, u.status,
                u.file_id, u.recorded_at, u.recorded_until, u.duration_seconds, u.uploaded_at, u.targets,
                c.name AS camera_name, a.name AS area_name
         FROM telegram_archive_uploads u
         LEFT JOIN cameras c ON c.id = u.camera_id
         LEFT JOIN areas a ON a.id = c.area_id
         WHERE ${clause}
         ORDER BY u.uploaded_at DESC, u.segment_id DESC
         LIMIT ? OFFSET ?`,
        [...params, Math.min(Number(limit) || 100, 500), Math.max(Number(offset) || 0, 0)],
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

/**
 * Where does a given instant sit in the filtered list? Returns the segment plus its 0-based
 * position, so the caller can turn that into a page number and jump straight there.
 *
 * Without this, "Lompat ke jam" could only search the rows already on screen — one page out of
 * dozens — and reported "tidak ada rekaman" for footage that was merely on another page.
 *
 * `at`, recorded_at and recorded_until are all ISO-8601 UTC in one fixed format, so plain string
 * comparison is chronological here. Do NOT swap in SQLite's datetime(): it emits
 * 'YYYY-MM-DD HH:MM:SS', which does not compare correctly against the stored '…THH:MM:SS.sssZ'.
 */
export function locateUpload({ at = null, ...filters } = {}) {
    if (!at) {
        return null;
    }
    const { clause, params } = buildUploadFilter(filters);

    // The newest segment that had already STARTED at that instant. With contiguous recording that
    // is the covering clip; across a gap it is the one just before, which is where an operator
    // wants to land anyway — "not found" with no bearing helps nobody.
    const target = queryOne(
        `SELECT u.segment_id, u.uploaded_at, u.recorded_until
         FROM telegram_archive_uploads u
         WHERE ${clause} AND u.recorded_at <= ?
         ORDER BY u.recorded_at DESC, u.segment_id DESC
         LIMIT 1`,
        [...params, at],
    );
    if (!target) {
        return null;
    }

    // Counted on uploaded_at because that is what the list is ordered by. recorded_at (capture) and
    // uploaded_at (upload) are different clocks and do not always agree on order, so deriving the
    // position from the search key would land on the wrong page.
    const before = queryOne(
        `SELECT COUNT(*) AS n
         FROM telegram_archive_uploads u
         WHERE ${clause}
           AND (u.uploaded_at > ? OR (u.uploaded_at = ? AND u.segment_id > ?))`,
        [...params, target.uploaded_at, target.uploaded_at, target.segment_id],
    );

    return {
        segmentId: target.segment_id,
        offset: before?.n ?? 0,
        // True when the instant fell in a recording hole and we landed on the clip before it.
        approximate: !(target.recorded_until && target.recorded_until >= at),
    };
}

/**
 * Per-camera counts + total bytes, for the page header.
 *
 * Takes the SAME filters as listUploads: a header that reports the whole archive while the list
 * below shows one filtered day is not a summary, it is a contradiction — and it is exactly how the
 * page read before, with "5120 segmen" sitting above a list of 216.
 */
export function getSummary(filters = {}) {
    const { clause, params } = buildUploadFilter(filters);
    /*
     * Split deliberately: `file_id IS NOT NULL` inside a CASE forces a main-table lookup on EVERY
     * matched row (~120k on prod — a 47.8s synchronous stall measured 2026-09-21). As its own
     * query the count rides idx_tg_archive_ok_camera_time (partial: status='ok' AND file_id IS NOT
     * NULL) or the status prefix index — both index-only. The totals query needs status/camera_id/
     * recorded_at/file_size only, all inside idx_tg_archive_status_cam_time.
     */
    const totals = queryOne(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(u.file_size), 0) AS bytes
         FROM telegram_archive_uploads u WHERE ${clause}`,
        params,
    ) || {};
    /*
     * With a camera filter the planner picks idx_tg_archive_status_cam_time, which cannot prove
     * file_id IS NOT NULL without a per-row lookup — 4.2s measured on prod for one camera. The
     * partial index carries that predicate in its WHERE, so the count never leaves the index
     * (13ms). Only valid when the effective status IS 'ok' — other statuses have no rows in it.
     */
    const okPartial = (filters.status || 'ok') === 'ok'
        ? ' INDEXED BY idx_tg_archive_ok_camera_time'
        : '';
    const playable = queryOne(
        `SELECT COUNT(*) AS c
         FROM telegram_archive_uploads u${okPartial} WHERE ${clause} AND u.file_id IS NOT NULL`,
        params,
    )?.c || 0;

    // The camera list drives the PICKER, so every camera stays in it regardless of the current
    // camera filter — narrowing by cameraId would strand the operator on one camera with no way
    // back. Only the date range is applied, via a conditional SUM, so a camera with nothing in the
    // range still appears (showing 0) instead of vanishing out from under the selection.
    const dates = buildDateClause(filters);
    // Area, location and thumbnail travel with each camera so the picker can group by area and show
    // a picture — for a junction camera the picture identifies the spot faster than any name.
    const cameras = query(
        `SELECT u.camera_id, COALESCE(c.name, 'Kamera ' || u.camera_id) AS camera_name,
                c.location, c.thumbnail_path, c.thumbnail_updated_at, c.external_snapshot_url,
                a.name AS area_name,
                SUM(CASE WHEN ${dates.clause} THEN 1 ELSE 0 END) AS segments
         FROM telegram_archive_uploads u
         LEFT JOIN cameras c ON c.id = u.camera_id
         LEFT JOIN areas a ON a.id = c.area_id
         WHERE u.status = ?
         GROUP BY u.camera_id
         ORDER BY segments DESC`,
        [...dates.params, filters.status || 'ok'],
    );
    return {
        total: totals.total || 0,
        playable,
        bytes: totals.bytes || 0,
        // snake_case for the camera's own fields on purpose: these ARE camera rows, and the shared
        // picker + its matching helpers read `area_name` / `thumbnail_path` like everywhere else.
        // Thumbnails are sanitized so a camera whose file has been swept renders its fallback icon
        // rather than a broken image.
        cameras: sanitizeCameraThumbnailList(cameras.map((row) => ({
            id: row.camera_id,
            name: row.camera_name,
            segments: row.segments,
            location: row.location || null,
            area_name: row.area_name || null,
            thumbnail_path: row.thumbnail_path || null,
            thumbnail_updated_at: row.thumbnail_updated_at || null,
            external_snapshot_url: row.external_snapshot_url || null,
        }))),
    };
}

/*
 * LEFT JOIN ke recording_segments: barisnya HILANG begitu segmen dipangkas dari disk lokal, jadi
 * `local_path` yang terisi adalah bukti bahwa rekaman aslinya masih ada di sini.
 *
 * Terukur di produksi 2026-08-28: 476 dari 54.621 arsip masih punya barisnya (retensi lokal ~12
 * jam lawan 32 hari di Telegram). Sedikit, tapi justru itu yang paling sering diminta - operator
 * memeriksa kejadian yang BARU terjadi - dan untuk yang itu Telegram tidak perlu disentuh sama
 * sekali.
 */
export function getUpload(segmentId) {
    const row = queryOne(
        `SELECT u.segment_id, u.camera_id, u.filename, u.file_size, u.file_id, u.recorded_at,
                s.file_path AS local_path
         FROM telegram_archive_uploads u
         LEFT JOIN recording_segments s ON s.id = u.segment_id
         WHERE u.segment_id = ?`,
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
 * Parse an HTTP Range header. Only the single-range form is supported, which is the only form a
 * <video> element ever sends.
 * @returns {{start: number, end: number}|null} null when absent or unusable
 */
export function parseRange(header, size) {
    if (!header || !size) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
    if (!match) return null;
    const [, rawStart, rawEnd] = match;
    let start;
    let end;
    if (rawStart === '') {
        // Suffix form ("bytes=-500"): the LAST n bytes. Players use it to read the moov atom of a
        // file whose index sits at the end.
        const suffix = Number(rawEnd);
        if (!suffix) return null;
        start = Math.max(size - suffix, 0);
        end = size - 1;
    } else {
        start = Number(rawStart);
        end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
    return { start, end };
}

/**
 * Resolve a stored file_id to a readable stream.
 *
 * `range` is what makes the player seekable. Without it the endpoint could only ever hand back the
 * whole file from byte zero, so dragging the scrubber or skipping 10 seconds did nothing — the
 * browser has no way to ask for the middle of a file unless the server answers 206.
 *
 * @param {{start:number,end:number}|null} [range]
 * @returns {Promise<{stream, size: number, filename: string, range: object|null, totalSize: number}>}
 */
/**
 * Path rekaman asli di disk ini, kalau memang masih ada. Null berarti "harus lewat Telegram".
 *
 * Dipisah supaya rute bisa memutuskan MENYERAHKAN pengiriman ke nginx tanpa pernah membuka
 * stream yang mungkin tidak jadi dipakai - fd yang dibuka lalu ditinggalkan adalah kebocoran.
 *
 * @returns {{path: string, size: number, filename: string}|null}
 */
export function localSegmentFile(segmentId) {
    const row = getUpload(segmentId);
    if (!row.local_path) return null;
    try {
        const stat = fs.statSync(row.local_path);
        if (!stat.isFile()) return null;
        return { path: row.local_path, size: stat.size, filename: row.filename };
    } catch {
        // Barisnya ada tapi berkasnya sudah tidak - pemangkas berjalan di antara dua langkah ini.
        return null;
    }
}

/*
 * PREFETCH CACHE — pemutaran kedua dan seterusnya dibaca dari disk.
 *
 * MTProto memotong irisan byte per request: tiap <video> open dan tiap seek adalah perjalanan baru
 * ke DC Telegram (terukur di prod: TTFB ~28s, seek ~9s pada box yang jenuh). Begitu sebuah segmen
 * dimainkan sekali, salinan utuhnya ditarik di latar ke dir transit yang sudah di-manage
 * archiveCacheService (pin saat dibaca, write-grace saat ditulis, TTL/kapasitas untuk evict) —
 * request berikutnya untuk segmen yang sama dilayani disk lokal, byte-exact dan instan.
 *
 * Salinan itu ditarik LEWAT BOT API, bukan sidecar: sidecar hanya punya satu client Pyrogram, jadi
 * unduhan penuh di sana mengantrekan semua irisan live (seek -> 504, terukur). getFile Bot API
 * berjalan di daemon C++ terpisah dan hasilnya di-hardlink — konkurensi native, nol byte disalin.
 *
 * Nama file deterministik supaya proses restart tetap menemukan hasil prefetch tanpa state apa pun.
 */
// Nama sengaja NETRAL transportasi: prefetch lewat Bot API, bukan MTProto — prefix lama yang
// menyebut sidecar adalah jebakan dokumentasi (prefetch via sidecar mengantrekan irisan live).
const PREFETCH_FILE_PREFIX = 'rafnet-arch-seg-';
const prefetchInFlight = new Set();

function prefetchedPathFor(segmentId) {
    return path.join(archiveCache.CACHE_DIR, `${PREFETCH_FILE_PREFIX}${segmentId}.mp4`);
}

/**
 * Sajikan irisan byte dari berkas utuh di disk lokal. Dipakai oleh tiga jalur: rekaman asli yang
 * masih ada, hasil prefetch MTProto, dan berkas yang dimaterialisasi Bot API — ketiganya identik.
 * Berkas di dalam CACHE_DIR di-pin selama stream hidup supaya sweep tidak menariknya dari bawah
 * penonton; di luar dir itu pin tidak diperlukan (rekaman asli tidak di-manage archiveCache).
 */
function streamSliceFromDisk(absPath, filename, totalSize, range) {
    const wanted = range && range.end < totalSize ? range : (range ? { start: range.start, end: totalSize - 1 } : null);
    const stream = wanted
        ? fs.createReadStream(absPath, { start: wanted.start, end: wanted.end })
        : fs.createReadStream(absPath);
    if (absPath.startsWith(archiveCache.CACHE_DIR)) {
        archiveCache.pin(absPath);
        let done = false;
        const unpin = () => {
            if (done) return;
            done = true;
            archiveCache.release(absPath);
        };
        stream.once('close', unpin);
        stream.once('end', unpin);
        stream.once('error', unpin);
    }
    return {
        stream,
        size: wanted ? wanted.end - wanted.start + 1 : totalSize,
        filename,
        range: wanted,
        totalSize,
    };
}

/**
 * Tarik SELURUH segmen di latar lewat Bot API (bukan MTProto), lalu atomically rename ke nama
 * finalnya. Yang memanggil tidak menunggu — request yang sedang berjalan sudah dilayani irisan
 * live-nya. Gagal di mana pun hanya berarti cache tidak terisi: permintaan berikutnya tetap
 * lewat jalur biasa. `.part` melindungi pembaca dari file setengah jadi, dan kalau ditinggal
 * mati pun disapu sweep lewat write-grace — tidak ada state yang perlu dibersihkan tangan.
 *
 * KENAPA BOT API, BUKAN SIDECAR MTPROTO
 * Prefetch adalah unduhan penuh ~150 MB. Kalau ia lewat sidecar yang sama dengan irisan live,
 * seluruh unduhan itu berbagi SATU client Pyrogram — seek yang datang selama prefetch berjalan
 * antre di belakangnya sampai 60+ detik (terukur di prod: 504 saat seek menit 5). Daemon Bot API
 * (telegram-bot-api, proses C++ terpisah) punya konkurensi native, dan getFile-nya malah
 * me-materialisasi berkas ke storage bersama — cukup di-hardlink (nol byte disalin) ke nama
 * cache kita. Sidecar tetap menganggur untuk irisan live: itulah pembagian kerja yang benar,
 * MTProto untuk range parsial, Bot API untuk salinan utuh.
 */
const PREFETCH_MAX_CONCURRENT = 2;

function prefetchWholeSegment(segmentId, fileId, fileSize) {
    // Tanpa file_id tidak ada yang bisa ditarik; tanpa file_size kita tidak bisa menghitung
    // kebutuhan disk — transit dir ini berbagi box yang sudah 82% penuh. Konkurensi dibatasi:
    // setiap prefetch adalah unduhan penuh, dan yang terlewat dicoba lagi oleh request berikutnya.
    if (!fileId || !fileSize || prefetchInFlight.size >= PREFETCH_MAX_CONCURRENT || prefetchInFlight.has(segmentId)) {
        return;
    }
    prefetchInFlight.add(segmentId);
    const tmpPath = path.join(archiveCache.CACHE_DIR, `${PREFETCH_FILE_PREFIX}${segmentId}.part`);
    (async () => {
        try {
            // makeRoom SEBELUM menarik — aturan transit dir yang sama seperti jalur live Bot API:
            // sebuah fetch tidak boleh jadi penyebab evict, dan tidak boleh menjatuhkan disk di
            // bawah floor.
            if (fileSize) archiveCache.makeRoom(fileSize);
            const { apiBase, token } = telegramConfig();
            if (!token) return;
            // getFile di server --local MEMBLOKIR sampai berkas utuh mendarat di storage-nya —
            // persis alasan ia terlarang di jalur live, dan persis yang dibutuhkan di latar.
            // Batasi umurnya: fetch yang menggantung akan mengunci slot in-flight selamanya.
            const gf = await fetch(`${apiBase}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, {
                signal: AbortSignal.timeout(10 * 60 * 1000),
            });
            const body = await gf.json().catch(() => ({}));
            const filePath = body?.result?.file_path;
            if (!filePath) return;

            const expected = Number(body?.result?.file_size) || fileSize;
            const isLocal = filePath.startsWith('/') || /^[A-Za-z]:[\/]/.test(filePath);
            let linked = false;
            if (isLocal && fs.existsSync(filePath)) {
                try {
                    // Hardlink: satu inode dua nama — nol byte disalin. Nama milik bot-api tetap
                    // punya dia; kalau GC-nya menghapus nama itu, data bertahan lewat nama kita.
                    fs.linkSync(filePath, tmpPath);
                    linked = true;
                } catch {
                    // Beda filesystem (EXDEV), izin, atau berkas lenyap berpacu dengan GC —
                    // lanjut ke unduhan biasa di bawah.
                }
            }
            if (!linked) {
                const relative = isLocal
                    ? filePath.replace(/^.*\/var\/lib\/telegram-bot-api\//, '')
                    : filePath;
                const dl = await fetch(`${apiBase}/file/bot${token}/${relative}`, {
                    signal: AbortSignal.timeout(10 * 60 * 1000),
                });
                if (!dl.ok || !dl.body) return;
                await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(tmpPath));
            }
            // Verifikasi byte-exact SEBELUM rename: berkas setengah jadi atau objek salah yang
            // masuk cache akan membohongi Content-Length semua pemutaran berikutnya. Mismatch =
            // batalkan; jalur live tidak terpengaruh.
            if (!expected || fs.statSync(tmpPath).size !== expected) {
                fs.unlinkSync(tmpPath);
                return;
            }
            fs.renameSync(tmpPath, prefetchedPathFor(segmentId));
        } catch (err) {
            console.warn(`[arsip] prefetch segmen ${segmentId} gagal: ${err.message}`);
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* sweep membersihkan */ }
        } finally {
            prefetchInFlight.delete(segmentId);
        }
    })();
}

export async function openSegmentStream(segmentId, range = null) {
    const row = getUpload(segmentId);

    /*
     * Rekaman aslinya masih di disk: sajikan langsung.
     *
     * Sebelumnya jalur ini TETAP memanggil getFile lebih dulu, dan getFile inilah yang menyuruh
     * server Bot API mengunduh. Untuk berkas yang masih ada ia memang hanya menunjuk balik ke
     * folder rekaman kita sendiri, jadi tidak ada byte yang tertarik - tapi ia tetap satu
     * perjalanan bolak-balik yang tidak diperlukan, dan ia menggantungkan pemutaran rekaman yang
     * ADA DI SINI pada sebuah layanan luar yang bisa sedang mati.
     */
    const lokal = row.local_path ? localSegmentFile(segmentId) : null;
    if (lokal) {
        return streamSliceFromDisk(lokal.path, lokal.filename, lokal.size, range);
    }

    if (!row.file_id) {
        // Segments uploaded before the sidecar recorded file_id cannot be fetched back: Telegram
        // offers no way to ask for the file_id of an already-sent message.
        const err = new Error('Segmen ini terarsip sebelum file_id dicatat, jadi tidak bisa diputar dari web');
        err.statusCode = 409;
        throw err;
    }

    // Segmen ini pernah dimainkan dan salinannya sudah mendarat utuh di transit dir — irisan
    // dibaca dari disk, tanpa perjalanan ke Telegram sama sekali. Nama deterministik, jadi state
    // ini juga selamat dari restart proses.
    const prefetched = prefetchedPathFor(segmentId);
    try {
        if (fs.existsSync(prefetched)) {
            const size = row.file_size || fs.statSync(prefetched).size;
            // Berkas aneh (0 byte, ukuran tak tercatat) lebih baik jatuh ke jalur hidup daripada
            // menyajikan Content-Length yang mustahil — sweep akan membersihkannya nanti.
            if (size > 0) {
                return streamSliceFromDisk(prefetched, row.filename, size, range);
            }
        }
    } catch {
        // Hilang di antara existsSync dan statSync (sweep berpacu) — lanjut ke jalur hidup.
    }

    /*
     * JALUR MTPROTO — unduh SEBAGIAN, bukan seluruh 238 MB.
     *
     * Bot API getFile (di bawah) tidak punya Range: ia memateriaisasi seluruh berkas sebelum satu
     * byte sampai ke penonton, bahkan untuk lompatan 2 detik. Service Python di sebelah sidecar
     * (login sebagai BOT, token yang sudah ada - bukan akun) memakai MTProto upload.getFile yang
     * PUNYA offset/limit, lalu memotong tepat byte yang diminta. Terbukti byte-exact terhadap
     * salinan disk, dan bekerja pada segmen tertua (32 hari) maupun terbaru.
     *
     * Digerbang env TG_ARCHIVE_MTPROTO_URL. Kalau service mati atau menolak, JATUH ke Bot API di
     * bawah - jadi menyalakannya tidak pernah bisa membuat arsip yang tadinya bisa diputar jadi
     * tidak bisa. Service hanya mendengar di 127.0.0.1; otorisasi admin tetap di Node.
     */
    const mtprotoUrl = process.env.TG_ARCHIVE_MTPROTO_URL;
    if (mtprotoUrl) {
        try {
            const wanted = range && row.file_size && range.end < row.file_size
                ? range
                : (range && row.file_size ? { start: range.start, end: row.file_size - 1 } : null);
            const resp = await fetch(`${mtprotoUrl.replace(/\/$/, '')}/segment/${segmentId}`, {
                headers: wanted ? { Range: `bytes=${wanted.start}-${wanted.end}` } : {},
            });
            if (resp.ok && resp.body) {
                // Irisan ini dilayani live; di latar kita tarik salinan utuhnya supaya seek dan
                // pemutaran berikutnya tidak membayar perjalanan Telegram lagi. Fire-and-forget —
                // dan sengaja LEWAT Bot API, bukan sidecar ini, supaya unduhan penuh tidak pernah
                // mengantrekan irisan live berikutnya (terukur: seek menit 5 -> 504).
                prefetchWholeSegment(segmentId, row.file_id, row.file_size);
                // Percayai Content-Range service sebagai kebenaran: ia yang benar-benar memotong.
                const cr = resp.headers.get('content-range');
                const m = cr && /bytes (\d+)-(\d+)\/(\d+)/.exec(cr);
                const totalSize = m ? Number(m[3]) : (row.file_size || 0);
                const clen = Number(resp.headers.get('content-length')) || 0;
                return {
                    stream: resp.body,
                    size: clen || totalSize,
                    filename: row.filename,
                    range: m ? { start: Number(m[1]), end: Number(m[2]) } : null,
                    totalSize,
                };
            }
            // Bukan 2xx: catat sekali, lalu jatuh ke Bot API - jangan gantung pemutaran.
            console.warn(`[arsip] MTProto menolak segmen ${segmentId} (${resp.status}), jatuh ke Bot API`);
        } catch (err) {
            console.warn(`[arsip] MTProto tidak terjangkau (${err.message}), jatuh ke Bot API`);
        }
    }

    const { apiBase, token } = telegramConfig();
    if (!token) {
        const err = new Error(`Token bot Telegram tidak ditemukan di ${ENV_FILE}`);
        err.statusCode = 503;
        throw err;
    }

    /*
     * Make room BEFORE getFile, because getFile is what makes the Bot API server download the
     * segment. Doing it afterwards would let a fresh 200 MB arrival evict itself — the classic way
     * a cache deletes exactly what was just asked for.
     *
     * Only when the recording is no longer on local disk: while it is, getFile just points back at
     * our own recordings folder and nothing is cached at all.
     */
    if (row.file_size) {
        archiveCache.makeRoom(row.file_size);
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
     */
    const wanted = range && range.end < size ? range : (range && size ? { start: range.start, end: size - 1 } : null);

    if (filePath.startsWith('/') || /^[A-Za-z]:[\/]/.test(filePath)) {
        if (fs.existsSync(filePath)) {
            // Slice on disk: the player gets exactly the bytes it asked for, and a seek costs one
            // short read instead of re-sending the whole segment.
            return streamSliceFromDisk(filePath, row.filename, size, range);
        }
        // Path is real but not visible from this process — ask the local server to serve it, and
        // pass the range along so seeking keeps working on that path too.
        const relative = filePath.replace(/^.*\/var\/lib\/telegram-bot-api\//, '');
        const viaHttp = await fetch(`${apiBase}/file/bot${token}/${relative}`, {
            headers: wanted ? { Range: `bytes=${wanted.start}-${wanted.end}` } : {},
        });
        if (viaHttp.ok && viaHttp.body) {
            // Only trust the slice length when the upstream actually honoured the Range (206). If it
            // ignored it and sent a 200 full body, `size` MUST be the whole file — otherwise the
            // route sets Content-Length to the slice length while piping the full body, and the
            // player reads slice-length bytes from byte 0 instead of from the seek offset (garbage).
            const served206 = viaHttp.status === 206;
            return {
                stream: viaHttp.body,
                size: served206 && wanted ? wanted.end - wanted.start + 1 : size,
                filename: row.filename,
                range: served206 ? wanted : null,
                totalSize: size,
            };
        }
        const err = new Error(
            `Berkas ada di server Bot API tapi tidak terbaca dari backend (${filePath}). `
            + 'Pastikan --dir server Bot API di-bind ke path host yang sama.',
        );
        err.statusCode = 502;
        throw err;
    }

    const download = await fetch(`${apiBase}/file/bot${token}/${filePath}`, {
        headers: wanted ? { Range: `bytes=${wanted.start}-${wanted.end}` } : {},
    });
    if (!download.ok || !download.body) {
        const err = new Error('Gagal mengunduh berkas dari Telegram');
        err.statusCode = 502;
        throw err;
    }
    // Same 206-vs-200 rule as the local-server branch above: a 200 full body must report the full
    // size, or a seek serves start-of-file bytes truncated to the slice length.
    const served206 = download.status === 206;
    return {
        stream: download.body,
        size: served206 && wanted ? wanted.end - wanted.start + 1 : size,
        filename: row.filename,
        range: served206 ? wanted : null,
        totalSize: size,
    };
}

function safeTargets(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// Routes import the DEFAULT, so anything they call has to be listed here — a named export alone
// is invisible to them and fails only at runtime, on the live page.
export default {
    listUploads, countUploads, locateUpload, getSummary, getUpload, openSegmentStream, parseRange,
    localSegmentFile,
};
