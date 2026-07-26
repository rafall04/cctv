/*
 * Purpose: Admin page for Ronda Digital — per-camera motion-alert settings (watch window, Telegram
 *          group, cooldowns, reported object classes, motion sensitivity) plus detector liveness.
 * Caller: Protected admin route /admin/ronda (adminOnly).
 * Deps: React hooks, NotificationContext, rondaAdminService, Skeleton.
 * MainFuncs: RondaSettings.
 * SideEffects: Calls /api/admin/ronda/*.
 *
 * Settings are stored as JSON files the detector containers poll; a save takes effect in ~15 s
 * without restarting anything, so this page never needs a deploy to retune a camera.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import rondaAdminService from '../services/rondaAdminService';
import { TableSkeleton } from '../components/ui/Skeleton';

const HOUR_PRESETS = [
    { label: '21:00–05:00', value: '21:00-05:00' },
    { label: '22:00–05:00', value: '22:00-05:00' },
    { label: '23:00–04:30', value: '23:00-04:30' },
    { label: '24 jam', value: '' },
];

const CLASS_PRESETS = [
    { label: 'Orang saja', value: 'person' },
    { label: 'Orang + kendaraan', value: 'person,bicycle,car,motorcycle,bus,truck' },
];

const inputClass =
    'w-full bg-surface-sunken border border-edge rounded-control px-3 py-2 text-content text-sm ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus:border-edge-strong';
const labelClass = 'block text-xs font-medium text-content-muted mb-1.5';
const hintClass = 'mt-1 text-[11px] text-content-subtle';

function draftFrom(config) {
    return {
        enabled: config?.enabled !== false,
        alert_hours: config?.alert_hours ?? '',
        tg_cooldown: config?.tg_cooldown ?? 12,
        tg_cooldown_off: config?.tg_cooldown_off ?? 300,
        chat_id: config?.chat_id ?? '',
        confirm_classes: config?.confirm_classes ?? CLASS_PRESETS[1].value,
        min_area: config?.min_area ?? 700,
    };
}

export function RondaSettings() {
    const { showNotification } = useNotification();
    const [cameras, setCameras] = useState([]);
    const [available, setAvailable] = useState(true);
    const [loading, setLoading] = useState(true);
    const [drafts, setDrafts] = useState({});
    const [saving, setSaving] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await rondaAdminService.getCameras();
            const list = res?.data?.cameras ?? [];
            setAvailable(res?.data?.available !== false);
            setCameras(list);
            // Keep any edits the operator is in the middle of typing.
            setDrafts((prev) => {
                const next = { ...prev };
                list.forEach((cam) => {
                    if (!next[cam.name]) next[cam.name] = draftFrom(cam.config);
                });
                return next;
            });
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal memuat pengaturan ronda', 'error');
        } finally {
            setLoading(false);
        }
    }, [showNotification]);

    useEffect(() => {
        load();
        const timer = setInterval(load, 30000);
        return () => clearInterval(timer);
    }, [load]);

    const setField = (name, key, value) =>
        setDrafts((prev) => ({ ...prev, [name]: { ...prev[name], [key]: value } }));

    const save = async (name) => {
        setSaving(name);
        try {
            const res = await rondaAdminService.updateCamera(name, drafts[name]);
            showNotification(res?.message || 'Tersimpan', 'success');
            await load();
        } catch (error) {
            showNotification(error.response?.data?.message || 'Gagal menyimpan', 'error');
        } finally {
            setSaving(null);
        }
    };

    if (loading) return <TableSkeleton rows={4} />;

    return (
        <div className="space-y-4">
            <header>
                <h1 className="text-xl font-semibold text-content">Pengaturan Ronda</h1>
                <p className="mt-1 text-sm text-content-muted">
                    Atur jam siaga, grup Telegram, dan kepekaan tiap kamera. Perubahan berlaku sekitar
                    15 detik tanpa perlu menyalakan ulang apa pun.
                </p>
            </header>

            {!available && (
                <div className="rounded-card border border-edge bg-surface-raised p-4 text-sm text-content-muted">
                    Layanan deteksi tidak terpasang di server ini, jadi tidak ada kamera yang bisa diatur.
                </div>
            )}

            {available && cameras.length === 0 && (
                <div className="rounded-card border border-edge bg-surface-raised p-4 text-sm text-content-muted">
                    Belum ada kamera deteksi yang terdaftar.
                </div>
            )}

            {cameras.map((cam) => {
                const draft = drafts[cam.name] || draftFrom(cam.config);
                const online = cam.status?.online;
                return (
                    <section
                        key={cam.name}
                        className="rounded-card border border-edge bg-surface-raised p-4 shadow-e1"
                    >
                        <div className="flex flex-wrap items-center gap-2">
                            <span
                                className={`h-2.5 w-2.5 flex-none rounded-full ${online ? 'bg-status-live' : 'bg-status-fault'}`}
                                aria-hidden="true"
                            />
                            <h2 className="font-semibold text-content">{cam.config?.label || cam.name}</h2>
                            <span className="text-xs tabular-nums text-content-subtle">
                                {cam.config?.area ? `${cam.config.area} · ` : ''}
                                {online
                                    ? `aktif · ${cam.status.eventsToday ?? 0} kejadian hari ini`
                                    : 'tidak aktif'}
                            </span>
                        </div>

                        <label className="mt-3 flex items-center gap-2 text-sm text-content">
                            <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(e) => setField(cam.name, 'enabled', e.target.checked)}
                                className="h-4 w-4 rounded border-edge accent-[var(--primary-color)]"
                            />
                            Kirim peringatan ke Telegram
                        </label>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <label className={labelClass} htmlFor={`hours-${cam.name}`}>
                                    Jam ronda (siaga penuh)
                                </label>
                                <input
                                    id={`hours-${cam.name}`}
                                    className={inputClass}
                                    value={draft.alert_hours}
                                    placeholder="21:00-05:00"
                                    onChange={(e) => setField(cam.name, 'alert_hours', e.target.value)}
                                />
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {HOUR_PRESETS.map((p) => (
                                        <button
                                            key={p.label}
                                            type="button"
                                            onClick={() => setField(cam.name, 'alert_hours', p.value)}
                                            className="rounded-control border border-edge px-2 py-1 text-[11px] text-content-muted
                                                       hover:border-edge-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                                <p className={hintClass}>
                                    Di luar jam ini peringatan tetap dikirim, hanya lebih jarang.
                                </p>
                            </div>

                            <div>
                                <label className={labelClass} htmlFor={`cd-${cam.name}`}>
                                    Jeda saat ronda (detik)
                                </label>
                                <input
                                    id={`cd-${cam.name}`}
                                    type="number"
                                    min="5"
                                    max="3600"
                                    className={inputClass}
                                    value={draft.tg_cooldown}
                                    onChange={(e) => setField(cam.name, 'tg_cooldown', Number(e.target.value))}
                                />
                            </div>

                            <div>
                                <label className={labelClass} htmlFor={`cdoff-${cam.name}`}>
                                    Jeda di luar ronda (detik)
                                </label>
                                <input
                                    id={`cdoff-${cam.name}`}
                                    type="number"
                                    min="0"
                                    max="86400"
                                    className={inputClass}
                                    value={draft.tg_cooldown_off}
                                    onChange={(e) => setField(cam.name, 'tg_cooldown_off', Number(e.target.value))}
                                />
                                <p className={hintClass}>0 = matikan di luar jam ronda.</p>
                            </div>

                            <div className="sm:col-span-2">
                                <label className={labelClass} htmlFor={`chat-${cam.name}`}>
                                    ID grup Telegram
                                </label>
                                <input
                                    id={`chat-${cam.name}`}
                                    className={inputClass}
                                    value={draft.chat_id}
                                    placeholder="-1001234567890"
                                    onChange={(e) => setField(cam.name, 'chat_id', e.target.value)}
                                />
                            </div>

                            <div>
                                <label className={labelClass} htmlFor={`cls-${cam.name}`}>
                                    Objek yang dilaporkan
                                </label>
                                <select
                                    id={`cls-${cam.name}`}
                                    className={inputClass}
                                    value={draft.confirm_classes}
                                    onChange={(e) => setField(cam.name, 'confirm_classes', e.target.value)}
                                >
                                    {CLASS_PRESETS.map((p) => (
                                        <option key={p.value} value={p.value}>{p.label}</option>
                                    ))}
                                </select>
                                <p className={hintClass}>Area parkir sebaiknya &quot;Orang saja&quot;.</p>
                            </div>

                            <div>
                                <label className={labelClass} htmlFor={`area-${cam.name}`}>
                                    Ukuran gerakan minimum
                                </label>
                                <input
                                    id={`area-${cam.name}`}
                                    type="number"
                                    min="100"
                                    max="200000"
                                    step="100"
                                    className={inputClass}
                                    value={draft.min_area}
                                    onChange={(e) => setField(cam.name, 'min_area', Number(e.target.value))}
                                />
                                <p className={hintClass}>Naikkan bila bayangan daun memicu peringatan.</p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => save(cam.name)}
                            disabled={saving === cam.name}
                            className="mt-4 w-full rounded-control bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white
                                       disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:w-auto"
                        >
                            {saving === cam.name ? 'Menyimpan…' : 'Simpan'}
                        </button>
                    </section>
                );
            })}
        </div>
    );
}

export default RondaSettings;
