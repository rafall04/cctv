// Purpose: Baca setelan penyimpanan rekaman dari tabel settings (bisa diatur admin di UI), dengan
//          env sebagai cadangan dan nilai bawaan sebagai lantai terakhir.
// Caller: recordingCleanupService — dipanggil SEGAR tiap siklus cleanup, jadi perubahan di UI
//          berlaku pada siklus berikutnya tanpa restart.
// Deps: settingsService.getSetting.
// MainFuncs: createStorageSettingsReader.
// SideEffects: Hanya membaca settings.
//
// KENAPA DIBACA DARI SETTINGS, BUKAN ENV
// --------------------------------------
// Setelan operasional (berapa maksimal ruang rekaman, aktif/tidak) harus bisa diubah calon klien
// dari halaman admin, bukan dengan menyunting .env lalu me-restart. Env tetap dihormati sebagai
// cadangan untuk instalasi yang belum pernah menyentuh UI-nya, dan sebagai satu-satunya tempat
// untuk knob lanjutan (lantai keamanan, jendela kamera-aktif) yang bukan urusan sehari-hari.

import defaultSettingsService from './settingsService.js';

const GIB = 1024 * 1024 * 1024;

/** Ambil setting mentah, atau null kalau tak ada / tak terbaca. getSetting MELEMPAR saat tak ada. */
function readRaw(settingsService, key) {
    try {
        return settingsService.getSetting(key)?.value ?? null;
    } catch {
        return null;
    }
}

function asNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function asBool(value) {
    if (value === true || value === false) return value;
    if (value === null || value === undefined || value === '') return null;
    const s = String(value).toLowerCase();
    if (s === 'true' || s === '1' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'off') return false;
    return null;
}

export function createStorageSettingsReader({ settingsService = defaultSettingsService } = {}) {
    return function read() {
        // --- aktif/tidak: setting menang; kalau tak ada, env RECORDING_ARCHIVE_HOLD_DISABLED; default ON.
        const enabledSetting = asBool(readRaw(settingsService, 'recording_archive_hold_enabled'));
        const envDisabled = String(process.env.RECORDING_ARCHIVE_HOLD_DISABLED || '').toLowerCase() === 'true';
        const enabled = enabledSetting !== null ? enabledSetting : !envDisabled;

        // --- maksimal storage (GB): setting menang; lalu env; default 0 = tanpa batas.
        let maxGb = asNumber(readRaw(settingsService, 'recording_max_storage_gb'));
        if (maxGb === null) maxGb = asNumber(process.env.RECORDING_MAX_STORAGE_GB) ?? 0;
        const maxStorageBytes = maxGb > 0 ? Math.round(maxGb * GIB) : 0;

        // --- lantai keamanan (GB sisa): env/advanced saja, default 5. Invarian, bukan urusan UI.
        const floorEnv = asNumber(process.env.RECORDING_ARCHIVE_HOLD_SAFETY_FLOOR_GB);
        const safetyFloorBytes = Math.round((floorEnv !== null && floorEnv >= 0 ? floorEnv : 5) * GIB);

        // --- jendela 'kamera aktif mengarsip' (hari): env/advanced saja, default 30.
        const winEnv = asNumber(process.env.RECORDING_ARCHIVE_ACTIVE_WINDOW_DAYS);
        const activeWindowMs = (winEnv !== null && winEnv > 0 ? winEnv : 30) * 24 * 3600 * 1000;

        return { enabled, maxStorageBytes, safetyFloorBytes, activeWindowMs };
    };
}

export default { createStorageSettingsReader };
