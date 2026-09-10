/*
 * Purpose: "Putar Sekarang" tab — pick a clip or playlist, pick target cameras, and broadcast now.
 *   Shows a per-camera result so a camera without a working speaker is visible, not hidden.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService.playNow, CameraMultiSelect, audioFormatting, contexts, components/ui.
 * MainFuncs: PlayNowTab.
 * SideEffects: spawns a live broadcast to camera speakers via the API.
 */

import { useCallback, useEffect, useState } from 'react';
import { playNow, playDevices, getActivePlays, stopPlay, getPlayHistory } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Field } from '../../ui';
import CameraMultiSelect from './CameraMultiSelect';
import DeviceMultiSelect from './DeviceMultiSelect';
import { formatDuration } from './audioFormatting';

export default function PlayNowTab({ clips, playlists, cameras, preselect, groups, onSaveGroup, onDeleteGroup }) {
    const [sourceType, setSourceType] = useState('clip');
    const [sourceId, setSourceId] = useState('');
    const [cameraIds, setCameraIds] = useState([]);
    const [deviceIds, setDeviceIds] = useState([]);
    const [loop, setLoop] = useState(1);
    const [playing, setPlaying] = useState(false);
    const [results, setResults] = useState(null);
    const [active, setActive] = useState([]);
    const [history, setHistory] = useState([]);
    const [expanded, setExpanded] = useState(null);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const loadActive = useCallback(async () => {
        const r = await getActivePlays();
        if (r.success) setActive(r.data || []);
    }, []);

    const loadHistory = useCallback(async () => {
        const r = await getPlayHistory();
        if (r.success) setHistory(r.data || []);
    }, []);
    useEffect(() => { loadHistory(); }, [loadHistory]);

    // "Ulangi": load a past broadcast into the form, RE-RESOLVING targets to cameras still available now
    // (an out-of-scope / blocked / removed camera is dropped, never blindly replayed).
    const replay = (entry) => {
        const validIds = new Set(cameras.map((c) => c.id));
        setSourceType(entry.source_type);
        setSourceId(String(entry.source_id));
        setCameraIds((entry.camera_ids || []).filter((id) => validIds.has(id)));
        showNotification({ type: 'info', title: 'Dimuat ke form', message: 'Tinjau lalu tekan "Putar sekarang".' });
    };

    // Playback runs in the background (a 6-min song keeps going after the request returns), so poll the
    // "Sedang diputar" list — that's where the operator stops one they picked by mistake.
    useEffect(() => {
        loadActive();
        const t = setInterval(loadActive, 3000);
        return () => clearInterval(t);
    }, [loadActive]);

    const stopOne = async (cameraId) => {
        await stopPlay({ cameraId });
        await loadActive();
    };
    const stopEverything = async () => {
        await stopPlay({ all: true });
        await loadActive();
    };

    // A "Putar" tap in the library preselects that clip here and jumps to this tab.
    useEffect(() => {
        if (preselect?.id) {
            setSourceType('clip');
            setSourceId(String(preselect.id));
        }
    }, [preselect]);

    const options = sourceType === 'clip' ? clips : playlists;

    const handlePlay = async () => {
        if (!sourceId) {
            showNotification({ type: 'error', title: 'Pilih audio atau playlist dulu' });
            return;
        }
        if (cameraIds.length === 0 && deviceIds.length === 0) {
            showNotification({ type: 'error', title: 'Pilih minimal satu kamera atau titik speaker' });
            return;
        }
        setPlaying(true);
        setResults(null);
        let camOk = 0;
        if (cameraIds.length > 0) {
            // Wide blast / quiet-hours broadcasts come back as requiresConfirm — ask, then re-send with confirm.
            let result = await playNow({ cameraIds, sourceType, sourceId: Number(sourceId), loop });
            if (result.requiresConfirm) {
                const ok = await confirm({
                    title: 'Konfirmasi siaran',
                    message: result.message || 'Siaran ini butuh konfirmasi.',
                    confirmLabel: 'Siarkan sekarang',
                    cancelLabel: 'Batal',
                    tone: 'default',
                });
                if (!ok) { setPlaying(false); return; } // cancelled -> nothing fires (Titik Speaker included)
                result = await playNow({ cameraIds, sourceType, sourceId: Number(sourceId), loop, confirm: true });
            }
            if (!result.success) {
                setPlaying(false);
                showNotification({ type: 'error', title: 'Gagal memutar', message: result.message });
                return;
            }
            setResults(result.data?.results || []);
            camOk = (result.data?.results || []).filter((r) => r.ok).length;
        }
        let devN = 0;
        if (deviceIds.length > 0) {
            const dr = await playDevices({ deviceIds, sourceId: Number(sourceId), loop, sourceType });
            if (dr.success) devN = dr.data?.queued ?? deviceIds.length;
        }
        setPlaying(false);
        const parts = [];
        if (cameraIds.length) parts.push(`${camOk} kamera`);
        if (devN) parts.push(`${devN} titik speaker`);
        showNotification({ type: (camOk > 0 || devN > 0) ? 'success' : 'error', title: parts.length ? `Diputar ke ${parts.join(' + ')}` : 'Tak ada target aktif' });
        loadActive();
        loadHistory();
    };

    return (
        <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4 rounded-card border border-edge bg-surface p-4 shadow-e1">
                <div className="space-y-2">
                    <span className="text-xs font-semibold text-content-muted">Sumber</span>
                    <div className="flex gap-2">
                        {[['clip', 'Audio tunggal'], ['playlist', 'Playlist']].map(([val, label]) => (
                            <button
                                key={val}
                                type="button"
                                onClick={() => { setSourceType(val); setSourceId(''); }}
                                className={`flex-1 rounded-control border px-3 py-2 text-sm font-medium transition-colors ${
                                    sourceType === val
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-edge bg-surface text-content-muted hover:border-edge-strong'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <Field
                    as="select"
                    label={sourceType === 'clip' ? 'Pilih audio' : 'Pilih playlist'}
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                >
                    <option value="">— pilih —</option>
                    {options.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.name}
                            {sourceType === 'clip' && o.duration_sec ? ` (${formatDuration(o.duration_sec)})` : ''}
                            {sourceType === 'playlist' ? ` (${o.clip_count || 0} audio)` : ''}
                        </option>
                    ))}
                </Field>

                <Field
                    type="number"
                    label="Ulang berapa kali"
                    min={1}
                    max={20}
                    value={loop}
                    onChange={(e) => setLoop(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                    hint="Putar berulang, mis. sirene atau pengumuman singkat."
                />

            </div>

            <div className="space-y-4 rounded-card border border-edge bg-surface p-4 shadow-e1">
                <CameraMultiSelect
                    cameras={cameras}
                    value={cameraIds}
                    onChange={setCameraIds}
                    disabled={playing}
                    groups={groups}
                    onSaveGroup={onSaveGroup}
                    onDeleteGroup={onDeleteGroup}
                />

                <DeviceMultiSelect value={deviceIds} onChange={setDeviceIds} disabled={playing} hint="Titik Speaker (STB) tujuan siaran ini (boleh tanpa kamera)." />

                <Button variant="primary" onClick={handlePlay} loading={playing} className="w-full">
                    {playing ? 'Menyiarkan…' : 'Putar sekarang'}
                </Button>

                {/* Sedang diputar — stop a playback (e.g. a wrong pick) while it's still going. */}
                {active.length > 0 && (
                    <div className="space-y-1.5 rounded-control border border-status-live/30 bg-status-live/5 p-2">
                        <div className="flex items-center justify-between px-1">
                            <span className="text-xs font-semibold text-content">Sedang diputar ({active.length})</span>
                            <button type="button" onClick={stopEverything} className="text-xs font-medium text-status-fault hover:underline">
                                Hentikan semua
                            </button>
                        </div>
                        {active.map((a) => (
                            <div key={a.cameraId} className="flex items-center gap-2 rounded-control bg-surface px-3 py-2 text-sm">
                                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-status-live" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate text-content">{a.name}</span>
                                <span className="shrink-0 font-mono text-xs tabular-nums text-content-subtle">{formatDuration(a.seconds)}</span>
                                <button
                                    type="button"
                                    onClick={() => stopOne(a.cameraId)}
                                    className="shrink-0 rounded-control border border-status-fault/40 px-2.5 py-1 text-xs font-medium text-status-fault transition-colors hover:bg-status-fault/10"
                                >
                                    Stop
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {results && (
                    <ul className="space-y-1.5">
                        {results.map((r) => (
                            <li
                                key={r.cameraId}
                                className="flex items-center gap-2 rounded-control border border-edge bg-surface-sunken px-3 py-2 text-sm"
                            >
                                <span
                                    className={`h-2 w-2 shrink-0 rounded-full ${r.ok ? 'bg-status-live' : 'bg-status-fault'}`}
                                    aria-hidden="true"
                                />
                                <span className="min-w-0 flex-1 truncate text-content">{r.name}</span>
                                <span className={`shrink-0 text-xs ${r.ok ? 'text-content-muted' : 'text-status-fault'}`}>
                                    {r.ok ? 'Terkirim' : r.message}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>

        {/* Riwayat siaran + bukti kirim per-titik + Ulangi. */}
        {history.length > 0 && (
            <section className="space-y-2 rounded-card border border-edge bg-surface p-4 shadow-e1">
                <h3 className="text-sm font-semibold text-content">Riwayat siaran</h3>
                <ul className="space-y-1.5">
                    {history.map((h) => (
                        <li key={h.id} className="rounded-control border border-edge bg-surface-sunken px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${h.ok_count === h.total_count ? 'bg-status-live' : h.ok_count > 0 ? 'bg-status-warn' : 'bg-status-fault'}`} aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate text-content">{h.source_name || `#${h.source_id}`}{h.source_type === 'playlist' ? ' (playlist)' : ''}</span>
                                <span className="shrink-0 text-xs text-content-muted">{h.ok_count}/{h.total_count} berhasil</span>
                                <button type="button" onClick={() => setExpanded(expanded === h.id ? null : h.id)} className="shrink-0 text-xs font-medium text-content-muted hover:underline">
                                    {expanded === h.id ? 'Tutup' : 'Rincian'}
                                </button>
                                <button type="button" onClick={() => replay(h)} className="shrink-0 rounded-control border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:border-primary">
                                    Ulangi
                                </button>
                            </div>
                            {expanded === h.id && (
                                <ul className="mt-1.5 space-y-1 border-t border-edge pt-1.5">
                                    {h.results.map((r) => (
                                        <li key={r.cameraId} className="flex items-center gap-2 text-xs">
                                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.ok ? 'bg-status-live' : 'bg-status-fault'}`} aria-hidden="true" />
                                            <span className="min-w-0 flex-1 truncate text-content-muted">{r.name}</span>
                                            <span className={`shrink-0 ${r.ok ? 'text-content-subtle' : 'text-status-fault'}`}>{r.ok ? 'berbunyi' : r.message}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    ))}
                </ul>
            </section>
        )}
        </div>
    );
}
