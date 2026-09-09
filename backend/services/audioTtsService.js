/*
Purpose: Text-to-Speech for Audio Broadcast — synthesize typed text into a spoken audio file using a
         NATURAL neural voice (not robotic espeak). Pluggable engines: 'piper' (offline neural, default)
         and 'edge' (Microsoft Edge neural voices via edge-tts — free, natural, needs internet). The WAV/
         MP3 it produces is handed to audioClipService.finalizeClipFromFile (encode-once to .ulaw).
Caller: audioImportService (the 'tts' job branch), audioController (create job, list engines/voices).
Deps: child_process, fs, audioClipService (AUDIO_DIR), connectionPool.
MainFuncs: synthTtsToTemp, createTtsJob, listTtsEngines, ttsEngineAvailable.
SideEffects: spawns piper / edge-tts (short-lived) writing a temp file under data/audio; writes a queued row.

Engines are swappable by env (AUDIO_PIPER_BIN/MODEL, AUDIO_EDGE_TTS_BIN) so a better voice/model can be
dropped in without code change. A requested engine that isn't installed fails cleanly (501), never crashes.
Text is admin-authored; it is length-capped + whitespace-normalised, and passed to piper via STDIN and to
edge-tts via argv (execFile, no shell — no injection).
*/

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { queryOne, execute } from '../database/connectionPool.js';
import { AUDIO_DIR, ensureAudioDir } from './audioClipService.js';

const execFileAsync = promisify(execFile);

const PIPER_BIN = process.env.AUDIO_PIPER_BIN || '/opt/piper/piper/piper';
const PIPER_MODEL_DIR = process.env.AUDIO_PIPER_MODEL_DIR || '/opt/piper/models';
const EDGE_BIN = process.env.AUDIO_EDGE_TTS_BIN || 'edge-tts';
const TTS_TIMEOUT_MS = 120000;             // piper on the weak box can be slow-ish; edge is network-bound
export const MAX_TTS_CHARS = 1500;         // ~1.5 min of speech — a long announcement fits

// Voice catalog. piper voice == an .onnx model on disk; edge voice == a Microsoft neural voice id.
const ENGINES = {
    piper: {
        label: 'Piper (offline, neural)',
        online: false,
        voices: [
            { id: 'id_ID-news_tts-medium', label: 'Berita — natural (offline)', model: process.env.AUDIO_PIPER_MODEL || join(PIPER_MODEL_DIR, 'id_ID-news_tts-medium.onnx') },
        ],
    },
    edge: {
        label: 'Edge Neural (cloud, gratis)',
        online: true,
        voices: [
            { id: 'id-ID-GadisNeural', label: 'Gadis — perempuan (cloud, natural)' },
            { id: 'id-ID-ArdiNeural', label: 'Ardi — laki-laki (cloud, natural)' },
        ],
    },
};

const availability = new Map(); // engine -> boolean (cached)

/** Whether an engine is installed/usable. Cached; pass force=true to re-check (e.g. after install). */
export async function ttsEngineAvailable(engine, force = false) {
    if (!ENGINES[engine]) return false;
    if (!force && availability.has(engine)) return availability.get(engine);
    let ok = false;
    try {
        if (engine === 'piper') {
            ok = existsSync(PIPER_BIN) && ENGINES.piper.voices.some((v) => v.model && existsSync(v.model));
        } else if (engine === 'edge') {
            await execFileAsync(EDGE_BIN, ['--help'], { timeout: 8000 });
            ok = true;
        }
    } catch { ok = false; }
    availability.set(engine, ok);
    return ok;
}

/** Engines + voices + availability for the admin UI. */
export async function listTtsEngines() {
    const out = [];
    for (const [id, e] of Object.entries(ENGINES)) {
        // eslint-disable-next-line no-await-in-loop
        const available = await ttsEngineAvailable(id);
        out.push({ id, label: e.label, online: e.online, available, voices: e.voices.map((v) => ({ id: v.id, label: v.label })) });
    }
    return out;
}

function resolveVoice(engine, voiceId) {
    const e = ENGINES[engine];
    if (!e) return null;
    return e.voices.find((v) => v.id === voiceId) || e.voices[0] || null;
}

// Make written PA text SPEAK naturally (piper/edge read symbols literally otherwise):
//  - drop any unfilled {placeholder} so it is never read aloud as "nama" (belt-and-suspenders; the fill-in
//    UI already substitutes them),
//  - "/" -> " atau " ("Bapak/Ibu" -> "Bapak atau Ibu"; "RT/RW" -> "RT atau RW"),
//  - "&" -> " dan ".
export function normalizeForSpeech(s) {
    return String(s || '')
        .replace(/\{[^{}]*\}/g, ' ')
        .replace(/\s*\/\s*/g, ' atau ')
        .replace(/\s*&\s*/g, ' dan ');
}

function cleanText(text) {
    // Normalise for speech, then collapse whitespace (also flattens any stray control char) + trim.
    const t = normalizeForSpeech(text).replace(/\s+/g, ' ').trim();
    if (!t) { const err = new Error('Teks wajib diisi'); err.statusCode = 400; throw err; }
    if (t.length > MAX_TTS_CHARS) { const err = new Error(`Teks melebihi ${MAX_TTS_CHARS} karakter`); err.statusCode = 400; throw err; }
    return t;
}

function runPiper(text, model, outPath) {
    return new Promise((resolve, reject) => {
        const child = spawn(PIPER_BIN, ['-m', model, '-f', outPath], {
            timeout: TTS_TIMEOUT_MS,
            env: { ...process.env, LD_LIBRARY_PATH: `${dirname(PIPER_BIN)}:${process.env.LD_LIBRARY_PATH || ''}` },
        });
        let err = '';
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(err.trim().split('\n').pop() || `piper keluar kode ${code}`));
        });
        try { child.stdin.write(text); child.stdin.end(); } catch (e) { reject(e); }
    });
}

/**
 * Synthesize text to a temp audio file (WAV for piper, MP3 for edge) under AUDIO_DIR/<prefix>.<ext>.
 * The CALLER owns the file (finalizeClipFromFile encodes it, cleanupPrefix removes it).
 * @returns {Promise<{path:string, bytes:number}>}
 */
export async function synthTtsToTemp({ text, engine = 'piper', voice, prefix }) {
    const clean = cleanText(text);
    if (!ENGINES[engine]) { const e = new Error('Mesin TTS tidak dikenal'); e.statusCode = 400; throw e; }
    if (!(await ttsEngineAvailable(engine))) {
        const e = new Error(engine === 'piper'
            ? 'TTS Piper belum terpasang di server.'
            : 'TTS Edge (edge-tts) belum terpasang di server.');
        e.statusCode = 501; throw e;
    }
    const v = resolveVoice(engine, voice);
    if (!v) { const e = new Error('Suara tidak valid'); e.statusCode = 400; throw e; }

    ensureAudioDir();
    if (engine === 'piper') {
        const outPath = join(AUDIO_DIR, `${prefix}.wav`);
        await runPiper(clean, v.model, outPath);
        if (!existsSync(outPath) || statSync(outPath).size === 0) throw new Error('piper tidak menghasilkan audio');
        return { path: outPath, bytes: statSync(outPath).size };
    }
    // edge
    const outPath = join(AUDIO_DIR, `${prefix}.mp3`);
    await execFileAsync(EDGE_BIN, ['--voice', v.id, '--text', clean, '--write-media', outPath], { timeout: TTS_TIMEOUT_MS });
    if (!existsSync(outPath) || statSync(outPath).size === 0) throw new Error('edge-tts tidak menghasilkan audio');
    return { path: outPath, bytes: statSync(outPath).size };
}

/** Validate + enqueue a TTS job (processed by audioImportService's worker). Returns the queued job. */
export async function createTtsJob({ text, engine = 'piper', voice, name, userId = null }) {
    const clean = cleanText(text);
    if (!ENGINES[engine]) { const e = new Error('Mesin TTS tidak dikenal'); e.statusCode = 400; throw e; }
    if (!(await ttsEngineAvailable(engine))) {
        const e = new Error(engine === 'piper' ? 'TTS Piper belum terpasang di server.' : 'TTS Edge belum terpasang di server.');
        e.statusCode = 501; throw e;
    }
    const v = resolveVoice(engine, voice);
    if (!v) { const e = new Error('Suara tidak valid'); e.statusCode = 400; throw e; }
    execute(
        `INSERT INTO audio_import_jobs (source_url, source_kind, requested_name, status, created_by, tts_text, tts_provider, tts_voice)
         VALUES ('tts', 'tts', ?, 'queued', ?, ?, ?, ?)`,
        [String(name || '').trim().slice(0, 120) || null, userId, clean, engine, v.id],
    );
    return queryOne('SELECT * FROM audio_import_jobs WHERE id = last_insert_rowid()');
}

export default { synthTtsToTemp, createTtsJob, listTtsEngines, ttsEngineAvailable, MAX_TTS_CHARS };
