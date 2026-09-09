/*
 * Purpose: "Kamera & Area" tab — pick which LOCAL areas can receive broadcasts (allowlist), and see per
 *   camera whether its ONVIF speaker backchannel is supported (tri-state), with a silent re-check.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService (areas + capability), audioFormatting.capabilityInfo, contexts, components/ui.
 * MainFuncs: TargetsTab.
 * SideEffects: toggles areas.audio_broadcast_enabled; spawns silent DESCRIBE probes (no sound) on recheck.
 *
 * Why an area allowlist: 394 of 414 internal-RTSP cameras are remote Surabaya feeds. Scoping by area
 * (default OFF) keeps them out deterministically, and means the capability probe only ever runs on the
 * handful of local cameras an operator opts in — never the remote fleet.
 */

import { useEffect, useState } from 'react';
import { toggleArea, recheckCameraCapability, recheckCapability, setCameraBlocked } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { Button, EmptyState } from '../../ui';
import { capabilityInfo } from './audioFormatting';

function Badge({ supports, blocked }) {
    if (blocked) {
        return <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-fault/30 bg-status-fault/10 px-2 py-0.5 text-xs font-medium text-status-fault">⛔ Diblokir</span>;
    }
    const info = capabilityInfo(supports);
    const cls = info.tone === 'live'
        ? 'border-status-live/30 bg-status-live/10 text-status-live'
        : info.tone === 'muted'
            ? 'border-edge bg-surface-sunken text-content-subtle'
            : 'border-status-warn/30 bg-status-warn/10 text-status-warn';
    return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{info.label}</span>;
}

export default function TargetsTab({ areas, capability, loading, reloadAreas, reloadCapability }) {
    const [busyArea, setBusyArea] = useState(null);
    const [rechecking, setRechecking] = useState(null); // cameraId | 'all'
    const { showNotification } = useNotification();

    // The probe runs in the BACKGROUND (initial sweep / after enabling an area / manual recheck), so poll
    // while this tab is open to let capability results ("Didukung"/"Tak didukung") land on their own.
    useEffect(() => {
        const t = setInterval(() => { reloadCapability(); }, 6000);
        return () => clearInterval(t);
    }, [reloadCapability]);

    const onToggleArea = async (area) => {
        setBusyArea(area.id);
        const result = await toggleArea(area.id, !area.audio_broadcast_enabled);
        setBusyArea(null);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal mengubah area', message: result.message });
            return;
        }
        await Promise.all([reloadAreas(), reloadCapability()]);
    };

    const onRecheckOne = async (cam) => {
        setRechecking(cam.id);
        const result = await recheckCameraCapability(cam.id);
        setRechecking(null);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal memeriksa', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: cam.name, message: `Hasil: ${result.data?.verdict}` });
        await reloadCapability();
    };

    const onToggleBlock = async (cam) => {
        const nextBlocked = !cam.audio_out_blocked;
        // Unblocking a hang-prone device is the risky direction — confirm it.
        if (!nextBlocked && !window.confirm(`"${cam.name}" ditandai rawan hang (mis. V380). Lepas blokir & izinkan audio lagi?`)) return;
        setRechecking(`block-${cam.id}`);
        const result = await setCameraBlocked(cam.id, nextBlocked);
        setRechecking(null);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal', message: result.message });
            return;
        }
        showNotification({ type: nextBlocked ? 'warning' : 'success', title: nextBlocked ? 'Kamera diblokir' : 'Blokir dilepas', message: cam.name });
        await reloadCapability();
    };

    const onRecheckAll = async () => {
        setRechecking('all');
        const result = await recheckCapability();
        setRechecking(null);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal memeriksa', message: result.message });
            return;
        }
        // Runs in the background now; results land via the poll above.
        showNotification({ type: 'info', title: 'Pemeriksaan dimulai', message: 'Hasil muncul bertahap di bawah.' });
        await reloadCapability();
    };

    const enabledCount = areas.filter((a) => a.audio_broadcast_enabled).length;

    // Group the capability rows by area (same as the target picker).
    const capOrder = [];
    const capByArea = new Map();
    for (const cam of capability) {
        const key = cam.area_name || 'Tanpa area';
        if (!capByArea.has(key)) { capByArea.set(key, []); capOrder.push(key); }
        capByArea.get(key).push(cam);
    }

    return (
        <div className="space-y-6">
            {/* Area allowlist */}
            <section className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-e1">
                <div>
                    <h3 className="text-sm font-semibold text-content">Area lokal</h3>
                    <p className="mt-0.5 text-xs text-content-muted">
                        Hanya kamera di area yang diaktifkan yang bisa jadi target siaran. Aktifkan area desa Anda
                        (mis. Dander, Tanjungharjo) — feed kota lain (Surabaya, dll.) sengaja dibiarkan mati.
                    </p>
                </div>
                {loading ? (
                    <p className="text-sm text-content-muted">Memuat…</p>
                ) : (
                    <ul className="space-y-1.5">
                        {areas.map((area) => (
                            <li key={area.id} className="flex items-center gap-3 rounded-control border border-edge px-3 py-2">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-content">{area.name}</p>
                                    <p className="text-xs text-content-subtle">{area.internal_camera_count} kamera internal</p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={Boolean(area.audio_broadcast_enabled)}
                                    disabled={busyArea === area.id}
                                    onClick={() => onToggleArea(area)}
                                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${area.audio_broadcast_enabled ? 'bg-status-live' : 'bg-edge-strong'}`}
                                    aria-label={area.audio_broadcast_enabled ? 'Nonaktifkan area' : 'Aktifkan area'}
                                >
                                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${area.audio_broadcast_enabled ? 'left-[22px]' : 'left-0.5'}`} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* Capability list */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold text-content">Kapabilitas kamera</h3>
                        <p className="mt-0.5 text-xs text-content-muted">Deteksi speaker two-way tanpa membunyikan apa pun (probe senyap). Perangkat rawan hang (mis. V380) bisa <span className="font-medium text-status-fault">Diblokir</span> agar tak pernah disentuh audio.</p>
                    </div>
                    <Button onClick={onRecheckAll} loading={rechecking === 'all'} disabled={enabledCount === 0}>Cek ulang semua</Button>
                </div>

                {enabledCount === 0 ? (
                    <EmptyState title="Aktifkan area dulu" description="Nyalakan minimal satu area lokal di atas agar kameranya bisa dideteksi & disiarkan." />
                ) : capability.length === 0 ? (
                    <p className="text-sm text-content-muted">Belum ada kamera di area aktif.</p>
                ) : (
                    <div className="space-y-4">
                        {capOrder.map((area) => (
                            <div key={area} className="space-y-2">
                                <p className="text-xs font-semibold text-content-muted">
                                    {area} <span className="font-normal text-content-subtle">({capByArea.get(area).filter((c) => c.supports_audio_out === 1).length} didukung / {capByArea.get(area).length})</span>
                                </p>
                                {capByArea.get(area).map((cam) => (
                                    <div key={cam.id} className={`flex items-start gap-3 rounded-card border p-3 shadow-e1 ${cam.audio_out_blocked ? 'border-status-fault/30 bg-status-fault/5' : 'border-edge bg-surface'}`}>
                                        <div className="min-w-0 flex-1">
                                            <p className="break-words text-sm font-semibold leading-snug text-content">{cam.name}</p>
                                            {cam.audio_out_note && (
                                                <p className="mt-0.5 break-words text-xs text-content-subtle">{cam.audio_out_note}</p>
                                            )}
                                        </div>
                                        <Badge supports={cam.supports_audio_out} blocked={cam.audio_out_blocked} />
                                        {cam.audio_out_blocked ? (
                                            <button
                                                type="button"
                                                onClick={() => onToggleBlock(cam)}
                                                disabled={rechecking === `block-${cam.id}`}
                                                className="shrink-0 rounded-control border border-status-fault/40 bg-surface px-3 py-1.5 text-sm font-medium text-status-fault transition-colors hover:bg-status-fault/10 disabled:opacity-50"
                                            >
                                                {rechecking === `block-${cam.id}` ? '…' : 'Lepas blokir'}
                                            </button>
                                        ) : (
                                            <div className="flex shrink-0 items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => onRecheckOne(cam)}
                                                    disabled={rechecking === cam.id}
                                                    className="rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:border-edge-strong hover:text-content disabled:opacity-50"
                                                >
                                                    {rechecking === cam.id ? '…' : 'Cek'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onToggleBlock(cam)}
                                                    disabled={rechecking === `block-${cam.id}`}
                                                    title="Blokir dari audio (perangkat rawan hang)"
                                                    className="rounded-control border border-edge bg-surface px-2.5 py-1.5 text-sm font-medium text-content-subtle transition-colors hover:border-status-fault/40 hover:text-status-fault disabled:opacity-50"
                                                >
                                                    Blokir
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
