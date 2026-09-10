/*
 * Purpose: "Panel" tab — a soundboard of big one-tap buttons. Each button is a saved shortcut (a clip/
 *   playlist + target cameras + loop) an operator fires with a single tap from their phone (adzan opener,
 *   sirene, routine announcement). Firing reuses the normal play path, so the wide/quiet confirm guard
 *   still applies. A "Kelola" mode adds/edits/deletes buttons.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService (soundboard CRUD + playNow), CameraMultiSelect, contexts, components/ui.
 * MainFuncs: SoundboardTab.
 * SideEffects: broadcasts to camera speakers on tap; writes soundboard buttons via the API.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    getSoundboard, createSoundboardButton, updateSoundboardButton, deleteSoundboardButton, playNow,
} from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Field, EmptyState } from '../../ui';
import CameraMultiSelect from './CameraMultiSelect';

const BLANK = { id: null, label: '', sourceType: 'clip', sourceId: '', cameraIds: [], loop: 1, gain_db: 0 };

export default function SoundboardTab({ clips, playlists, cameras }) {
    const [buttons, setButtons] = useState([]);
    const [manage, setManage] = useState(false);
    const [form, setForm] = useState(null); // null = closed; BLANK/existing = editing
    const [firing, setFiring] = useState(null); // button id currently firing
    const [saving, setSaving] = useState(false);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const load = useCallback(async () => {
        const r = await getSoundboard();
        if (r.success) setButtons(r.data || []);
    }, []);
    useEffect(() => { load(); }, [load]);

    const options = (t) => (t === 'clip' ? clips : playlists);
    const sourceName = (btn) => {
        const list = btn.source_type === 'clip' ? clips : playlists;
        return list.find((o) => o.id === btn.source_id)?.name || `#${btn.source_id}`;
    };

    // Fire a button — same wide/quiet confirm flow as Putar Sekarang.
    const fire = async (btn) => {
        if (!btn.camera_ids || btn.camera_ids.length === 0) {
            showNotification({ type: 'error', title: 'Tombol belum punya kamera', message: 'Ubah tombol & pilih kamera.' });
            return;
        }
        setFiring(btn.id);
        // gainDb intentionally omitted: runtime volume is not controllable on the deployed cameras (loudness is
        // locked in firmware), so the whole gain path is dormant and playNow drops it anyway.
        const req = { cameraIds: btn.camera_ids, sourceType: btn.source_type, sourceId: btn.source_id, loop: btn.loop };
        let result = await playNow(req);
        if (result.requiresConfirm) {
            const ok = await confirm({ title: 'Konfirmasi siaran', message: result.message, confirmLabel: 'Siarkan sekarang', cancelLabel: 'Batal', tone: 'default' });
            if (!ok) { setFiring(null); return; }
            result = await playNow({ ...req, confirm: true });
        }
        setFiring(null);
        if (!result.success) { showNotification({ type: 'error', title: 'Gagal', message: result.message }); return; }
        const ok = (result.data?.results || []).filter((r) => r.ok).length;
        showNotification({ type: ok > 0 ? 'success' : 'error', title: `${btn.label}: ${result.message || 'Selesai'}` });
    };

    const save = async () => {
        if (!form.label.trim()) { showNotification({ type: 'error', title: 'Isi label dulu' }); return; }
        if (!form.sourceId) { showNotification({ type: 'error', title: 'Pilih sumber audio dulu' }); return; }
        setSaving(true);
        const payload = {
            label: form.label.trim(), sourceType: form.sourceType, sourceId: Number(form.sourceId),
            cameraIds: form.cameraIds, loop: form.loop, gain_db: form.gain_db,
        };
        const r = form.id ? await updateSoundboardButton(form.id, payload) : await createSoundboardButton(payload);
        setSaving(false);
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        setForm(null);
        load();
    };

    const remove = async (btn) => {
        const ok = await confirm({ title: 'Hapus tombol?', message: `"${btn.label}" akan dihapus.`, confirmLabel: 'Hapus', cancelLabel: 'Batal', tone: 'danger' });
        if (!ok) return;
        const r = await deleteSoundboardButton(btn.id);
        if (r.success) load(); else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-content">Panel siaran cepat</h3>
                    <p className="mt-0.5 text-xs text-content-muted">Satu tap = siaran yang sering dipakai. Tetap lewat konfirmasi bila luas / jam tenang.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => setManage((v) => !v)}>{manage ? 'Selesai' : 'Kelola'}</Button>
                    {manage && <Button onClick={() => setForm({ ...BLANK })}>+ Tombol</Button>}
                </div>
            </div>

            {form && (
                <div className="space-y-3 rounded-card border border-edge bg-surface-sunken p-3">
                    <Field label="Label tombol" value={form.label} maxLength={40} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="mis. Sirene / Adzan / Panggilan" />
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
                        <Field as="select" label={form.sourceType === 'clip' ? 'Pilih audio' : 'Pilih playlist'} value={form.sourceId} onChange={(e) => setForm({ ...form, sourceId: e.target.value })}>
                            <option value="">— pilih —</option>
                            {options(form.sourceType).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </Field>
                    </div>
                    <Field type="number" label="Ulang berapa kali" min={1} max={20} value={form.loop} onChange={(e) => setForm({ ...form, loop: Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)) })} />
                    <CameraMultiSelect cameras={cameras} value={form.cameraIds} onChange={(ids) => setForm({ ...form, cameraIds: ids })} />
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setForm(null)} className="rounded-control border border-edge px-3 py-1.5 text-sm font-medium text-content-muted">Batal</button>
                        <Button variant="primary" loading={saving} onClick={save}>Simpan</Button>
                    </div>
                </div>
            )}

            {buttons.length === 0 && !form ? (
                <EmptyState title="Belum ada tombol" description="Tekan Kelola → + Tombol untuk membuat pintasan siaran satu-tap." />
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {buttons.map((btn) => (
                        <div key={btn.id} className="relative">
                            <button
                                type="button"
                                onClick={() => fire(btn)}
                                disabled={firing === btn.id}
                                className="flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-card border-2 border-primary bg-primary/10 p-3 text-center transition-colors hover:bg-primary/20 disabled:opacity-60"
                            >
                                <span className="break-words text-sm font-semibold text-primary">{firing === btn.id ? 'Menyiarkan…' : btn.label}</span>
                                <span className="text-xs text-content-subtle">{sourceName(btn)} · {btn.camera_ids.length} kamera{btn.loop > 1 ? ` · ${btn.loop}×` : ''}</span>
                            </button>
                            {manage && (
                                <div className="mt-1 flex justify-center gap-2">
                                    <button type="button" onClick={() => setForm({ id: btn.id, label: btn.label, sourceType: btn.source_type, sourceId: String(btn.source_id), cameraIds: btn.camera_ids, loop: btn.loop, gain_db: btn.gain_db })} className="text-xs font-medium text-content-muted hover:underline">Ubah</button>
                                    <button type="button" onClick={() => remove(btn)} className="text-xs font-medium text-status-fault hover:underline">Hapus</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
