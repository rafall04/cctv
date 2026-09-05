/**
 * Purpose: Read/write the per-camera settings consumed by the standalone motion-detection
 *          ("Ronda Digital") containers, plus derive each detector's liveness.
 * Caller: controllers/rondaAdminController.js.
 * Deps: node:fs, node:path only — the detectors are a separate stack, so there is no DB coupling.
 * MainFuncs: listCameras, getCamera, updateCamera.
 * SideEffects: reads/writes JSON under RONDA_CONFIG_DIR; reads each detector's status.json.
 *
 * The detectors poll their own JSON file (mtime-based) roughly every 15 s, so a write here takes
 * effect without restarting anything. Writes are atomic (tmp + rename) because the detector may be
 * reading the same file concurrently.
 */

import fs from 'fs';
import path from 'path';

const CONFIG_DIR = process.env.RONDA_CONFIG_DIR || '/opt/yolo-poc/config';
const LIVE_ROOT = process.env.RONDA_LIVE_ROOT || '/opt/yolo-poc';

// Only these keys may be written. Anything structural (RTSP URL, resolution, output dir) stays a
// deploy-time concern so a mistyped form can never point a detector at the wrong stream.
// Applied live by the detector (it re-reads this file every ~15 s).
const EDITABLE = new Set([
    'enabled',
    'stamp',
    'alert_hours',
    'tg_cooldown',
    'tg_cooldown_off',
    'chat_id',
    'min_area',
    'confirm_conf',
    'confirm_classes',
    'label',
    'area',
    'ignore',
    'roi',
]);

// Stored the same way, but only read when the container is (re)created — the UI flags these so the
// operator knows a restart is needed rather than wondering why nothing changed.
const STRUCTURAL = new Set(['proc_w', 'target_fps', 'crop_limit', 'retention_days', 'max_snaps']);

const HOURS_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;
const NAME_RE = /^[A-Za-z0-9_-]+$/;

// A detector rewrites status.json about once a second, but sending an alert uploads two photos to
// Telegram and blocks its loop for a few seconds, so allow a generous window before calling it dead.
const STALE_AFTER_MS = 90_000;

function fail(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function configPath(name) {
    if (!NAME_RE.test(name || '')) throw fail('Nama kamera tidak valid', 400);
    return path.join(CONFIG_DIR, `${name}.json`);
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

// Never let secrets reach the browser: the Telegram bot token is shared infrastructure, and the
// stream key is effectively the camera's private address (the same leak that was closed on the
// public landing payload). `source_url` is the strictest of the three — for an internal camera it
// is literally the RTSP URL, which must never reach the frontend under any circumstance. The UI
// needs none of them to do its job; `source_type` alone is enough to explain the camera.
function redact(config) {
    const {
        bot_token: _token, stream_key: _key, source_url: _sumber, ...safe
    } = config || {};
    return safe;
}

function statusOf(cfg) {
    const outDir = String(cfg?.out_dir || '');
    if (!outDir) return { online: false, ageSeconds: null, eventsToday: null, lastSeen: null };
    // Detector paths are container-side ("/work/..."); map them back onto the host.
    const file = path.join(outDir.replace(/^\/work/, LIVE_ROOT), 'status.json');
    try {
        const ageMs = Date.now() - fs.statSync(file).mtimeMs;
        const st = readJson(file) || {};
        return {
            online: ageMs < STALE_AFTER_MS,
            ageSeconds: Math.round(ageMs / 100) / 10,
            eventsToday: st.events_today ?? null,
            lastSeen: st.ts ?? null,
            // Detektor bisa hidup tapi tidak mendapat gambar sama sekali. Dibedakan supaya
            // panel tidak menampilkan lampu hijau untuk kamera yang sebenarnya buta.
            sourceOk: st.sumber_terbaca !== false,
            reconnects: st.sambung_ulang ?? null,
        };
    } catch {
        return {
            online: false, ageSeconds: null, eventsToday: null, lastSeen: null,
            sourceOk: null, reconnects: null,
        };
    }
}

function validateZones(value, label) {
    if (!Array.isArray(value)) throw fail(`${label} harus berupa daftar`, 400);
    value.forEach((entry) => {
        if (!Array.isArray(entry)) throw fail(`${label} berisi data yang bukan daftar`, 400);
        entry.forEach((n) => {
            if (!Number.isFinite(Number(n)) || Number(n) < 0 || Number(n) > 1) {
                throw fail(`${label} harus berisi angka 0 sampai 1 (proporsi lebar/tinggi gambar)`, 400);
            }
        });
    });
}

function validate(patch) {
    if (patch.ignore !== undefined) {
        validateZones(patch.ignore, 'Zona abaikan');
        patch.ignore.forEach((z) => {
            if (z.length !== 4) throw fail('Setiap zona abaikan harus berisi 4 angka: x1,y1,x2,y2', 400);
        });
    }
    if (patch.roi !== undefined) {
        validateZones(patch.roi, 'Area pantau');
        if (patch.roi.length > 0 && patch.roi.length < 3) {
            throw fail('Area pantau harus kosong atau berisi minimal 3 titik', 400);
        }
        patch.roi.forEach((p) => {
            if (p.length !== 2) throw fail('Setiap titik area pantau harus berisi 2 angka: x,y', 400);
        });
    }
    if (patch.crop_limit !== undefined && String(patch.crop_limit).trim()) {
        const parts = String(patch.crop_limit).split(',').map((v) => Number(v.trim()));
        if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
            throw fail('Batas bingkai harus 4 angka 0-1, contoh 0,0,0.88,1', 400);
        }
    }
    if (patch.alert_hours !== undefined) {
        const v = String(patch.alert_hours || '').trim();
        if (v && !HOURS_RE.test(v)) {
            throw fail('Format jam ronda harus HH:MM-HH:MM, contoh 21:00-05:00', 400);
        }
    }
    const ranges = {
        tg_cooldown: [5, 3600],
        tg_cooldown_off: [0, 86400],
        min_area: [100, 200000],
        confirm_conf: [0.05, 0.9],
        proc_w: [320, 1920],
        target_fps: [1, 25],
        retention_days: [1, 90],
        max_snaps: [5, 5000],
    };
    for (const [key, [min, max]] of Object.entries(ranges)) {
        if (patch[key] === undefined) continue;
        const n = Number(patch[key]);
        if (!Number.isFinite(n) || n < min || n > max) {
            throw fail(`Nilai ${key} harus antara ${min} dan ${max}`, 400);
        }
    }
    if (patch.chat_id !== undefined && String(patch.chat_id).trim() && !/^-?\d+$/.test(String(patch.chat_id).trim())) {
        throw fail('ID grup Telegram harus berupa angka, contoh -1001234567890', 400);
    }
}

class RondaConfigService {
    isAvailable() {
        return fs.existsSync(CONFIG_DIR);
    }

    /** Names of every configured detector. */
    listNames() {
        if (!this.isAvailable()) return [];
        return fs
            .readdirSync(CONFIG_DIR)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.slice(0, -5))
            .filter((name) => NAME_RE.test(name))
            .sort();
    }

    /** Raw documents including secrets — internal callers only. */
    listRaw() {
        return this.listNames().map((name) => ({
            name,
            config: readJson(path.join(CONFIG_DIR, `${name}.json`)) || {},
        }));
    }

    listCameras() {
        return this.listNames()
            .map((name) => {
                const config = readJson(path.join(CONFIG_DIR, `${name}.json`)) || {};
                return { name, config: redact(config), status: statusOf(config) };
            });
    }

    getCamera(name) {
        const config = readJson(configPath(name));
        if (!config) throw fail('Kamera tidak ditemukan', 404);
        return { name, config: redact(config), status: statusOf(config) };
    }

    /** Full document including secrets — internal callers only (container creation/restart). */
    getRaw(name) {
        const config = readJson(configPath(name));
        if (!config) throw fail('Kamera tidak ditemukan', 404);
        return config;
    }

    updateCamera(name, patch) {
        const file = configPath(name);
        const current = readJson(file);
        if (!current) throw fail('Kamera tidak ditemukan', 404);
        validate(patch);

        const next = { ...current };
        let needsRestart = false;
        const strings = new Set(['chat_id', 'alert_hours', 'confirm_classes', 'label', 'area', 'crop_limit']);
        for (const [key, value] of Object.entries(patch)) {
            const editable = EDITABLE.has(key);
            const structural = STRUCTURAL.has(key);
            if (!editable && !structural) continue;
            if (key === 'enabled' || key === 'stamp') next[key] = Boolean(value);
            else if (key === 'ignore' || key === 'roi') next[key] = value;
            else if (strings.has(key)) next[key] = String(value).trim();
            else next[key] = Number(value);
            if (structural && JSON.stringify(current[key]) !== JSON.stringify(next[key])) needsRestart = true;
        }

        this.writeRaw(name, next);
        return { name, config: redact(next), status: statusOf(next), needsRestart };
    }

    /** Write a full config document (used when creating a detector). */
    writeRaw(name, config) {
        const file = configPath(name);
        const tmp = `${file}.tmp`;
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(tmp, `${JSON.stringify(config, null, 1)}\n`);
        fs.renameSync(tmp, file);
        return config;
    }

    deleteRaw(name) {
        try {
            fs.unlinkSync(configPath(name));
        } catch {
            /* already gone */
        }
    }

    /** The Telegram bot token is shared across detectors; reuse it so it never has to be re-entered. */
    anyBotToken() {
        for (const cam of this.listRaw()) {
            if (cam.config?.bot_token) return cam.config.bot_token;
        }
        return process.env.TELEGRAM_BOT_TOKEN || '';
    }
}

export default new RondaConfigService();
