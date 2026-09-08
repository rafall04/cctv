/*
 * Purpose: Pure formatting + small helpers for the Audio Broadcast admin surface — durations, file
 *   sizes, base64 reading, and the weekday-mask model shared by the schedule form and list.
 * Caller: components/admin/audio/* and pages/AudioBroadcast.jsx.
 * Deps: none (browser FileReader for fileToBase64).
 * MainFuncs: formatDuration, formatBytes, fileToBase64, DAYS, MASK_*, describeDays.
 * SideEffects: none (fileToBase64 reads a File the user chose).
 */

/** Seconds -> "m:ss" (e.g. 7 -> "0:07", 407 -> "6:47"). */
export function formatDuration(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Bytes -> a short human size (e.g. 6609746 -> "6.3 MB"). */
export function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Read a File as bare base64 (no `data:` prefix) — the shape the upload endpoint expects.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('Gagal membaca berkas'));
        reader.readAsDataURL(file);
    });
}

// Weekday mask: bit0 = Minggu .. bit6 = Sabtu, matching the backend scheduler (Date.getUTCDay on WIB).
export const DAYS = [
    { bit: 1, short: 'Min', label: 'Minggu' },
    { bit: 2, short: 'Sen', label: 'Senin' },
    { bit: 4, short: 'Sel', label: 'Selasa' },
    { bit: 8, short: 'Rab', label: 'Rabu' },
    { bit: 16, short: 'Kam', label: 'Kamis' },
    { bit: 32, short: 'Jum', label: 'Jumat' },
    { bit: 64, short: 'Sab', label: 'Sabtu' },
];

export const MASK_DAILY = 127;   // setiap hari
export const MASK_WEEKDAYS = 62; // Senin–Jumat
export const MASK_WEEKEND = 65;  // Sabtu + Minggu

/** A short human phrase for a weekday mask, used in the schedule list. */
export function describeDays(mask) {
    const m = Number(mask) & 127;
    if (m === MASK_DAILY) return 'Setiap hari';
    if (m === MASK_WEEKDAYS) return 'Senin–Jumat';
    if (m === MASK_WEEKEND) return 'Sabtu & Minggu';
    const picked = DAYS.filter((d) => m & d.bit).map((d) => d.short);
    return picked.length ? picked.join(', ') : 'Tidak ada hari';
}
