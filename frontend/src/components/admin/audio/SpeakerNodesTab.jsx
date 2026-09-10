/*
 * Purpose: "Titik Speaker" tab — manage network speaker nodes (STB/Armbian + amp + TOA horn) that receive
 *   broadcasts over the LAN for spots where no camera has a speaker. Create a node (get its token once +
 *   a ready-to-paste agent config), see online/offline, test-play a clip, and broadcast a clip to selected
 *   nodes. The node runs backend/scripts/audio_node.py and PULLS commands with its token.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService (device APIs), contexts, components/ui.
 * MainFuncs: SpeakerNodesTab.
 * SideEffects: creates/updates/deletes nodes; enqueues test/broadcast commands.
 */

import { useCallback, useEffect, useState } from 'react';
import { getDevices, createDevice, updateDevice, deleteDevice, regenDeviceToken, testDevice, playDevices } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Field, EmptyState } from '../../ui';

export default function SpeakerNodesTab({ clips = [], areas = [] }) {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newName, setNewName] = useState('');
    const [newArea, setNewArea] = useState('');
    const [creating, setCreating] = useState(false);
    const [reveal, setReveal] = useState(null); // { id, name, token } shown ONCE after create/regen
    const [testClip, setTestClip] = useState('');
    const [selected, setSelected] = useState([]);
    const [loop, setLoop] = useState(1);
    const [busy, setBusy] = useState('');
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const hubOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://HUB';

    const load = useCallback(async () => {
        const r = await getDevices();
        if (r.success) setDevices(r.data || []);
        setLoading(false);
    }, []);
    useEffect(() => {
        load();
        const t = setInterval(load, 8000); // refresh online status
        return () => clearInterval(t);
    }, [load]);

    const add = async () => {
        if (!newName.trim()) { showNotification({ type: 'error', title: 'Isi nama titik speaker' }); return; }
        setCreating(true);
        const r = await createDevice({ name: newName.trim(), areaId: newArea || null });
        setCreating(false);
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        setReveal({ id: r.data.id, name: r.data.name, token: r.data.token });
        setNewName(''); setNewArea('');
        load();
    };

    const toggleEnabled = async (d) => {
        const r = await updateDevice(d.id, { enabled: d.enabled ? 0 : 1 });
        if (r.success) load(); else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };

    const regen = async (d) => {
        const ok = await confirm({ title: 'Token baru?', message: `Token lama "${d.name}" akan berhenti berlaku. Agen di STB harus diisi token baru.`, confirmLabel: 'Buat token baru', cancelLabel: 'Batal', tone: 'danger' });
        if (!ok) return;
        const r = await regenDeviceToken(d.id);
        if (r.success) { setReveal({ id: d.id, name: d.name, token: r.data.token }); }
        else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };

    const remove = async (d) => {
        const ok = await confirm({ title: 'Hapus titik speaker?', message: `"${d.name}" akan dihapus.`, confirmLabel: 'Hapus', cancelLabel: 'Batal', tone: 'danger' });
        if (!ok) return;
        const r = await deleteDevice(d.id);
        if (r.success) load(); else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };

    const test = async (d) => {
        if (!testClip) { showNotification({ type: 'error', title: 'Pilih audio uji dulu (di bawah)' }); return; }
        setBusy(`test-${d.id}`);
        const r = await testDevice(d.id, Number(testClip));
        setBusy('');
        showNotification({ type: r.success ? 'success' : 'error', title: d.name, message: r.message });
    };

    const broadcast = async () => {
        if (!testClip) { showNotification({ type: 'error', title: 'Pilih audio dulu' }); return; }
        if (selected.length === 0) { showNotification({ type: 'error', title: 'Pilih titik speaker' }); return; }
        setBusy('broadcast');
        const r = await playDevices({ deviceIds: selected, sourceId: Number(testClip), loop });
        setBusy('');
        showNotification({ type: r.success ? 'success' : 'error', title: 'Siaran', message: r.message });
    };

    const copy = (text) => {
        // writeText returns a Promise — a sync try/catch misses its rejection (blocked/insecure context) and
        // would show a false "Disalin". Confirm only on resolve; tell the operator to copy manually on failure.
        const fail = () => showNotification({ type: 'error', title: 'Gagal menyalin', message: 'Salin manual dari kotak di atas.' });
        if (!navigator.clipboard?.writeText) { fail(); return; }
        navigator.clipboard.writeText(text)
            .then(() => showNotification({ type: 'success', title: 'Disalin' }))
            .catch(fail);
    };
    const toggleSel = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

    const confSnippet = (token) => `HUB_URL=${hubOrigin}\nTOKEN=${token}\nPLAYER=aplay`;

    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-sm font-semibold text-content">📻 Titik Speaker (STB + amp + TOA)</h3>
                <p className="mt-0.5 text-xs text-content-muted">Speaker jaringan untuk tempat yang kameranya belum punya speaker. STB menjalankan agen <span className="font-mono">audio_node.py</span> dan menarik siaran dengan token-nya.</p>
                <p className="mt-1 text-xs text-primary">ℹ️ Titik speaker <span className="font-semibold">otomatis ikut</span> siaran yang menyasar <span className="font-semibold">area</span>-nya: adzan/qori, jadwal, &amp; darurat. Pasang area di bawah agar ikut — kosongkan area bila hanya mau disiarkan manual dari tab ini.</p>
            </div>

            {/* Token reveal (shown ONCE) */}
            {reveal && (
                <div className="space-y-2 rounded-card border-2 border-status-warn/50 bg-status-warn/10 p-3">
                    <p className="text-sm font-semibold text-content">Token untuk “{reveal.name}” — salin sekarang, hanya ditampilkan sekali.</p>
                    <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-control border border-edge bg-surface px-2 py-1 font-mono text-xs text-content">{reveal.token}</code>
                        <button type="button" onClick={() => copy(reveal.token)} className="shrink-0 rounded-control border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-content-muted hover:border-edge-strong">Salin token</button>
                    </div>
                    <p className="text-xs text-content-muted">Isi <span className="font-mono">/etc/rafnet-speaker.conf</span> di STB:</p>
                    <pre className="overflow-x-auto rounded-control border border-edge bg-surface p-2 font-mono text-xs text-content-muted">{confSnippet(reveal.token)}</pre>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => copy(confSnippet(reveal.token))} className="rounded-control border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-content-muted hover:border-edge-strong">Salin konfigurasi</button>
                        <button type="button" onClick={() => setReveal(null)} className="rounded-control border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-content-subtle hover:border-edge-strong">Sudah disalin</button>
                    </div>
                </div>
            )}

            {/* Add */}
            <div className="grid grid-cols-1 gap-3 rounded-card border border-edge bg-surface p-4 shadow-e1 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Nama titik speaker" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="mis. Speaker Pos Ronda RT 03" maxLength={80} />
                <Field as="select" label="Area (opsional)" value={newArea} onChange={(e) => setNewArea(e.target.value)}>
                    <option value="">— tanpa area —</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Field>
                <Button variant="primary" loading={creating} onClick={add} disabled={!newName.trim()}>+ Tambah</Button>
            </div>

            {/* Device list */}
            {loading ? (
                <p className="text-sm text-content-muted">Memuat…</p>
            ) : devices.length === 0 ? (
                <EmptyState title="Belum ada titik speaker" description="Tambah satu di atas, lalu jalankan audio_node.py di STB dengan token-nya." />
            ) : (
                <ul className="space-y-2">
                    {devices.map((d) => (
                        <li key={d.id} className={`flex flex-wrap items-center gap-2 rounded-card border p-3 shadow-e1 ${d.enabled ? 'border-edge bg-surface' : 'border-dashed border-edge bg-surface-sunken opacity-70'}`}>
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.online ? 'bg-status-live' : 'bg-edge-strong'}`} title={d.online ? 'online' : 'offline'} aria-hidden="true" />
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggleSel(d.id)} className="h-4 w-4 accent-primary" />
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-semibold text-content">{d.name}</span>
                                    <span className="block text-xs text-content-subtle">{d.online ? 'online' : 'offline'}{d.area_name ? ` · ${d.area_name}` : ''}{d.enabled ? '' : ' · nonaktif'}</span>
                                </span>
                            </label>
                            <button type="button" onClick={() => test(d)} disabled={busy === `test-${d.id}` || !testClip} title={testClip ? 'Putar audio uji ke titik ini' : 'Pilih audio uji dulu'} className="shrink-0 rounded-control border border-edge bg-surface px-2.5 py-1.5 text-sm font-medium text-content-muted hover:border-primary hover:text-primary disabled:opacity-40">{busy === `test-${d.id}` ? '…' : '🔊 Uji'}</button>
                            <button type="button" onClick={() => toggleEnabled(d)} className="shrink-0 rounded-control border border-edge bg-surface px-2.5 py-1.5 text-xs font-medium text-content-muted hover:border-edge-strong">{d.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button>
                            <button type="button" onClick={() => regen(d)} className="shrink-0 rounded-control border border-edge bg-surface px-2.5 py-1.5 text-xs font-medium text-content-muted hover:border-edge-strong">Token baru</button>
                            <button type="button" onClick={() => remove(d)} className="shrink-0 rounded-control border border-edge bg-surface px-2.5 py-1.5 text-xs font-medium text-status-fault hover:border-status-fault/40">Hapus</button>
                        </li>
                    ))}
                </ul>
            )}

            {/* Broadcast / test source */}
            <div className="flex flex-wrap items-end gap-2 rounded-card border border-edge bg-surface-sunken p-3">
                <div className="min-w-0 flex-1">
                    <span className="mb-1 block text-xs font-semibold text-content-muted">Audio (untuk Uji &amp; Siaran)</span>
                    <select value={testClip} onChange={(e) => setTestClip(e.target.value)} className="w-full rounded-control border border-edge bg-surface px-2 py-1.5 text-sm text-content">
                        <option value="">— pilih audio —</option>
                        {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <Field type="number" label="Ulang" min={1} max={20} value={loop} onChange={(e) => setLoop(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)))} />
                <Button variant="primary" loading={busy === 'broadcast'} onClick={broadcast} disabled={!testClip || selected.length === 0}>Siarkan ke terpilih ({selected.length})</Button>
            </div>

            <details className="rounded-card border border-edge bg-surface p-3 text-xs text-content-muted">
                <summary className="cursor-pointer font-medium text-content">Cara pasang di STB (Armbian)</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-4">
                    <li>Salin <span className="font-mono">backend/scripts/audio_node.py</span> ke STB (mis. <span className="font-mono">/opt/rafnet/</span>).</li>
                    <li>Pasang pemutar: <span className="font-mono">apt install alsa-utils</span> (untuk <span className="font-mono">aplay</span>).</li>
                    <li>Buat <span className="font-mono">/etc/rafnet-speaker.conf</span> berisi HUB_URL + TOKEN (dari token di atas).</li>
                    <li>Colok line-out 3.5mm STB → input TPA3116D2 → TOA (8Ω). Tes: <span className="font-mono">HUB_URL=… TOKEN=… python3 audio_node.py</span>.</li>
                    <li>Jadikan service systemd (contoh unit ada di header <span className="font-mono">audio_node.py</span>) agar jalan otomatis.</li>
                </ol>
            </details>
        </div>
    );
}
