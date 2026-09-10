/*
 * Purpose: A compact multi-select list of speaker-capable cameras for the Audio Broadcast surface.
 *   Shared by the Putar Sekarang tab and the schedule form so both pick cameras the same way.
 * Caller: components/admin/audio/PlayNowTab.jsx, ScheduleForm.jsx.
 * Deps: React only (token classes).
 * MainFuncs: CameraMultiSelect.
 * SideEffects: none — controlled by `value` + `onChange`.
 *
 * Not every internal camera exposes an ONVIF backchannel (an IMOU S41FE has a speaker but does not
 * expose it), so the list is "candidates" — a chosen camera without a backchannel simply reports its
 * failure at play time. The label says as much rather than promising every camera will play.
 */

import { useState } from 'react';
import { capabilityInfo } from './audioFormatting';

/** Tiny inline capability indicator: a colour dot + a readable label (never a dot alone). */
function CapabilityTag({ supports }) {
    const info = capabilityInfo(supports);
    const color = info.key === 'supported' ? 'text-status-live'
        : info.key === 'unsupported' ? 'text-content-subtle' : 'text-status-warn';
    const dot = info.key === 'supported' ? 'bg-status-live'
        : info.key === 'unsupported' ? 'bg-edge-strong' : 'bg-status-warn';
    return (
        <span className={`inline-flex items-center gap-1 ${color}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
            {info.label}
        </span>
    );
}

/**
 * @param {Array<{id:number,name:string,area_name?:string}>} cameras
 * @param {number[]} value selected camera ids
 * @param {(ids:number[])=>void} onChange
 * @param {Array<{id:number,name:string,camera_ids:number[],camera_count:number}>} [groups] custom manual groups
 * @param {(name:string, cameraIds:number[])=>Promise<void>} [onSaveGroup] save current selection as a group
 * @param {(id:number)=>Promise<void>} [onDeleteGroup] delete a group
 */
export default function CameraMultiSelect({
    cameras = [], value = [], onChange, disabled = false,
    groups = null, onSaveGroup = null, onDeleteGroup = null,
}) {
    const selected = new Set(value);
    const [supportedOnly, setSupportedOnly] = useState(false);
    const [naming, setNaming] = useState(false);
    const [groupName, setGroupName] = useState('');

    const toggle = (id) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        onChange([...next]);
    };

    // Custom-group quick-pick: apply/clear a saved bag of cameras in one tap (intersected with the
    // cameras actually available now, so a member whose area is currently off is simply skipped).
    const validIds = new Set(cameras.map((c) => c.id));
    const groupMembers = (g) => (g.camera_ids || []).filter((id) => validIds.has(id));
    const applyGroup = (g) => {
        const ids = groupMembers(g);
        const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
        const next = new Set(selected);
        ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
        onChange([...next]);
    };
    const saveGroup = async () => {
        const name = groupName.trim();
        if (!name || !onSaveGroup) return;
        await onSaveGroup(name, [...selected]);
        setGroupName('');
        setNaming(false);
    };

    // Optional filter: only cameras confirmed to support the backchannel (will actually sound).
    const hasCapability = cameras.some((c) => 'supports_audio_out' in c);
    const shown = supportedOnly ? cameras.filter((c) => c.supports_audio_out === 1) : cameras;

    const allIds = shown.map((c) => c.id);
    const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id));

    // Group by area so an operator can pick a whole area in one tap (preset), or still tick cameras
    // one by one. Groups preserve first-seen order.
    const order = [];
    const byArea = new Map();
    for (const cam of shown) {
        const key = cam.area_name || 'Tanpa area';
        if (!byArea.has(key)) { byArea.set(key, []); order.push(key); }
        byArea.get(key).push(cam);
    }
    const setMany = (ids, on) => {
        const next = new Set(selected);
        ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
        onChange([...next]);
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-content-muted">
                    Kamera tujuan ({selected.size}/{shown.length})
                </span>
                <div className="flex items-center gap-3">
                    {hasCapability && (
                        <label className="flex cursor-pointer items-center gap-1 text-xs text-content-muted">
                            <input type="checkbox" checked={supportedOnly} onChange={(e) => setSupportedOnly(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                            Hanya yang didukung
                        </label>
                    )}
                    {shown.length > 0 && (
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(allOn ? [] : allIds)}
                            className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-60"
                        >
                            {allOn ? 'Kosongkan' : 'Pilih semua'}
                        </button>
                    )}
                </div>
            </div>

            {/* Custom manual groups — area-free presets the operator saved (e.g. "Musholla" = cam A,B,C). */}
            {groups && (
                <div className="space-y-1.5 rounded-control border border-edge bg-surface-sunken p-2">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-content-muted">Grup kustom</span>
                        {onSaveGroup && !naming && (
                            <button
                                type="button"
                                disabled={disabled || selected.size === 0}
                                onClick={() => setNaming(true)}
                                className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-40"
                                title={selected.size === 0 ? 'Pilih kamera dulu' : 'Simpan pilihan sebagai grup'}
                            >
                                + Simpan {selected.size > 0 ? `(${selected.size})` : ''} sebagai grup
                            </button>
                        )}
                    </div>

                    {naming && (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                autoFocus
                                value={groupName}
                                maxLength={80}
                                placeholder="Nama grup, mis. Musholla"
                                onChange={(e) => setGroupName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveGroup(); if (e.key === 'Escape') { setNaming(false); setGroupName(''); } }}
                                className="min-w-0 flex-1 rounded-control border border-edge bg-surface px-2 py-1.5 text-sm text-content focus:border-primary focus:outline-none"
                            />
                            <button type="button" onClick={saveGroup} disabled={!groupName.trim()} className="shrink-0 rounded-control bg-primary px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">Simpan</button>
                            <button type="button" onClick={() => { setNaming(false); setGroupName(''); }} className="shrink-0 rounded-control border border-edge px-2.5 py-1.5 text-xs font-medium text-content-muted">Batal</button>
                        </div>
                    )}

                    {groups.length === 0 ? (
                        !naming && <p className="text-xs text-content-subtle">Belum ada grup. Pilih beberapa kamera lalu simpan sebagai grup untuk memilihnya sekali tap.</p>
                    ) : (
                        <div className="flex flex-wrap gap-1.5">
                            {groups.map((g) => {
                                const ids = groupMembers(g);
                                const on = ids.length > 0 && ids.every((id) => selected.has(id));
                                return (
                                    <span
                                        key={g.id}
                                        className={`inline-flex items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 text-xs transition-colors ${
                                            on ? 'border-primary bg-primary/10 text-primary' : 'border-edge bg-surface text-content-muted'
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            disabled={disabled || ids.length === 0}
                                            onClick={() => applyGroup(g)}
                                            className="font-medium disabled:opacity-40"
                                            title={ids.length === 0 ? 'Tidak ada anggota di area aktif' : `${g.name} — ${ids.length} kamera`}
                                        >
                                            {g.name} <span className="font-normal opacity-70">({ids.length || g.camera_count})</span>
                                        </button>
                                        {onDeleteGroup && (
                                            <button
                                                type="button"
                                                disabled={disabled}
                                                onClick={() => onDeleteGroup(g.id)}
                                                className="flex h-4 w-4 items-center justify-center rounded-full text-content-subtle hover:bg-status-fault/10 hover:text-status-fault"
                                                aria-label={`Hapus grup ${g.name}`}
                                            >
                                                ×
                                            </button>
                                        )}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {shown.length === 0 ? (
                <p className="rounded-control border border-dashed border-edge bg-surface-sunken p-3 text-xs text-content-subtle">
                    {supportedOnly ? 'Belum ada kamera "Didukung". Jalankan "Cek ulang" di tab Kamera & Area.'
                        : 'Tidak ada kamera. Aktifkan area lokal Anda di tab "Kamera & Area" dulu.'}
                </p>
            ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-control border border-edge bg-surface p-1">
                    {order.map((area) => {
                        const list = byArea.get(area);
                        const ids = list.map((c) => c.id);
                        const inArea = ids.filter((id) => selected.has(id)).length;
                        const areaOn = inArea === ids.length;
                        return (
                            <div key={area}>
                                {/* Area preset header — one tap selects/clears the whole area. */}
                                <div className="flex items-center justify-between gap-2 rounded-control bg-surface-sunken px-2 py-1.5">
                                    <span className="min-w-0 truncate text-xs font-semibold text-content">
                                        {area} <span className="font-normal text-content-subtle">({inArea}/{ids.length})</span>
                                    </span>
                                    <button
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => setMany(ids, !areaOn)}
                                        className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-60"
                                    >
                                        {areaOn ? 'Kosongkan' : 'Pilih area'}
                                    </button>
                                </div>
                                {list.map((cam) => {
                                    const on = selected.has(cam.id);
                                    return (
                                        <label
                                            key={cam.id}
                                            className={`flex cursor-pointer items-start gap-2.5 rounded-control px-2 py-2 transition-colors ${
                                                on ? 'bg-primary/10' : 'hover:bg-surface-sunken'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={on}
                                                disabled={disabled}
                                                onChange={() => toggle(cam.id)}
                                                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                            />
                                            <span className="min-w-0 flex-1">
                                                {/* Full name, wraps — never truncated, so every camera is identifiable. */}
                                                <span className={`block break-words text-sm leading-snug ${on ? 'text-content' : 'text-content-muted'}`}>
                                                    {cam.name}
                                                </span>
                                                {'supports_audio_out' in cam && (
                                                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                                                        <CapabilityTag supports={cam.supports_audio_out} />
                                                        {cam.online === 0 && (
                                                            <span className="inline-flex items-center gap-1 text-status-fault" title="Kamera sedang offline — siaran bisa gagal">
                                                                <span className="h-1.5 w-1.5 rounded-full bg-status-fault" aria-hidden="true" />
                                                                offline
                                                            </span>
                                                        )}
                                                    </span>
                                                )}
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
