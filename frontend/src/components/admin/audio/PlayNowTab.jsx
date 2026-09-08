/*
 * Purpose: "Putar Sekarang" tab — pick a clip or playlist, pick target cameras, and broadcast now.
 *   Shows a per-camera result so a camera without a working speaker is visible, not hidden.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService.playNow, CameraMultiSelect, audioFormatting, contexts, components/ui.
 * MainFuncs: PlayNowTab.
 * SideEffects: spawns a live broadcast to camera speakers via the API.
 */

import { useEffect, useState } from 'react';
import { playNow } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { Button, Field } from '../../ui';
import CameraMultiSelect from './CameraMultiSelect';
import { formatDuration } from './audioFormatting';

export default function PlayNowTab({ clips, playlists, cameras, preselect }) {
    const [sourceType, setSourceType] = useState('clip');
    const [sourceId, setSourceId] = useState('');
    const [cameraIds, setCameraIds] = useState([]);
    const [loop, setLoop] = useState(1);
    const [playing, setPlaying] = useState(false);
    const [results, setResults] = useState(null);
    const { showNotification } = useNotification();

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
        if (cameraIds.length === 0) {
            showNotification({ type: 'error', title: 'Pilih minimal satu kamera' });
            return;
        }
        setPlaying(true);
        setResults(null);
        const result = await playNow({ cameraIds, sourceType, sourceId: Number(sourceId), loop });
        setPlaying(false);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal memutar', message: result.message });
            return;
        }
        setResults(result.data?.results || []);
        const ok = (result.data?.results || []).filter((r) => r.ok).length;
        showNotification({
            type: ok > 0 ? 'success' : 'error',
            title: result.message || 'Selesai',
        });
    };

    return (
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
                <CameraMultiSelect cameras={cameras} value={cameraIds} onChange={setCameraIds} disabled={playing} />

                <Button variant="primary" onClick={handlePlay} loading={playing} className="w-full">
                    {playing ? 'Menyiarkan…' : 'Putar sekarang'}
                </Button>

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
    );
}
