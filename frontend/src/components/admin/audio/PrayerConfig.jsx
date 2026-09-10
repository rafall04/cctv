/*
 * Purpose: Adzan (automatic prayer-time broadcast) configuration + today's-times preview. The operator
 *   sets the village location, picks the adzan clip + target, tunes per-prayer offsets, and VERIFIES the
 *   computed times against their local Kemenag schedule before enabling. Times are computed on the server
 *   with no external API.
 * Caller: pages/AudioBroadcast.jsx (top of the Jadwal tab).
 * Deps: audioService (prayer config + times), contexts, components/ui.
 * MainFuncs: PrayerConfig.
 * SideEffects: saves the prayer config; enabling it makes the server broadcast adzan at prayer times.
 */

import { useCallback, useEffect, useState } from 'react';
import { getPrayerConfig, updatePrayerConfig, getPrayerTimes } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { Field } from '../../ui';
import { PRAYER_LOCATIONS, PRAYER_LOCATION_GROUPS, matchLocation } from './prayerLocations';

const PRAYERS = [['fajr', 'Subuh'], ['dhuhr', 'Dzuhur'], ['asr', 'Ashar'], ['maghrib', 'Maghrib'], ['isha', 'Isya']];
const TZ_LABEL = { 7: 'WIB (+7)', 8: 'WITA (+8)', 9: 'WIT (+9)' };
const QORI_QUICK = [5, 10, 15, 20, 30];

// "HH:MM" minus `lead` minutes → "HH:MM" (wraps midnight) — mirrors the backend so the preview shows the
// EXACT qori start time the scheduler will use. null for a missing/invalid time.
const minusMinutes = (hhmm, lead) => {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return null;
    const t = (((parseInt(m[1], 10) * 60 + parseInt(m[2], 10) - (parseInt(lead, 10) || 0)) % 1440) + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export default function PrayerConfig({ clips, areas }) {
    const [cfg, setCfg] = useState(null);
    const [times, setTimes] = useState(null);
    const [saving, setSaving] = useState(false);
    const [advanced, setAdvanced] = useState(false);
    const { showNotification } = useNotification();

    // Preview reflects the EDITED (possibly unsaved) form — pass its location/params so times update the
    // instant the operator picks a kabupaten, instead of only after saving.
    const reloadTimes = useCallback(async (c) => {
        const params = c ? {
            latitude: c.latitude, longitude: c.longitude, timezone: c.timezone,
            fajr_angle: c.fajr_angle, isha_angle: c.isha_angle, asr_factor: c.asr_factor, ikhtiyati: c.ikhtiyati,
            offset_fajr: c.offset_fajr, offset_dhuhr: c.offset_dhuhr, offset_asr: c.offset_asr,
            offset_maghrib: c.offset_maghrib, offset_isha: c.offset_isha,
        } : undefined;
        const r = await getPrayerTimes(params);
        if (r.success) setTimes(r.data);
    }, []);

    useEffect(() => {
        (async () => {
            const r = await getPrayerConfig();
            if (r.success) setCfg(r.data);
        })();
    }, []);

    // Live preview: recompute (debounced) whenever any calc input changes, using the current form values.
    useEffect(() => {
        if (!cfg) return undefined;
        const t = setTimeout(() => reloadTimes(cfg), 300);
        return () => clearTimeout(t);
    }, [cfg, reloadTimes]);

    if (!cfg) return <p className="text-sm text-content-muted">Memuat pengaturan adzan…</p>;

    const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

    // Lokasi belum diatur = lintang & bujur masih 0 (default). Dengan 0,0 semua waktu geser ~7 jam
    // (koreksi bujur hilang), jadi ini WAJIB ditangani sebelum adzan diaktifkan.
    const locationUnset = !(Number(cfg.latitude) || Number(cfg.longitude));
    const currentLocId = matchLocation(cfg.latitude, cfg.longitude)?.id || '';

    const pickLocation = (id) => {
        const loc = PRAYER_LOCATIONS.find((l) => l.id === id);
        if (!loc) return;
        set({ latitude: loc.lat, longitude: loc.lon, timezone: loc.tz });
    };

    // The enable switch SAVES immediately (like the Area/Jadwal switches) — the old version only flipped
    // local state, so an operator who toggled "on" and left without pressing Simpan never actually armed
    // the adzan. Turning on commits the current form (including the picked kabupaten).
    const toggleEnabled = async () => {
        const turningOn = !cfg.enabled;
        if (turningOn && locationUnset) {
            showNotification({ type: 'error', title: 'Lokasi belum diatur', message: 'Pilih kabupaten/kota dulu agar waktu sholat benar.' });
            return;
        }
        const next = { ...cfg, enabled: turningOn ? 1 : 0 };
        setCfg(next); // optimistic
        setSaving(true);
        const r = await updatePrayerConfig(next);
        setSaving(false);
        if (!r.success) {
            setCfg((c) => ({ ...c, enabled: turningOn ? 0 : 1 })); // revert
            showNotification({ type: 'error', title: 'Gagal', message: r.message });
            return;
        }
        setCfg(r.data);
        reloadTimes(r.data);
        showNotification({ type: turningOn ? 'success' : 'info', title: turningOn ? 'Adzan otomatis aktif' : 'Adzan otomatis nonaktif', message: turningOn ? 'Tersimpan — akan berkumandang otomatis.' : 'Tersimpan.' });
    };

    const useGps = () => {
        if (!navigator.geolocation) { showNotification({ type: 'error', title: 'GPS tak tersedia' }); return; }
        navigator.geolocation.getCurrentPosition(
            (pos) => { set({ latitude: Number(pos.coords.latitude.toFixed(5)), longitude: Number(pos.coords.longitude.toFixed(5)) }); showNotification({ type: 'success', title: 'Lokasi diisi dari GPS' }); },
            () => showNotification({ type: 'error', title: 'Gagal ambil lokasi' }),
        );
    };

    const save = async () => {
        setSaving(true);
        const r = await updatePrayerConfig(cfg);
        setSaving(false);
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        setCfg(r.data);
        showNotification({ type: 'success', title: 'Pengaturan adzan disimpan' });
        reloadTimes(r.data);
    };

    return (
        <section className="space-y-4 rounded-card border border-edge bg-surface p-4 shadow-e1">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-content">🕌 Adzan otomatis</h3>
                    <p className="mt-0.5 text-xs text-content-muted">Waktu sholat dihitung lokal (tanpa internet). <span className="font-medium text-status-warn">Cocokkan dulu dengan jadwal Kemenag setempat</span>, atur offset bila perlu, baru aktifkan.</p>
                </div>
                <button
                    type="button" role="switch" aria-checked={Boolean(cfg.enabled)}
                    onClick={toggleEnabled}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${cfg.enabled ? 'bg-status-live' : 'bg-edge-strong'}`}
                    aria-label={cfg.enabled ? 'Nonaktifkan adzan' : 'Aktifkan adzan'}
                >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${cfg.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
            </div>

            {locationUnset && (
                <div className="rounded-control border border-status-warn/40 bg-status-warn/10 p-3 text-xs text-status-warn">
                    <span className="font-semibold">Lokasi belum diatur.</span> Pilih kabupaten/kota di bawah dulu —
                    tanpa itu waktu sholat bisa meleset berjam-jam dan adzan tak akan berbunyi meski diaktifkan.
                </div>
            )}

            {/* Preview: today's computed times */}
            {times && (
                <div className="rounded-control border border-edge bg-surface-sunken p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-content-muted">
                            Waktu sholat hari ini ({times.date})
                            {times.locationSet === false && <span className="ml-1 font-normal text-status-warn">— lokasi belum diatur, belum akurat</span>}
                        </span>
                        <button type="button" onClick={() => reloadTimes(cfg)} className="text-xs font-medium text-primary hover:underline">Muat ulang</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {PRAYERS.map(([key, label]) => (
                            <div key={key} className={`rounded-control border px-2 py-1.5 text-center ${cfg[`enable_${key}`] ? 'border-edge bg-surface' : 'border-dashed border-edge opacity-50'}`}>
                                <div className="text-xs text-content-subtle">{label}</div>
                                <div className="font-mono text-sm font-semibold tabular-nums text-content">{times.times?.[key] || '—'}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Location — pick a kabupaten/kota (fills lat/lon/timezone) so nobody has to type raw coords. */}
            <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                    <Field as="select" label="Lokasi (kabupaten/kota)" value={currentLocId} onChange={(e) => pickLocation(e.target.value)}>
                        <option value="">{currentLocId ? '— pilih lokasi —' : '— pilih kabupaten/kota —'}</option>
                        {PRAYER_LOCATION_GROUPS.map((g) => (
                            <optgroup key={g} label={g}>
                                {PRAYER_LOCATIONS.filter((l) => l.group === g).map((l) => (
                                    <option key={l.id} value={l.id}>{l.name}</option>
                                ))}
                            </optgroup>
                        ))}
                    </Field>
                    <Field as="select" label="Zona waktu" value={Number(cfg.timezone ?? 7)} onChange={(e) => set({ timezone: Number(e.target.value) })}>
                        {[7, 8, 9].map((tz) => <option key={tz} value={tz}>{TZ_LABEL[tz]}</option>)}
                    </Field>
                </div>
                <p className="text-xs text-content-subtle">
                    Tak ada di daftar? Isi lintang/bujur manual atau pakai GPS HP. {currentLocId ? '' : locationUnset ? '' : 'Koordinat saat ini di luar daftar preset.'}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field type="number" label="Lintang (latitude)" value={cfg.latitude} onChange={(e) => set({ latitude: e.target.value })} hint="mis. -7.15" />
                    <Field type="number" label="Bujur (longitude)" value={cfg.longitude} onChange={(e) => set({ longitude: e.target.value })} hint="mis. 111.88" />
                    <div className="flex items-end">
                        <button type="button" onClick={useGps} className="min-h-11 w-full rounded-control border border-edge bg-surface px-3 py-2 text-sm font-medium text-content-muted transition-colors hover:border-edge-strong">📍 Pakai lokasi HP</button>
                    </div>
                </div>
            </div>

            {/* Clip + target */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field as="select" label="Audio adzan" value={cfg.clip_id || ''} onChange={(e) => set({ clip_id: e.target.value })}>
                    <option value="">— pilih audio adzan —</option>
                    {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Field>
                <Field as="select" label="Audio adzan Subuh (opsional)" value={cfg.clip_id_fajr || ''} onChange={(e) => set({ clip_id_fajr: e.target.value })}>
                    <option value="">— sama dengan di atas —</option>
                    {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field as="select" label="Area target" value={cfg.area_id || ''} onChange={(e) => set({ area_id: e.target.value, target_kind: 'area' })}>
                    <option value="">— pilih area —</option>
                    {areas.filter((a) => a.audio_broadcast_enabled).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Field>
                <Field type="number" label="Ulang" min={1} max={20} value={cfg.loop} onChange={(e) => set({ loop: e.target.value })} />
            </div>

            {/* Per-prayer enable + offset */}
            <div className="space-y-1.5">
                <span className="text-xs font-semibold text-content-muted">Per waktu (aktif + geser menit)</span>
                {PRAYERS.map(([key, label]) => (
                    <div key={key} className="flex items-center gap-3 rounded-control border border-edge px-3 py-1.5">
                        <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-content">
                            <input type="checkbox" checked={Boolean(cfg[`enable_${key}`])} onChange={(e) => set({ [`enable_${key}`]: e.target.checked ? 1 : 0 })} className="h-4 w-4 accent-primary" />
                            {label}
                        </label>
                        <span className="text-xs text-content-subtle">geser</span>
                        <input type="number" min={-60} max={60} value={cfg[`offset_${key}`]} onChange={(e) => set({ [`offset_${key}`]: e.target.value })} className="w-16 rounded-control border border-edge bg-surface px-2 py-1 text-sm text-content" />
                        <span className="text-xs text-content-subtle">mnt</span>
                    </div>
                ))}
            </div>

            {/* Qori / murottal sebelum adzan */}
            <div className="space-y-3 rounded-control border border-edge bg-surface-sunken p-3">
                <label className="flex cursor-pointer items-start justify-between gap-3">
                    <span className="min-w-0">
                        <span className="text-sm font-semibold text-content">🎧 Qori (murottal) sebelum adzan</span>
                        <span className="mt-0.5 block text-xs text-content-muted">Putar tilawah beberapa menit sebelum tiap adzan. Saat waktu adzan tiba, qori otomatis dihentikan dan adzan mengambil alih.</span>
                    </span>
                    <span
                        role="switch" aria-checked={Boolean(cfg.qori_enabled)}
                        onClick={() => set({ qori_enabled: cfg.qori_enabled ? 0 : 1 })}
                        className={`relative mt-0.5 h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${cfg.qori_enabled ? 'bg-status-live' : 'bg-edge-strong'}`}
                    >
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${cfg.qori_enabled ? 'left-[22px]' : 'left-0.5'}`} />
                    </span>
                </label>

                {Boolean(cfg.qori_enabled) && (
                    <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field as="select" label="Audio qori (murottal)" value={cfg.qori_clip_id || ''} onChange={(e) => set({ qori_clip_id: e.target.value })}>
                                <option value="">— pilih murottal —</option>
                                {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </Field>
                            <Field as="select" label="Qori Subuh (opsional)" value={cfg.qori_clip_id_fajr || ''} onChange={(e) => set({ qori_clip_id_fajr: e.target.value })}>
                                <option value="">— sama dengan di atas —</option>
                                {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </Field>
                        </div>

                        {!cfg.qori_clip_id && (
                            <p className="text-xs text-status-warn">Pilih audio murottal dulu — qori tak akan berbunyi tanpa audio. Belum punya? Unggah/impor di tab Pustaka.</p>
                        )}

                        {/* Quick-fill lead for all prayers */}
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-content-muted">Terapkan ke semua:</span>
                            {QORI_QUICK.map((n) => (
                                <button key={n} type="button" onClick={() => set({ qori_lead_fajr: n, qori_lead_dhuhr: n, qori_lead_asr: n, qori_lead_maghrib: n, qori_lead_isha: n })}
                                    className="rounded-control border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-content-muted hover:border-edge-strong">{n} mnt</button>
                            ))}
                            <button type="button" onClick={() => set({ qori_lead_fajr: 0, qori_lead_dhuhr: 0, qori_lead_asr: 0, qori_lead_maghrib: 0, qori_lead_isha: 0 })}
                                className="rounded-control border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-content-subtle hover:border-edge-strong">matikan semua</button>
                        </div>

                        {/* Per-prayer lead + computed start time (precision) */}
                        <div className="space-y-1.5">
                            <span className="text-xs font-semibold text-content-muted">Menit sebelum tiap adzan (0 = tanpa qori)</span>
                            {PRAYERS.map(([key, label]) => {
                                const lead = Number(cfg[`qori_lead_${key}`]) || 0;
                                const adzan = times?.times?.[key];
                                const start = lead > 0 && adzan ? minusMinutes(adzan, lead) : null;
                                const adzanOff = !cfg[`enable_${key}`];
                                return (
                                    <div key={key} className={`flex items-center gap-2 rounded-control border border-edge px-3 py-1.5 ${adzanOff ? 'opacity-50' : ''}`}>
                                        <span className="flex-1 truncate text-sm text-content">{label}{adzanOff ? ' — adzan nonaktif' : ''}</span>
                                        <input type="number" min={0} max={120} value={cfg[`qori_lead_${key}`] ?? 0} onChange={(e) => set({ [`qori_lead_${key}`]: e.target.value })} className="w-16 rounded-control border border-edge bg-surface px-2 py-1 text-sm text-content" />
                                        <span className="text-xs text-content-subtle">mnt</span>
                                        <span className="w-24 text-right font-mono text-xs tabular-nums text-content-muted">
                                            {adzanOff ? '—' : start ? `${start}→${adzan}` : 'tanpa qori'}
                                        </span>
                                    </div>
                                );
                            })}
                            <p className="text-xs text-content-subtle">Kolom kanan = jam qori mulai → jam adzan. Qori hanya berbunyi untuk waktu yang adzannya aktif.</p>
                        </div>

                        <div className="flex items-end gap-3">
                            <Field type="number" label="Ulang qori" min={1} max={20} value={cfg.qori_loop ?? 1} onChange={(e) => set({ qori_loop: e.target.value })} />
                            <p className="flex-1 pb-2 text-xs text-content-subtle">Qori memakai target area yang sama dengan adzan. Ulang bila murottal selesai sebelum adzan.</p>
                        </div>
                    </>
                )}
            </div>

            {/* Advanced params */}
            <div>
                <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs font-medium text-primary hover:underline">{advanced ? 'Sembunyikan' : 'Parameter lanjutan'}</button>
                {advanced && (
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Field type="number" label="Sudut Subuh (°)" value={cfg.fajr_angle} onChange={(e) => set({ fajr_angle: e.target.value })} hint="Kemenag 20" />
                        <Field type="number" label="Sudut Isya (°)" value={cfg.isha_angle} onChange={(e) => set({ isha_angle: e.target.value })} hint="Kemenag 18" />
                        <Field type="number" label="Ikhtiyati (mnt)" value={cfg.ikhtiyati} onChange={(e) => set({ ikhtiyati: e.target.value })} hint="pengaman, mis. 2" />
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-content-subtle">Adzan mengabaikan jam tenang (memang harus berbunyi). Hanya kamera &quot;Didukung&quot; di area yang berbunyi.</p>
                <button type="button" onClick={save} disabled={saving} className="shrink-0 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50">
                    {saving ? 'Menyimpan…' : 'Simpan'}
                </button>
            </div>
        </section>
    );
}
