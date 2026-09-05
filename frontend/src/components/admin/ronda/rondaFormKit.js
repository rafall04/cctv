/*
 * Purpose: Shared form constants + pure helpers for the Ronda Digital admin settings — split out of
 *          RondaSettings.jsx so the page and the per-camera card can reuse them without duplication
 *          (and to keep each file under the size ratchet).
 * Caller: pages/RondaSettings.jsx, components/admin/ronda/RondaCameraCard.jsx.
 * Deps: none (pure).
 * MainFuncs: draftFrom, parseZones, safeZones, matchPreset, dirtyStructuralKeys.
 */

export const HOUR_PRESETS = [
    { label: '21:00–05:00', value: '21:00-05:00' },
    { label: '22:00–05:00', value: '22:00-05:00' },
    { label: '23:00–04:30', value: '23:00-04:30' },
    { label: '24 jam', value: '' },
];

export const CLASS_PRESETS = [
    { label: 'Orang saja', value: 'person' },
    { label: 'Orang + kendaraan', value: 'person,bicycle,car,motorcycle,bus,truck' },
];

/*
 * Preset performa = satu klik untuk dua tuas CPU terbesar sekaligus (lebar proses + fps). Server ini
 * 8 core dan dipakai bersama; saat semua kamera aktif, "Hemat CPU" memberi ruang napas. Angkanya
 * dipilih dari beban terukur di produksi, bukan tebakan. Keduanya struktural → perlu nyala ulang.
 */
export const PERF_PRESETS = [
    { key: 'hemat', label: 'Hemat CPU', proc_w: 720, target_fps: 3,
        hint: 'Paling ringan untuk server. Pilih ini saat banyak kamera dipantau bersamaan.' },
    { key: 'seimbang', label: 'Seimbang', proc_w: 960, target_fps: 5,
        hint: 'Setelan bawaan — imbang antara kepekaan dan beban server.' },
    { key: 'ketelitian', label: 'Ketelitian', proc_w: 1280, target_fps: 8,
        hint: 'Objek kecil/jauh lebih terdeteksi, tetapi beban CPU paling tinggi.' },
];

// Cermin dari STRUCTURAL di rondaConfigService.js — perubahannya baru berlaku setelah kamera
// dinyalakan ulang. Dipakai untuk menandai perubahan yang belum diterapkan.
export const STRUCTURAL_KEYS = ['proc_w', 'target_fps', 'crop_limit', 'retention_days', 'max_snaps'];

/*
 * `text-base sm:text-sm`: di bawah 16 px, Safari iOS memperbesar halaman saat input disentuh dan
 * pengguna harus mencubit untuk kembali. Halaman ronda justru paling sering dibuka dari HP —
 * orang mengubah jam siaga atau kepekaan saat sedang di luar, bukan di depan laptop.
 */
export const inputClass =
    'w-full bg-surface-sunken border border-edge rounded-control px-3 py-2 text-content text-base sm:text-sm ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus:border-edge-strong';
export const labelClass = 'block text-xs font-medium text-content-muted mb-1.5';
export const hintClass = 'mt-1 text-[11px] text-content-subtle';
// min-h 40 px hanya di layar sempit: tombol-tombol ini sebelumnya setinggi 27-30 px, di bawah
// ukuran sasaran sentuh yang bisa ditekan dengan yakin sambil berdiri.
export const btnGhost =
    'min-h-[40px] sm:min-h-0 rounded-control border border-edge px-3 py-1.5 text-xs text-content-muted ' +
    'hover:border-edge-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50';

export function draftFrom(config) {
    return {
        label: config?.label ?? '',
        area: config?.area ?? '',
        enabled: config?.enabled !== false,
        stamp: config?.stamp === true,
        alert_hours: config?.alert_hours ?? '',
        tg_cooldown: config?.tg_cooldown ?? 12,
        tg_cooldown_off: config?.tg_cooldown_off ?? 300,
        chat_id: config?.chat_id ?? '',
        confirm_classes: config?.confirm_classes ?? CLASS_PRESETS[1].value,
        min_area: config?.min_area ?? 700,
        confirm_conf: config?.confirm_conf ?? 0.15,
        proc_w: config?.proc_w ?? 960,
        target_fps: config?.target_fps ?? 5,
        crop_limit: config?.crop_limit ?? '0,0,1,1',
        retention_days: config?.retention_days ?? 7,
        max_snaps: config?.max_snaps ?? 50,
        ignore: JSON.stringify(config?.ignore ?? []),
        roi: JSON.stringify(config?.roi ?? []),
    };
}

/** Turns the two JSON textareas back into arrays, reporting which one is malformed. */
export function parseZones(draft) {
    const out = {};
    for (const key of ['ignore', 'roi']) {
        try {
            const parsed = JSON.parse(draft[key] || '[]');
            if (!Array.isArray(parsed)) throw new Error('bukan daftar');
            out[key] = parsed;
        } catch {
            const label = key === 'ignore' ? 'Zona abaikan' : 'Area pantau';
            throw new Error(`${label} bukan JSON yang sah. Contoh: [[0,0,0.3,0.1]]`);
        }
    }
    return out;
}

/** Parse the JSON text fields, tolerating a half-typed value so the editor keeps rendering. */
export function safeZones(draft) {
    const read = (raw) => {
        try {
            const parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };
    return { roi: read(draft?.roi), ignore: read(draft?.ignore) };
}

/** Preset yang cocok persis dengan nilai proc_w+target_fps saat ini, atau null bila nilai khusus. */
export function matchPreset(draft) {
    return PERF_PRESETS.find(
        (p) => Number(draft?.proc_w) === p.proc_w && Number(draft?.target_fps) === p.target_fps,
    )?.key || null;
}

/** Kunci struktural yang berbeda dari konfigurasi tersimpan (= belum disimpan, perlu nyala ulang). */
export function dirtyStructuralKeys(draft, config) {
    const saved = draftFrom(config);
    return STRUCTURAL_KEYS.filter((k) => String(draft?.[k]) !== String(saved[k]));
}
