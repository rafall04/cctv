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

const PRAYERS = [['fajr', 'Subuh'], ['dhuhr', 'Dzuhur'], ['asr', 'Ashar'], ['maghrib', 'Maghrib'], ['isha', 'Isya']];

export default function PrayerConfig({ clips, areas }) {
    const [cfg, setCfg] = useState(null);
    const [times, setTimes] = useState(null);
    const [saving, setSaving] = useState(false);
    const [advanced, setAdvanced] = useState(false);
    const { showNotification } = useNotification();

    const reloadTimes = useCallback(async () => {
        const r = await getPrayerTimes();
        if (r.success) setTimes(r.data);
    }, []);

    useEffect(() => {
        (async () => {
            const r = await getPrayerConfig();
            if (r.success) setCfg(r.data);
            reloadTimes();
        })();
    }, [reloadTimes]);

    if (!cfg) return <p className="text-sm text-content-muted">Memuat pengaturan adzan…</p>;

    const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

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
        reloadTimes();
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
                    onClick={() => set({ enabled: cfg.enabled ? 0 : 1 })}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${cfg.enabled ? 'bg-status-live' : 'bg-edge-strong'}`}
                    aria-label={cfg.enabled ? 'Nonaktifkan adzan' : 'Aktifkan adzan'}
                >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${cfg.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
            </div>

            {/* Preview: today's computed times */}
            {times && (
                <div className="rounded-control border border-edge bg-surface-sunken p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-content-muted">Waktu sholat hari ini ({times.date})</span>
                        <button type="button" onClick={reloadTimes} className="text-xs font-medium text-primary hover:underline">Muat ulang</button>
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

            {/* Location */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field type="number" label="Lintang (latitude)" value={cfg.latitude} onChange={(e) => set({ latitude: e.target.value })} hint="mis. -7.5" />
                <Field type="number" label="Bujur (longitude)" value={cfg.longitude} onChange={(e) => set({ longitude: e.target.value })} hint="mis. 111.88" />
                <div className="flex items-end">
                    <button type="button" onClick={useGps} className="min-h-11 w-full rounded-control border border-edge bg-surface px-3 py-2 text-sm font-medium text-content-muted transition-colors hover:border-edge-strong">📍 Pakai lokasi HP</button>
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
            <label className="block">
                <span className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs font-semibold text-content-muted">Volume adzan</span>
                    <span className="text-xs tabular-nums text-content-subtle">{Number(cfg.gain_db) > 0 ? `+${cfg.gain_db}` : Number(cfg.gain_db)} dB</span>
                </span>
                <input type="range" min="-6" max="12" step="1" value={cfg.gain_db || 0} onChange={(e) => set({ gain_db: parseInt(e.target.value, 10) || 0 })} className="w-full accent-primary" />
            </label>

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
