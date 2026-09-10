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
import { toggleArea, recheckCameraCapability, recheckCapability, setCameraBlocked, setAreaPolicy, testSpeaker } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { Button, EmptyState } from '../../ui';
import { capabilityInfo } from './audioFormatting';

// Inline editor for an area's quiet hours (WIB) + loop ceiling. Both quiet bounds together, or neither.
function AreaPolicy({ area, onSave }) {
    const [qs, setQs] = useState(area.quiet_start || '');
    const [qe, setQe] = useState(area.quiet_end || '');
    const [cap, setCap] = useState(area.max_loop ? String(area.max_loop) : '');
    const [saving, setSaving] = useState(false);
    const dirty = qs !== (area.quiet_start || '') || qe !== (area.quiet_end || '') || cap !== (area.max_loop ? String(area.max_loop) : '');
    const save = async () => {
        setSaving(true);
        await onSave(area, { quiet_start: qs, quiet_end: qe, max_loop: cap });
        setSaving(false);
    };
    return (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-edge pt-2">
            <label className="text-xs text-content-muted">
                <span className="mb-0.5 block">Jam tenang (WIB)</span>
                <span className="flex items-center gap-1">
                    <input type="time" value={qs} onChange={(e) => setQs(e.target.value)} className="rounded-control border border-edge bg-surface px-2 py-1 text-sm text-content" />
                    <span className="text-content-subtle">–</span>
                    <input type="time" value={qe} onChange={(e) => setQe(e.target.value)} className="rounded-control border border-edge bg-surface px-2 py-1 text-sm text-content" />
                </span>
            </label>
            <label className="text-xs text-content-muted">
                <span className="mb-0.5 block">Plafon ulang</span>
                <input type="number" min={1} max={20} value={cap} placeholder="—" onChange={(e) => setCap(e.target.value)} className="w-20 rounded-control border border-edge bg-surface px-2 py-1 text-sm text-content" />
            </label>
            <button
                type="button"
                onClick={save}
                disabled={!dirty || saving}
                className="rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:border-primary disabled:opacity-40"
            >
                {saving ? '…' : 'Simpan'}
            </button>
        </div>
    );
}

// Compact "how long ago" label for a probe timestamp (read-only status).
function agoLabel(iso) {
    if (!iso) return 'belum dicek';
    const then = new Date(iso).getTime(); // audio_out_checked_at is a full ISO-8601 UTC string
    if (!Number.isFinite(then)) return '';
    const s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 90) return 'baru dicek';
    const m = Math.round(s / 60);
    if (m < 60) return `dicek ${m} mnt lalu`;
    const h = Math.round(m / 60);
    if (h < 48) return `dicek ${h} jam lalu`;
    return `dicek ${Math.round(h / 24)} hari lalu`;
}

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

export default function TargetsTab({ areas, capability, clips = [], loading, reloadAreas, reloadCapability }) {
    const [busyArea, setBusyArea] = useState(null);
    const [rechecking, setRechecking] = useState(null); // cameraId | 'all'
    const [testClipId, setTestClipId] = useState('');
    const [testing, setTesting] = useState(null); // cameraId | 'all-test'
    const { showNotification } = useNotification();

    // AUDIBLE test (vs the silent "Cek" probe): actually play a short clip to the speaker so the operator
    // hears it works in the field. Bypasses the area allowlist server-side, so testing before enabling works.
    const onTest = async (cam) => {
        if (!testClipId) { showNotification({ type: 'error', title: 'Pilih audio uji dulu' }); return; }
        setTesting(cam.id);
        const r = await testSpeaker({ cameraIds: [cam.id], sourceId: Number(testClipId) });
        setTesting(null);
        const ok = (r.data?.results || []).filter((x) => x && x.ok).length;
        showNotification({ type: r.success && ok > 0 ? 'success' : 'error', title: cam.name, message: r.success ? (ok > 0 ? 'Uji terkirim — dengarkan speaker' : 'Gagal berbunyi') : r.message });
    };
    const onTestAll = async () => {
        if (!testClipId) { showNotification({ type: 'error', title: 'Pilih audio uji dulu' }); return; }
        const ids = capability.filter((c) => c.supports_audio_out === 1 && !c.audio_out_blocked).map((c) => c.id);
        if (ids.length === 0) { showNotification({ type: 'error', title: 'Tak ada kamera didukung untuk diuji' }); return; }
        setTesting('all-test');
        const r = await testSpeaker({ cameraIds: ids, sourceId: Number(testClipId) });
        setTesting(null);
        showNotification({ type: r.success ? 'success' : 'error', title: 'Uji semua', message: r.message });
    };

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

    const onSavePolicy = async (area, payload) => {
        const result = await setAreaPolicy(area.id, payload);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menyimpan', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: 'Kebijakan area disimpan', message: area.name });
        await reloadAreas();
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
    const totals = { supported: 0, unsupported: 0, blocked: 0, unknown: 0 };
    for (const cam of capability) {
        const key = cam.area_name || 'Tanpa area';
        if (!capByArea.has(key)) { capByArea.set(key, []); capOrder.push(key); }
        capByArea.get(key).push(cam);
        if (cam.audio_out_blocked) totals.blocked += 1;
        else if (cam.supports_audio_out === 1) totals.supported += 1;
        else if (cam.supports_audio_out === 0) totals.unsupported += 1;
        else totals.unknown += 1;
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
                            <li key={area.id} className="rounded-control border border-edge px-3 py-2">
                                <div className="flex items-center gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-content">{area.name}</p>
                                        <p className="text-xs text-content-subtle">
                                            {area.internal_camera_count} kamera internal
                                            {area.quiet_start && area.quiet_end ? ` · jam tenang ${area.quiet_start}–${area.quiet_end}` : ''}
                                            {area.max_loop ? ` · maks ulang ${area.max_loop}×` : ''}
                                        </p>
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
                                </div>
                                {area.audio_broadcast_enabled ? <AreaPolicy area={area} onSave={onSavePolicy} /> : null}
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

                {/* Uji suara NYATA (bukan probe senyap): putar klip pendek ke speaker agar terdengar di lapangan. */}
                {clips.length > 0 && capability.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-control border border-edge bg-surface-sunken p-2">
                        <span className="text-xs font-medium text-content-muted">🔊 Uji suara:</span>
                        <select value={testClipId} onChange={(e) => setTestClipId(e.target.value)} className="min-w-0 flex-1 rounded-control border border-edge bg-surface px-2 py-1 text-sm text-content sm:w-52 sm:flex-none">
                            <option value="">— pilih audio uji —</option>
                            {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button type="button" onClick={onTestAll} disabled={!testClipId || testing === 'all-test'} className="rounded-control border border-edge bg-surface px-2.5 py-1.5 text-xs font-medium text-content-muted hover:border-edge-strong disabled:opacity-40">{testing === 'all-test' ? '…' : 'Uji semua didukung'}</button>
                    </div>
                )}

                {/* Peta status titik siaran (read-only) — ringkasan dari data yang sudah ada. */}
                {capability.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 rounded-full border border-status-live/30 bg-status-live/10 px-2.5 py-1 font-medium text-status-live">{totals.supported} didukung</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-sunken px-2.5 py-1 font-medium text-content-subtle">{totals.unsupported} tak didukung</span>
                        {totals.unknown > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-status-warn/30 bg-status-warn/10 px-2.5 py-1 font-medium text-status-warn">{totals.unknown} perlu tes</span>}
                        {totals.blocked > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-status-fault/30 bg-status-fault/10 px-2.5 py-1 font-medium text-status-fault">{totals.blocked} diblokir</span>}
                    </div>
                )}

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
                                            {!cam.audio_out_blocked && (
                                                <p className="mt-0.5 text-xs text-content-subtle">{agoLabel(cam.audio_out_checked_at)}</p>
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
                                                    onClick={() => onTest(cam)}
                                                    disabled={testing === cam.id || !testClipId}
                                                    title={testClipId ? 'Putar audio uji ke speaker ini' : 'Pilih audio uji di atas dulu'}
                                                    className="rounded-control border border-edge bg-surface px-2.5 py-1.5 text-sm font-medium text-content-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                                                >
                                                    {testing === cam.id ? '…' : '🔊 Uji'}
                                                </button>
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
