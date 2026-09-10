/*
 * Purpose: Emergency broadcast bar — big red one-tap "panic" buttons (banjir/kebakaran) that PREEMPT
 *   whatever is playing and bypass quiet hours, plus a prominent "HENTIKAN SEMUA" kill-switch. Firing
 *   always double-confirms so it can never go off by accident. A "Kelola" mode manages presets.
 * Caller: pages/AudioBroadcast.jsx (top of the Panel tab).
 * Deps: audioService (emergency CRUD + fire, stopPlay), CameraMultiSelect, contexts, components/ui.
 * MainFuncs: EmergencyPanel.
 * SideEffects: fires preempting broadcasts; stops all playback.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    getEmergencyPresets, createEmergencyPreset, updateEmergencyPreset, deleteEmergencyPreset, playEmergency, stopPlay,
} from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Field } from '../../ui';
import CameraMultiSelect from './CameraMultiSelect';

const BLANK = { id: null, label: '', sourceType: 'clip', sourceId: '', targetKind: 'area', areaId: '', cameraIds: [], loop: 3, gain_db: 0, siren: false };

export default function EmergencyPanel({ clips, playlists, cameras, areas }) {
    const [presets, setPresets] = useState([]);
    const [manage, setManage] = useState(false);
    const [form, setForm] = useState(null);
    const [firing, setFiring] = useState(null);
    const [saving, setSaving] = useState(false);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const load = useCallback(async () => {
        const r = await getEmergencyPresets();
        if (r.success) setPresets(r.data || []);
    }, []);
    useEffect(() => { load(); }, [load]);

    const options = (t) => (t === 'clip' ? clips : playlists);
    const targetLabel = (p) => (p.target_kind === 'area'
        ? (areas.find((a) => a.id === p.area_id)?.name || `area #${p.area_id}`)
        : `${p.camera_ids.length} kamera`);

    // Emergency resolves to SUPPORTED cameras only (a "needs test" camera is dropped). Catch a preset that
    // would resolve to zero BEFORE the operator commits to the big red confirm, instead of failing after.
    const isSupported = (id) => cameras.find((c) => c.id === id)?.supports_audio_out === 1;
    const selectedSupported = form && form.targetKind === 'cameras' ? form.cameraIds.filter(isSupported).length : null;

    const fire = async (p) => {
        if (p.target_kind === 'cameras' && p.camera_ids.filter(isSupported).length === 0) {
            showNotification({ type: 'error', title: 'Tak ada kamera didukung', message: 'Preset ini tak punya kamera yang terbukti bersuara. Ubah preset atau uji kameranya dulu di tab Kamera & Area.' });
            return;
        }
        const ok = await confirm({
            title: '🚨 Siaran DARURAT',
            message: `Siarkan "${p.label}" ke ${targetLabel(p)} SEKARANG? Ini menghentikan siaran lain & mengabaikan jam tenang.${p.siren ? ' Sirene juga akan MENYALA.' : ''}`,
            confirmLabel: 'YA, SIARKAN DARURAT', cancelLabel: 'Batal', tone: 'danger',
        });
        if (!ok) return;
        setFiring(p.id);
        const result = await playEmergency({
            sourceType: p.source_type, sourceId: p.source_id, targetKind: p.target_kind,
            areaId: p.area_id, cameraIds: p.camera_ids, loop: p.loop, gainDb: p.gain_db, siren: Boolean(p.siren), confirm: true,
        });
        setFiring(null);
        if (!result.success) { showNotification({ type: 'error', title: 'Gagal', message: result.message }); return; }
        const okc = (result.data?.results || []).filter((r) => r.ok).length;
        showNotification({ type: okc > 0 ? 'success' : 'error', title: result.message || 'DARURAT terkirim' });
    };

    const killAll = async () => {
        const ok = await confirm({ title: 'Hentikan SEMUA siaran?', message: 'Semua audio yang sedang diputar akan dihentikan.', confirmLabel: 'Hentikan semua', cancelLabel: 'Batal', tone: 'danger' });
        if (!ok) return;
        const r = await stopPlay({ all: true });
        showNotification({ type: r.success ? 'success' : 'error', title: r.message || (r.success ? 'Dihentikan' : 'Gagal') });
    };

    const save = async () => {
        if (!form.label.trim()) { showNotification({ type: 'error', title: 'Isi label dulu' }); return; }
        if (!form.sourceId) { showNotification({ type: 'error', title: 'Pilih audio dulu' }); return; }
        if (form.targetKind === 'area' && !form.areaId) { showNotification({ type: 'error', title: 'Pilih area target' }); return; }
        if (form.targetKind === 'cameras' && form.cameraIds.length === 0) { showNotification({ type: 'error', title: 'Pilih minimal satu kamera' }); return; }
        setSaving(true);
        const payload = {
            label: form.label.trim(), sourceType: form.sourceType, sourceId: Number(form.sourceId),
            targetKind: form.targetKind, areaId: form.targetKind === 'area' ? Number(form.areaId) : null,
            cameraIds: form.cameraIds, loop: form.loop, gain_db: form.gain_db, siren: Boolean(form.siren),
        };
        const r = form.id ? await updateEmergencyPreset(form.id, payload) : await createEmergencyPreset(payload);
        setSaving(false);
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        setForm(null);
        load();
    };

    const remove = async (p) => {
        const ok = await confirm({ title: 'Hapus preset darurat?', message: `"${p.label}" akan dihapus.`, confirmLabel: 'Hapus', cancelLabel: 'Batal', tone: 'danger' });
        if (!ok) return;
        const r = await deleteEmergencyPreset(p.id);
        if (r.success) load(); else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };

    return (
        <section className="space-y-3 rounded-card border-2 border-status-fault/40 bg-status-fault/5 p-4">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-bold text-status-fault">🚨 Darurat</h3>
                    <p className="mt-0.5 text-xs text-content-muted">Satu tap = siaran mendesak; menghentikan siaran lain & lewati jam tenang. Selalu dikonfirmasi.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={killAll} className="rounded-control border-2 border-status-fault bg-status-fault/10 px-3 py-2 text-sm font-bold text-status-fault transition-colors hover:bg-status-fault/20">
                        ⏹ HENTIKAN SEMUA
                    </button>
                    <Button variant="secondary" onClick={() => setManage((v) => !v)}>{manage ? 'Selesai' : 'Kelola'}</Button>
                    {manage && <Button onClick={() => setForm({ ...BLANK })}>+ Preset</Button>}
                </div>
            </div>

            {form && (
                <div className="space-y-3 rounded-card border border-edge bg-surface p-3">
                    <Field label="Label" value={form.label} maxLength={40} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="mis. Banjir / Kebakaran" />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <span className="mb-1.5 block text-xs font-semibold text-content-muted">Sumber</span>
                            <div className="flex gap-2">
                                {[['clip', 'Audio'], ['playlist', 'Playlist']].map(([val, lbl]) => (
                                    <button key={val} type="button" onClick={() => setForm({ ...form, sourceType: val, sourceId: '' })}
                                        className={`flex-1 rounded-control border px-3 py-2 text-sm font-medium transition-colors ${form.sourceType === val ? 'border-primary bg-primary/10 text-primary' : 'border-edge bg-surface text-content-muted hover:border-edge-strong'}`}>
                                        {lbl}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <Field as="select" label="Pilih audio" value={form.sourceId} onChange={(e) => setForm({ ...form, sourceId: e.target.value })}>
                            <option value="">— pilih —</option>
                            {options(form.sourceType).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <span className="mb-1.5 block text-xs font-semibold text-content-muted">Target</span>
                            <div className="flex gap-2">
                                {[['area', 'Seluruh area'], ['cameras', 'Kamera pilihan']].map(([val, lbl]) => (
                                    <button key={val} type="button" onClick={() => setForm({ ...form, targetKind: val })}
                                        className={`flex-1 rounded-control border px-3 py-2 text-sm font-medium transition-colors ${form.targetKind === val ? 'border-primary bg-primary/10 text-primary' : 'border-edge bg-surface text-content-muted hover:border-edge-strong'}`}>
                                        {lbl}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <Field type="number" label="Ulang" min={1} max={20} value={form.loop} onChange={(e) => setForm({ ...form, loop: Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)) })} />
                    </div>
                    {form.targetKind === 'area' ? (
                        <Field as="select" label="Area" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
                            <option value="">— pilih area —</option>
                            {areas.filter((a) => a.audio_broadcast_enabled).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </Field>
                    ) : (
                        <div className="space-y-1.5">
                            <CameraMultiSelect cameras={cameras} value={form.cameraIds} onChange={(ids) => setForm({ ...form, cameraIds: ids })} />
                            {form.cameraIds.length > 0 && selectedSupported === 0 && (
                                <p className="text-xs text-status-warn">⚠ Tak ada kamera yang terbukti bersuara di pilihan ini — darurat akan gagal. Pilih kamera berstatus “didukung”, atau uji dulu di tab Kamera &amp; Area.</p>
                            )}
                            {form.cameraIds.length > 0 && selectedSupported > 0 && selectedSupported < form.cameraIds.length && (
                                <p className="text-xs text-content-subtle">{selectedSupported}/{form.cameraIds.length} kamera terbukti bersuara; sisanya akan dilewati saat darurat.</p>
                            )}
                        </div>
                    )}
                    <label className="flex cursor-pointer items-center gap-2 rounded-control border border-status-fault/30 bg-status-fault/5 px-3 py-2 text-sm text-content">
                        <input type="checkbox" checked={!!form.siren} onChange={(e) => setForm({ ...form, siren: e.target.checked })} className="h-4 w-4 accent-status-fault" />
                        🔊 Nyalakan sirene juga saat darurat (kamera ber-SN IMOU) — mati otomatis
                    </label>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setForm(null)} className="rounded-control border border-edge px-3 py-1.5 text-sm font-medium text-content-muted">Batal</button>
                        <Button variant="primary" loading={saving} onClick={save}>Simpan</Button>
                    </div>
                </div>
            )}

            {presets.length === 0 && !form ? (
                <p className="text-xs text-content-subtle">Belum ada preset darurat. Tekan Kelola → + Preset untuk membuat (mis. sirene banjir ke seluruh dusun).</p>
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {presets.map((p) => (
                        <div key={p.id}>
                            <button type="button" onClick={() => fire(p)} disabled={firing === p.id}
                                className="flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-card border-2 border-status-fault bg-status-fault/10 p-3 text-center transition-colors hover:bg-status-fault/20 disabled:opacity-60">
                                <span className="break-words text-sm font-bold text-status-fault">{firing === p.id ? 'MENYIARKAN…' : p.label}</span>
                                <span className="text-xs text-content-subtle">{targetLabel(p)} · {p.loop}×</span>
                            </button>
                            {manage && (
                                <div className="mt-1 flex justify-center gap-2">
                                    <button type="button" onClick={() => setForm({ id: p.id, label: p.label, sourceType: p.source_type, sourceId: String(p.source_id), targetKind: p.target_kind, areaId: p.area_id ? String(p.area_id) : '', cameraIds: p.camera_ids, loop: p.loop, gain_db: p.gain_db, siren: !!p.siren })} className="text-xs font-medium text-content-muted hover:underline">Ubah</button>
                                    <button type="button" onClick={() => remove(p)} className="text-xs font-medium text-status-fault hover:underline">Hapus</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
