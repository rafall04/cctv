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
const EDITABLE = new Set([
    'enabled',
    'alert_hours',
    'tg_cooldown',
    'tg_cooldown_off',
    'chat_id',
    'min_area',
    'confirm_conf',
    'confirm_classes',
]);

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
        };
    } catch {
        return { online: false, ageSeconds: null, eventsToday: null, lastSeen: null };
    }
}

function validate(patch) {
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

    listCameras() {
        if (!this.isAvailable()) return [];
        return fs
            .readdirSync(CONFIG_DIR)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.slice(0, -5))
            .filter((name) => NAME_RE.test(name))
            .sort()
            .map((name) => {
                const config = readJson(path.join(CONFIG_DIR, `${name}.json`)) || {};
                return { name, config, status: statusOf(config) };
            });
    }

    getCamera(name) {
        const config = readJson(configPath(name));
        if (!config) throw fail('Kamera tidak ditemukan', 404);
        return { name, config, status: statusOf(config) };
    }

    updateCamera(name, patch) {
        const file = configPath(name);
        const current = readJson(file);
        if (!current) throw fail('Kamera tidak ditemukan', 404);
        validate(patch);

        const next = { ...current };
        for (const [key, value] of Object.entries(patch)) {
            if (!EDITABLE.has(key)) continue;
            if (key === 'enabled') next[key] = Boolean(value);
            else if (key === 'chat_id' || key === 'alert_hours' || key === 'confirm_classes') next[key] = String(value).trim();
            else next[key] = Number(value);
        }

        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(next, null, 1)}\n`);
        fs.renameSync(tmp, file);
        return { name, config: next, status: statusOf(next) };
    }
}

export default new RondaConfigService();
