/*
 * Purpose: Motion -> deterrent-audio arming UI. Per (supported) camera, the operator ARMS it for a window;
 *   while armed, an ONVIF motion event plays a deterrent clip on that camera's speaker, guarded by a
 *   cooldown + hourly cap. Highest-risk feature -> loud EXPERIMENTAL warning + OFF by default.
 * Caller: pages/AudioBroadcast.jsx (bottom of the Kamera & Area tab).
 * Deps: audioService (motion arms), clips, contexts, components/ui.
 * MainFuncs: MotionArms.
 * SideEffects: arming makes the server auto-broadcast on motion (guarded).
 */

import { useCallback, useEffect, useState } from 'react';
import { getMotionArms, setMotionArm, disarmMotion } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Field } from '../../ui';

const DEFAULT_FORM = { clip_id: '', arm_minutes: 120, cooldown_sec: 60, max_per_hour: 6, gain_db: 0 };

export default function MotionArms({ capability, clips }) {
    const [arms, setArms] = useState([]);
    const [editing, setEditing] = useState(null); // cameraId being configured
    const [form, setForm] = useState(DEFAULT_FORM);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const load = useCallback(async () => {
        const r = await getMotionArms();
        if (r.success) setArms(r.data || []);
    }, []);
    useEffect(() => { load(); }, [load]);

    const armByCam = new Map(arms.map((a) => [a.camera_id, a]));
    const supported = (capability || []).filter((c) => c.supports_audio_out === 1 && !c.audio_out_blocked);

    const openEditor = (cam) => {
        const a = armByCam.get(cam.id);
        setEditing(cam.id);
        setForm(a
            ? { clip_id: a.clip_id ? String(a.clip_id) : '', arm_minutes: 120, cooldown_sec: a.cooldown_sec, max_per_hour: a.max_per_hour, gain_db: a.gain_db || 0 }
            : { ...DEFAULT_FORM });
    };

    const arm = async (cam) => {
        if (!form.clip_id) { showNotification({ type: 'error', title: 'Pilih audio pengusir dulu' }); return; }
        const ok = await confirm({
            title: '🎯 Persenjatai kamera',
            message: `"${cam.name}" akan MEMBUNYIKAN audio otomatis saat ada gerakan, selama ${form.arm_minutes} menit. Fitur eksperimental — awasi kamera saat pertama kali. Lanjut?`,
            confirmLabel: 'Persenjatai', cancelLabel: 'Batal', tone: 'danger',
        });
        if (!ok) return;
        const r = await setMotionArm(cam.id, { enabled: true, clip_id: Number(form.clip_id), arm_minutes: Number(form.arm_minutes), cooldown_sec: Number(form.cooldown_sec), max_per_hour: Number(form.max_per_hour), gain_db: Number(form.gain_db) });
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        showNotification({ type: 'success', title: 'Kamera dipersenjatai', message: cam.name });
        setEditing(null);
        load();
    };

    const disarmCam = async (cam) => {
        const r = await disarmMotion(cam.id);
        if (r.success) { load(); showNotification({ type: 'info', title: 'Arm dinonaktifkan', message: cam.name }); }
        else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };

    const untilLabel = (a) => {
        if (!a.arm_until) return 'sampai dimatikan';
        const ms = new Date(a.arm_until).getTime() - Date.now();
        if (ms <= 0) return 'kedaluwarsa';
        const mins = Math.round(ms / 60000);
        return mins >= 60 ? `~${Math.round(mins / 60)} jam lagi` : `~${mins} mnt lagi`;
    };

    return (
        <section className="space-y-3 rounded-card border-2 border-status-warn/40 bg-status-warn/5 p-4">
            <div>
                <h3 className="text-sm font-bold text-status-warn">🎯 Motion → suara otomatis (eksperimental)</h3>
                <p className="mt-0.5 text-xs text-content-muted">
                    Kamera yang dipersenjatai akan membunyikan audio pengusir otomatis saat ada gerakan (mis. maling/ronda malam),
                    dengan jeda antar-bunyi &amp; batas per-jam. <span className="font-medium text-status-fault">Berisiko pada kamera murah — awasi saat pertama mengaktifkan.</span>
                </p>
            </div>

            {supported.length === 0 ? (
                <p className="text-xs text-content-subtle">Belum ada kamera &quot;Didukung&quot;. Deteksi kapabilitas dulu di atas.</p>
            ) : (
                <ul className="space-y-1.5">
                    {supported.map((cam) => {
                        const a = armByCam.get(cam.id);
                        const isEditing = editing === cam.id;
                        return (
                            <li key={cam.id} className="rounded-control border border-edge bg-surface px-3 py-2">
                                <div className="flex items-center gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-content">{cam.name}</p>
                                        {a && a.active ? (
                                            <p className="text-xs text-status-warn">🎯 Bersenjata · {untilLabel(a)} · jeda {a.cooldown_sec}s · maks {a.max_per_hour}/jam</p>
                                        ) : (
                                            <p className="text-xs text-content-subtle">{a ? 'nonaktif' : 'belum dipersenjatai'}</p>
                                        )}
                                    </div>
                                    {a && a.active ? (
                                        <button type="button" onClick={() => disarmCam(cam)} className="shrink-0 rounded-control border border-status-fault/40 px-3 py-1.5 text-sm font-medium text-status-fault hover:bg-status-fault/10">Copot</button>
                                    ) : (
                                        <button type="button" onClick={() => openEditor(cam)} className="shrink-0 rounded-control border border-edge px-3 py-1.5 text-sm font-medium text-content-muted hover:border-edge-strong hover:text-content">Persenjatai…</button>
                                    )}
                                </div>
                                {isEditing && (
                                    <div className="mt-2 space-y-2 border-t border-edge pt-2">
                                        <Field as="select" label="Audio pengusir" value={form.clip_id} onChange={(e) => setForm({ ...form, clip_id: e.target.value })}>
                                            <option value="">— pilih audio —</option>
                                            {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </Field>
                                        <div className="grid grid-cols-3 gap-2">
                                            <Field type="number" label="Aktif (mnt)" min={0} max={1440} value={form.arm_minutes} onChange={(e) => setForm({ ...form, arm_minutes: e.target.value })} hint="0 = terus" />
                                            <Field type="number" label="Jeda (dtk)" min={10} max={3600} value={form.cooldown_sec} onChange={(e) => setForm({ ...form, cooldown_sec: e.target.value })} />
                                            <Field type="number" label="Maks/jam" min={1} max={60} value={form.max_per_hour} onChange={(e) => setForm({ ...form, max_per_hour: e.target.value })} />
                                        </div>
                                        <label className="block">
                                            <span className="mb-1 flex items-baseline justify-between"><span className="text-xs font-semibold text-content-muted">Volume</span><span className="text-xs tabular-nums text-content-subtle">{form.gain_db > 0 ? `+${form.gain_db}` : form.gain_db} dB</span></span>
                                            <input type="range" min="-6" max="12" step="1" value={form.gain_db || 0} onChange={(e) => setForm({ ...form, gain_db: parseInt(e.target.value, 10) || 0 })} className="w-full accent-status-warn" />
                                        </label>
                                        <div className="flex justify-end gap-2">
                                            <button type="button" onClick={() => setEditing(null)} className="rounded-control border border-edge px-3 py-1.5 text-sm font-medium text-content-muted">Batal</button>
                                            <button type="button" onClick={() => arm(cam)} className="rounded-control bg-status-warn px-3 py-1.5 text-sm font-semibold text-white hover:bg-status-warn/90">Persenjatai</button>
                                        </div>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
