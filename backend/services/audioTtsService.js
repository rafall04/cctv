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
import { existsSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { queryOne, execute } from '../database/connectionPool.js';
import { AUDIO_DIR, ensureAudioDir } from './audioClipService.js';

const execFileAsync = promisify(execFile);

const PIPER_BIN = process.env.AUDIO_PIPER_BIN || '/opt/piper/piper/piper';
const PIPER_MODEL_DIR = process.env.AUDIO_PIPER_MODEL_DIR || '/opt/piper/models';
const EDGE_BIN = process.env.AUDIO_EDGE_TTS_BIN || 'edge-tts';
// Gemini TTS (Google AI Studio, free tier): natural + steerable via a style directive. Key from env
// (never hard-coded); clip is generated ONCE in the cloud then stored + played offline. Model is a free
// Flash TTS preview (the Pro TTS is not free) — pin it so a deprecation doesn't silently change behaviour.
const GEMINI_KEY_ENV = process.env.AUDIO_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.AUDIO_GEMINI_MODEL || 'gemini-2.5-flash-preview-tts';

// The Gemini key can come from the admin UI (audio_tts_config, so an operator need not touch .env over
// SSH) or from env as a fallback. Read fresh each time so a key saved in the UI takes effect immediately.
function getGeminiKey() {
    try {
        const row = queryOne('SELECT gemini_api_key FROM audio_tts_config WHERE id = 1');
        const k = row && row.gemini_api_key ? String(row.gemini_api_key).trim() : '';
        if (k) return k;
    } catch { /* table may not exist yet (pre-migration) */ }
    return GEMINI_KEY_ENV;
}
// Style directive prepended to the text: pushes delivery toward a warm, conversational tone (away from the
// "news reader" feel of piper/edge). Phrased as an instruction + colon so the model steers, not reads it.
const GEMINI_STYLE = process.env.AUDIO_GEMINI_STYLE
    || 'Ucapkan dengan nada hangat, santai, dan ramah seperti pengurus kampung menyampaikan pengumuman kepada warga, bukan seperti pembaca berita:';
const TTS_TIMEOUT_MS = 120000;             // piper on the weak box can be slow-ish; edge/gemini are network-bound
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
    gemini: {
        label: 'Gemini (cloud gratis, paling natural)',
        online: true,
        // Google's 30 prebuilt voices are multilingual (auto-detect Indonesian). A curated, tone-labelled
        // subset — warm/casual for announcements, firm for urgent. All steered by GEMINI_STYLE at synth.
        voices: [
            { id: 'Sulafat', label: 'Sulafat — hangat (perempuan)' },
            { id: 'Callirrhoe', label: 'Callirrhoe — santai (perempuan)' },
            { id: 'Vindemiatrix', label: 'Vindemiatrix — lembut (perempuan)' },
            { id: 'Aoede', label: 'Aoede — ringan (perempuan)' },
            { id: 'Kore', label: 'Kore — tegas (perempuan)' },
            { id: 'Zubenelgenubi', label: 'Zubenelgenubi — santai/ngobrol (laki-laki)' },
            { id: 'Achird', label: 'Achird — ramah (laki-laki)' },
            { id: 'Charon', label: 'Charon — informatif (laki-laki)' },
            { id: 'Orus', label: 'Orus — tegas (laki-laki)' },
            { id: 'Puck', label: 'Puck — ceria (laki-laki)' },
        ],
    },
    edge: {
        label: 'Edge Neural (cloud, gratis)',
        online: true,
        // Microsoft only ships two id-ID neural voices (Gadis/Ardi). We widen the choice with prosody
        // presets (rate/pitch) so an operator can pick a warmer/softer or a firmer/deeper read — the
        // biggest lever against "sounds like a robot" short of a paid voice. `base` is the real Edge
        // voice; rate/pitch are passed to edge-tts. Plain ids stay unchanged so old clips still resolve.
        voices: [
            { id: 'id-ID-GadisNeural', label: 'Gadis — perempuan, natural' },
            { id: 'id-ID-GadisNeural-lembut', base: 'id-ID-GadisNeural', rate: '-8%', pitch: '+2Hz', label: 'Gadis — perempuan, lembut & hangat' },
            { id: 'id-ID-GadisNeural-ceria', base: 'id-ID-GadisNeural', rate: '+8%', pitch: '+6Hz', label: 'Gadis — perempuan, ceria & ringan' },
            { id: 'id-ID-ArdiNeural', label: 'Ardi — laki-laki, natural' },
            { id: 'id-ID-ArdiNeural-tegas', base: 'id-ID-ArdiNeural', rate: '+6%', label: 'Ardi — laki-laki, tegas (pengumuman)' },
            { id: 'id-ID-ArdiNeural-wibawa', base: 'id-ID-ArdiNeural', rate: '-7%', pitch: '-6Hz', label: 'Ardi — laki-laki, berwibawa & dalam' },
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
        } else if (engine === 'gemini') {
            ok = Boolean(getGeminiKey()); // key present = usable; a real request is only made on synth
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

// Prepend a 44-byte PCM WAV header to raw signed-16-bit little-endian mono PCM (what Gemini returns).
function pcmToWav(pcm, rate) {
    const dataSize = pcm.length;
    const h = Buffer.alloc(44);
    h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + dataSize, 4); h.write('WAVE', 8, 'ascii');
    h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write('data', 36, 'ascii'); h.writeUInt32LE(dataSize, 40);
    return Buffer.concat([h, pcm]);
}

// Call Gemini TTS (generateContent, AUDIO modality) → raw PCM16 + sample rate. Key in env only.
async function geminiSynth(text, voiceName) {
    const apiKey = getGeminiKey();
    if (!apiKey) { const e = new Error('Gemini belum terpasang (kunci API kosong).'); e.statusCode = 501; throw e; }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const body = {
        contents: [{ parts: [{ text: `${GEMINI_STYLE}\n\n${text}` }] }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
    };
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
        });
    } catch (e) { const err = new Error(`Gemini tak terjangkau: ${e.message}`); err.statusCode = 502; throw err; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(`Gemini: ${json?.error?.message || `HTTP ${res.status}`}`);
        err.statusCode = res.status === 429 ? 429 : 502; throw err;
    }
    const part = (json?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
    const b64 = part?.inlineData?.data;
    if (!b64) { const e = new Error('Gemini tak mengembalikan audio'); e.statusCode = 502; throw e; }
    const m = /rate=(\d+)/.exec(part.inlineData.mimeType || '');
    const rate = m ? parseInt(m[1], 10) : 24000; // Gemini TTS default: 24kHz PCM16 mono
    return { pcm: Buffer.from(b64, 'base64'), rate };
}

/**
 * Synthesize text to a temp audio file (WAV for piper/gemini, MP3 for edge) under AUDIO_DIR/<prefix>.<ext>.
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
    if (engine === 'gemini') {
        const outPath = join(AUDIO_DIR, `${prefix}.wav`);
        const { pcm, rate } = await geminiSynth(clean, v.id);
        writeFileSync(outPath, pcmToWav(pcm, rate));
        if (!existsSync(outPath) || statSync(outPath).size === 0) throw new Error('Gemini tidak menghasilkan audio');
        return { path: outPath, bytes: statSync(outPath).size };
    }
    // edge — `base` is the real MS voice; rate/pitch presets widen the (only two) id-ID voices.
    // Use `--rate=…`/`--pitch=…` (single token) so a leading '-' isn't parsed as another flag.
    const outPath = join(AUDIO_DIR, `${prefix}.mp3`);
    const edgeArgs = ['--voice', v.base || v.id, '--text', clean, '--write-media', outPath];
    if (v.rate) edgeArgs.push(`--rate=${v.rate}`);
    if (v.pitch) edgeArgs.push(`--pitch=${v.pitch}`);
    await execFileAsync(EDGE_BIN, edgeArgs, { timeout: TTS_TIMEOUT_MS });
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
    // Read back by the INSERT's own lastInsertRowid — NOT `last_insert_rowid()` via queryOne, which
    // routes to a readonly pool connection where that function returns 0 (it never inserted) → undefined.
    const info = execute(
        `INSERT INTO audio_import_jobs (source_url, source_kind, requested_name, status, created_by, tts_text, tts_provider, tts_voice)
         VALUES ('tts', 'tts', ?, 'queued', ?, ?, ?, ?)`,
        [String(name || '').trim().slice(0, 120) || null, userId, clean, engine, v.id],
    );
    return queryOne('SELECT * FROM audio_import_jobs WHERE id = ?', [info.lastInsertRowid]);
}

/** Public status of cloud-TTS config (never returns the raw key). */
export function ttsConfigStatus() {
    const k = getGeminiKey();
    let source = 'none';
    try {
        const row = queryOne('SELECT gemini_api_key FROM audio_tts_config WHERE id = 1');
        if (row && row.gemini_api_key) source = 'ui'; else if (GEMINI_KEY_ENV) source = 'env';
    } catch { source = GEMINI_KEY_ENV ? 'env' : 'none'; }
    return {
        gemini_configured: Boolean(k),
        gemini_source: source, // 'ui' | 'env' | 'none'
        gemini_hint: k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '',
    };
}

/** Save the Gemini API key from the admin UI (server-side only; masked back via ttsConfigStatus). */
export function setTtsConfig({ geminiApiKey } = {}) {
    try {
        const has = queryOne('SELECT id FROM audio_tts_config WHERE id = 1');
        if (!has) execute('INSERT OR IGNORE INTO audio_tts_config (id) VALUES (1)');
    } catch { const e = new Error('Tabel konfigurasi TTS belum ada (jalankan migrasi).'); e.statusCode = 500; throw e; }
    if (geminiApiKey !== undefined) {
        const v = String(geminiApiKey || '').trim();
        execute("UPDATE audio_tts_config SET gemini_api_key = ?, updated_at = datetime('now') WHERE id = 1", [v || null]);
        availability.delete('gemini'); // re-evaluate availability next listing
    }
    return ttsConfigStatus();
}

export default { synthTtsToTemp, createTtsJob, listTtsEngines, ttsEngineAvailable, ttsConfigStatus, setTtsConfig, MAX_TTS_CHARS };
