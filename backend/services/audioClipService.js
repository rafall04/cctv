/*
Purpose: Store uploaded audio as a ready-to-stream G.711 clip (u-law 16kHz mono) for the Audio
         Broadcast feature — the format the camera speaker backchannel plays (see audio_cast.py).
Caller: audioController (upload/list/delete), audioCastService + audioScheduleService (resolve paths).
Deps: ffmpeg/ffprobe (already required elsewhere), connectionPool, data/audio storage.
MainFuncs: saveAudioClip, listClips, getClip, deleteClip, clipPath, ensureAudioDir, isSafeBase.
SideEffects: executes ffmpeg/ffprobe, writes/deletes data/audio/<base>.ulaw, writes audio_clips rows.

WHY G.711 u-law 16kHz mono, encoded AT UPLOAD
---------------------------------------------
The ONVIF backchannel on these cameras accepts PCMU/16000; encoding once at upload means every play
just streams the raw bytes (no per-play ffmpeg), which keeps this weak box unloaded during broadcasts.
The base filename is allowlisted before it ever reaches join(), the same defence promoImageService uses.
*/

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { query, queryOne, execute } from '../database/connectionPool.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export const AUDIO_DIR = join(__dirname, '..', 'data', 'audio');
export const MAX_AUDIO_UPLOAD_BYTES = 12 * 1024 * 1024; // 12MB source — a full song fits; we re-encode
// to G.711 anyway, so source bitrate above ~128kbps is wasted. Kept modest because the matching
// body-size allowance in inputSanitizer.js runs BEFORE route auth (see the note there).
const FFMPEG_TIMEOUT_MS = 60000;
const SAFE_BASE_RE = /^clip-[a-z0-9]{6,40}$/;

// Magic-byte gate. ffmpeg re-encode is the real validator, but this rejects obvious non-audio before
// we ever hand bytes to ffmpeg. Covers the formats a phone/PC actually exports.
function detectAudioKind(buf) {
    if (buf.length < 12) return null;
    const ascii = (a, b) => buf.toString('ascii', a, b);
    if (ascii(0, 3) === 'ID3') return 'mp3';
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';        // MPEG frame sync
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
    if (ascii(4, 8) === 'ftyp') return 'm4a';                             // MP4/M4A/AAC container
    if (ascii(0, 4) === 'OggS') return 'ogg';
    if (ascii(0, 4) === 'fLaC') return 'flac';
    return null;
}

export function ensureAudioDir() {
    if (!existsSync(AUDIO_DIR)) {
        mkdirSync(AUDIO_DIR, { recursive: true });
        console.log('[Audio] Created audio directory:', AUDIO_DIR);
    }
    return AUDIO_DIR;
}

export function isSafeBase(base) {
    return typeof base === 'string' && SAFE_BASE_RE.test(base);
}

/** Absolute path to a clip's .ulaw, or null when the base fails the allowlist. */
export function clipPath(base) {
    return isSafeBase(base) ? join(AUDIO_DIR, `${base}.ulaw`) : null;
}

async function probeDuration(filePath) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
        ], { timeout: FFMPEG_TIMEOUT_MS });
        const d = parseFloat(String(stdout).trim());
        return Number.isFinite(d) && d > 0 ? d : 0;
    } catch {
        return 0;
    }
}

/**
 * Validate + encode an uploaded audio buffer to a streamable G.711 clip and record it.
 * @param {string} name display name
 * @param {Buffer} buffer raw decoded upload bytes
 * @param {number|null} userId
 * @returns {Promise<object>} the audio_clips row
 */
export async function saveAudioClip(name, buffer, userId = null) {
    const cleanName = String(name || '').trim().slice(0, 120) || 'Tanpa nama';
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        const err = new Error('Berkas audio kosong'); err.statusCode = 400; throw err;
    }
    if (buffer.length > MAX_AUDIO_UPLOAD_BYTES) {
        const err = new Error(`Ukuran audio melebihi ${Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024))}MB`);
        err.statusCode = 413; throw err;
    }
    const kind = detectAudioKind(buffer);
    if (!kind) {
        const err = new Error('Format tidak didukung. Gunakan MP3, WAV, M4A, OGG, atau FLAC.');
        err.statusCode = 400; throw err;
    }

    ensureAudioDir();
    const base = `clip-${randomBytes(8).toString('hex')}`;
    const tempPath = join(AUDIO_DIR, `.upload-${base}.${kind}`);
    const outPath = join(AUDIO_DIR, `${base}.ulaw`);

    try {
        writeFileSync(tempPath, buffer);
        const duration = await probeDuration(tempPath);
        // Encode to raw u-law 16kHz mono — exactly what audio_cast.py streams (PCMU/16000, PT=103).
        await execFileAsync('ffmpeg', [
            '-y', '-i', tempPath, '-vn', '-ar', '16000', '-ac', '1', '-f', 'mulaw', outPath,
        ], { timeout: FFMPEG_TIMEOUT_MS });
        if (!existsSync(outPath) || statSync(outPath).size === 0) {
            throw new Error('ffmpeg tidak menghasilkan audio');
        }

        execute(
            'INSERT INTO audio_clips (name, base_filename, duration_sec, source_bytes, created_by) VALUES (?, ?, ?, ?, ?)',
            [cleanName, base, duration, buffer.length, userId],
        );
        const row = queryOne('SELECT * FROM audio_clips WHERE base_filename = ?', [base]);
        console.log(`[Audio] Stored clip "${cleanName}" (${base}): ${kind} ${Math.round(buffer.length / 1024)}KB -> ${Math.round(statSync(outPath).size / 1024)}KB ulaw, ${duration.toFixed(1)}s`);
        return row;
    } catch (error) {
        try { unlinkSync(outPath); } catch { /* already gone */ }
        if (error.statusCode) throw error;
        console.error('[Audio] Encode failed:', error.message);
        const err = new Error('Gagal memproses audio'); err.statusCode = 500; throw err;
    } finally {
        try { unlinkSync(tempPath); } catch { /* never written / already gone */ }
    }
}

export function listClips() {
    return query('SELECT id, name, base_filename, duration_sec, source_bytes, created_at FROM audio_clips ORDER BY created_at DESC, id DESC');
}

export function getClip(id) {
    return queryOne('SELECT * FROM audio_clips WHERE id = ?', [parseInt(id, 10)]);
}

export function deleteClip(id) {
    const clip = getClip(id);
    if (!clip) { const err = new Error('Audio tidak ditemukan'); err.statusCode = 404; throw err; }
    execute('DELETE FROM audio_clips WHERE id = ?', [clip.id]);              // FKs cascade playlist items
    const p = clipPath(clip.base_filename);
    if (p) { try { unlinkSync(p); } catch { /* already gone */ } }
    return { deleted: clip.id };
}

export default {
    AUDIO_DIR, MAX_AUDIO_UPLOAD_BYTES, ensureAudioDir, isSafeBase, clipPath,
    saveAudioClip, listClips, getClip, deleteClip,
};
