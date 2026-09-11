/*
Purpose: "Import from link" for Audio Broadcast — turn a direct media URL (works day-one, no new dep) or
         a YouTube link (via yt-dlp, if installed) into a stored clip. Extraction is slow (network +
         transcode), so it runs as a DURABLE ASYNC JOB off the request path (POST returns immediately).
Caller: audioController (create job, list jobs), audioBroadcastBootstrap (start the worker).
Deps: child_process (yt-dlp), global fetch, audioImportUrlPolicy (SSRF), audioClipService.finalizeClipFromFile.
MainFuncs: createImportJob, listJobs, processNextJob, startImportWorker, failForwardStuckJobs.
SideEffects: spawns yt-dlp / fetches external URLs to a temp file, then encodes via ffmpeg; writes audio_import_jobs.

Safety (box sits on the camera subnet): every URL + every redirect hop is re-validated by
audioImportUrlPolicy (rejects RFC1918/loopback/link-local/metadata, https-only). Duration is capped by a
metadata probe BEFORE download AND by ffmpeg -t/-fs in finalizeClipFromFile. Download bytes are capped.
Concurrency is 1 (serial) on the primary worker — the weak box already runs ~20 recording ffmpeg.
*/

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { query, queryOne, execute } from '../database/connectionPool.js';
import { assertSafeImportUrl } from '../utils/audioImportUrlPolicy.js';
import { AUDIO_DIR, ensureAudioDir, MAX_CLIP_SECONDS, finalizeClipFromFile } from './audioClipService.js';
import { synthTtsToTemp } from './audioTtsService.js';

const execFileAsync = promisify(execFile);
const YTDLP = process.env.AUDIO_YTDLP_BIN || 'yt-dlp';
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;   // hard cap on the fetched source (before encode)
const FETCH_TIMEOUT_MS = 30000;
const YTDLP_TIMEOUT_MS = 180000;               // extraction can be slow
const MAX_REDIRECTS = 3;

let ytdlpChecked = false;
let ytdlpOk = false;

/** Cached one-shot check whether yt-dlp is installed (YouTube path needs it; direct-URL path does not). */
export async function ytdlpAvailable() {
    if (ytdlpChecked) return ytdlpOk;
    ytdlpChecked = true;
    try { await execFileAsync(YTDLP, ['--version'], { timeout: 8000 }); ytdlpOk = true; }
    catch { ytdlpOk = false; }
    return ytdlpOk;
}

export function listJobs() {
    return query('SELECT id, source_url, source_kind, requested_name, status, clip_id, title, duration_sec, error, created_at, finished_at, tts_text, tts_provider, tts_voice FROM audio_import_jobs ORDER BY id DESC LIMIT 50');
}

/** Validate + enqueue an import. Returns the queued job. YouTube requires yt-dlp; direct URLs never do. */
export async function createImportJob({ url, name, userId = null }) {
    const { url: safe, kind } = await assertSafeImportUrl(url);
    if (kind === 'youtube' && !(await ytdlpAvailable())) {
        const e = new Error('Impor YouTube belum tersedia (yt-dlp belum terpasang di server). Gunakan URL berkas audio langsung.');
        e.statusCode = 501; throw e;
    }
    // Read back by the INSERT's own lastInsertRowid — `last_insert_rowid()` via queryOne routes to a
    // readonly pool connection where it returns 0 (never inserted) → the row comes back undefined.
    const info = execute('INSERT INTO audio_import_jobs (source_url, source_kind, requested_name, status, created_by) VALUES (?, ?, ?, ?, ?)',
        [safe, kind, String(name || '').trim().slice(0, 120) || null, 'queued', userId]);
    return queryOne('SELECT * FROM audio_import_jobs WHERE id = ?', [info.lastInsertRowid]);
}

/* -------------------------------------------------------------------- fetchers */

// Files created by a job share this prefix so cleanup can remove whatever extension yt-dlp appended.
function cleanupPrefix(prefix) {
    try {
        for (const f of readdirSync(AUDIO_DIR)) {
            if (f.startsWith(prefix)) { try { unlinkSync(join(AUDIO_DIR, f)); } catch { /* gone */ } }
        }
    } catch { /* dir gone */ }
}

async function fetchUrlToTemp(url, outPath) {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const { url: safe } = await assertSafeImportUrl(current); // re-validate EVERY hop (redirect SSRF)
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(safe, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            current = new URL(res.headers.get('location'), safe).toString();
            continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const len = parseInt(res.headers.get('content-length') || '0', 10);
        if (len && len > MAX_DOWNLOAD_BYTES) throw new Error('Berkas terlalu besar');
        // Stream with a hard byte ceiling. res.arrayBuffer() would buffer the WHOLE body FIRST, so a source
        // with an absent/lying Content-Length could OOM the weak box before the post-hoc size check ran.
        // Count as we read and abort the instant we cross the cap.
        const chunks = [];
        let total = 0;
        if (res.body) {
            for await (const chunk of res.body) {
                total += chunk.length;
                if (total > MAX_DOWNLOAD_BYTES) throw new Error('Berkas terlalu besar');
                chunks.push(Buffer.from(chunk));
            }
        }
        const buf = Buffer.concat(chunks);
        writeFileSync(outPath, buf);
        return { path: outPath, bytes: buf.length };
    }
    throw new Error('Terlalu banyak redirect');
}

async function fetchYoutubeToTemp(url, prefix) {
    // Stage 1: metadata only — reject live / over-long BEFORE spending bandwidth.
    const { stdout } = await execFileAsync(YTDLP, ['-J', '--no-playlist', '--', url], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const meta = JSON.parse(stdout);
    if (meta.is_live) throw new Error('Siaran langsung tidak didukung');
    const dur = Number(meta.duration) || 0;
    if (dur > MAX_CLIP_SECONDS) throw new Error(`Durasi ${Math.round(dur / 60)} menit melebihi batas ${MAX_CLIP_SECONDS / 60} menit`);
    // Stage 2: download bestaudio. yt-dlp appends the real extension to -o, so we discover the file after.
    await execFileAsync(YTDLP, [
        '-f', 'bestaudio', '--no-playlist', '--no-cache-dir', '--max-filesize', String(MAX_DOWNLOAD_BYTES),
        '-o', join(AUDIO_DIR, `${prefix}.%(ext)s`), '--', url,
    ], { timeout: YTDLP_TIMEOUT_MS });
    const file = readdirSync(AUDIO_DIR).find((f) => f.startsWith(`${prefix}.`));
    if (!file) throw new Error('Unduhan yt-dlp tidak menghasilkan berkas');
    const path = join(AUDIO_DIR, file);
    let bytes = 0;
    try { bytes = statSync(path).size; } catch { /* keep 0 */ }
    return { path, bytes, title: String(meta.title || '').slice(0, 120) };
}

/* ---------------------------------------------------------------- job processor */

/** Claim + process ONE queued job (atomic claim so only one worker/tick runs it). Returns true if it ran. */
export async function processNextJob() {
    const job = queryOne("SELECT * FROM audio_import_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1");
    if (!job) return false;
    const claim = execute("UPDATE audio_import_jobs SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1 WHERE id = ? AND status = 'queued'", [job.id]);
    if (!claim || claim.changes !== 1) return false; // someone else claimed it

    ensureAudioDir();
    const prefix = `.import-${randomBytes(8).toString('hex')}`;
    try {
        let src;
        let title = job.requested_name;
        if (job.source_kind === 'youtube') {
            src = await fetchYoutubeToTemp(job.source_url, prefix);
            title = job.requested_name || src.title;
        } else if (job.source_kind === 'tts') {
            src = await synthTtsToTemp({ text: job.tts_text, engine: job.tts_provider, voice: job.tts_voice, prefix });
            title = job.requested_name || (job.tts_text || '').slice(0, 60);
        } else {
            src = await fetchUrlToTemp(job.source_url, join(AUDIO_DIR, prefix));
        }
        const clip = await finalizeClipFromFile({
            name: title, tempPath: src.path, sourceBytes: src.bytes || 0, sourceType: job.source_kind,
            sourceUrl: job.source_kind === 'tts' ? null : job.source_url, sourceTitle: title, userId: job.created_by,
        });
        execute("UPDATE audio_import_jobs SET status = 'ready', clip_id = ?, title = ?, duration_sec = ?, finished_at = datetime('now'), error = NULL WHERE id = ?",
            [clip.id, clip.name, clip.duration_sec, job.id]);
        console.log(`[AudioImport] Job ${job.id} (${job.source_kind}) -> clip ${clip.id} "${clip.name}"`);
    } catch (error) {
        const msg = (error.statusCode ? error.message : (error.message || 'gagal')).slice(0, 300);
        execute("UPDATE audio_import_jobs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?", [msg, job.id]);
        console.error(`[AudioImport] Job ${job.id} failed: ${msg}`);
    } finally {
        cleanupPrefix(prefix); // removes the temp download whatever extension yt-dlp gave it
    }
    return true;
}

/** On boot, any job stuck 'processing' (killed mid-run) is failed forward — the primary worker restarts clean. */
export function failForwardStuckJobs() {
    const r = execute("UPDATE audio_import_jobs SET status = 'failed', error = 'terputus saat restart', finished_at = datetime('now') WHERE status = 'processing'");
    if (r && r.changes > 0) console.log(`[AudioImport] Fail-forwarded ${r.changes} stuck job(s) on boot`);
}

export function startImportWorker() {
    failForwardStuckJobs();
    // Serial invariant: yt-dlp/ffmpeg can each run for minutes, far longer than the 5s tick. Without this
    // guard a new tick would SELECT the NEXT queued job (the running one is already 'processing') and run it
    // concurrently — melting the weak box that already carries ~20 recording ffmpeg. Skip the tick while busy.
    let busy = false;
    const t = setInterval(() => {
        if (busy) return;
        busy = true;
        processNextJob()
            .catch((e) => console.error('[AudioImport] Worker tick error:', e.message))
            .finally(() => { busy = false; });
    }, 5000);
    if (t.unref) t.unref();
    console.log('[AudioImport] Import worker started (5s tick, serial, primary worker)');
    return t;
}

export default { ytdlpAvailable, listJobs, createImportJob, processNextJob, failForwardStuckJobs, startImportWorker };
