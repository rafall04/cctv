/*
Purpose: Filter + bulk-set retensi (recording_duration_hours) banyak kamera dari halaman rekaman,
         supaya operator tak perlu buka kartu satu per satu. Dua cara pilih target (sesuai permintaan):
         (1) filter grid (cari/Area/Grup/status) lalu "terapkan ke hasil filter" / kamera yang dicentang,
         (2) panel pintas: pilih Area atau Grup langsung lalu set jam.
Caller: pages/RecordingDashboard.jsx (menggantikan render langsung RecordingCameraGrid).
Deps: RecordingCameraGrid, recordingDurationOptions (cameraFormAdapter).
MainFuncs: RecordingRetentionManager.
SideEffects: none sendiri — memanggil onBulkUpdate(payload) milik parent (yang memanggil API + refetch).

Kenapa ADA konfirmasi: MENURUNKAN retensi berarti siklus cleanup berikutnya MENGHAPUS segmen yang
lebih lama dari jendela baru. Aksi massal yang bisa menghapus rekaman wajib dikonfirmasi lebih dulu.
*/

import { useMemo, useState } from 'react';
import { recordingDurationOptions } from '../../../utils/admin/cameraFormAdapter';
import RecordingCameraGrid from './RecordingCameraGrid';

const cameraIdOf = (recording) => recording.id || recording.camera_id;
const isRecordingNow = (recording) => recording.runtime_status?.isRecording === true;

const UNGROUPED = '__ungrouped__';
const NO_AREA = '__noarea__';

function DurationSelect({ id, value, onChange, disabled }) {
    return (
        <select
            id={id}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            disabled={disabled}
            className="rounded-lg border border-edge-strong bg-surface px-3 py-2 text-sm text-content focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
        >
            {recordingDurationOptions.map((group) => (
                <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </optgroup>
            ))}
        </select>
    );
}

export default function RecordingRetentionManager({
    recordings = [],
    onStartRecording,
    onStopRecording,
    onUpdateSettings,
    updatingCameraId = null,
    onBulkUpdate,
    bulkBusy = false,
}) {
    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [bulkHours, setBulkHours] = useState(24);

    // Panel pintas per Area / Grup
    const [quickScope, setQuickScope] = useState('area');
    const [quickArea, setQuickArea] = useState('');
    const [quickGroup, setQuickGroup] = useState('');
    const [quickHours, setQuickHours] = useState(24);

    // Konfirmasi terpusat: { label, count, payload }
    const [pending, setPending] = useState(null);

    const areaOptions = useMemo(() => {
        const map = new Map();
        for (const recording of recordings) {
            if (recording.area_id) {
                map.set(String(recording.area_id), recording.area_name || `Area ${recording.area_id}`);
            }
        }
        return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }, [recordings]);

    const groupOptions = useMemo(() => {
        const set = new Set();
        for (const recording of recordings) {
            const group = (recording.group_name || '').trim();
            if (group) set.add(group);
        }
        return [...set].sort((a, b) => a.localeCompare(b));
    }, [recordings]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return recordings.filter((recording) => {
            if (term) {
                const haystack = `${recording.name || recording.camera_name || ''} ${recording.location || ''}`.toLowerCase();
                if (!haystack.includes(term)) return false;
            }
            if (areaFilter !== 'all') {
                if (areaFilter === NO_AREA) {
                    if (recording.area_id) return false;
                } else if (String(recording.area_id) !== areaFilter) {
                    return false;
                }
            }
            if (groupFilter !== 'all') {
                const group = (recording.group_name || '').trim();
                if (groupFilter === UNGROUPED) {
                    if (group) return false;
                } else if (group !== groupFilter) {
                    return false;
                }
            }
            if (statusFilter === 'recording' && !isRecordingNow(recording)) return false;
            if (statusFilter === 'stopped' && isRecordingNow(recording)) return false;
            return true;
        });
    }, [recordings, search, areaFilter, groupFilter, statusFilter]);

    const filteredIds = useMemo(() => filtered.map(cameraIdOf), [filtered]);
    // Pilihan yang masih terlihat di hasil filter (checkbox pada kamera yang lalu tersembunyi tak ikut).
    const visibleSelected = useMemo(
        () => filteredIds.filter((id) => selectedIds.has(id)),
        [filteredIds, selectedIds],
    );

    const toggleSelect = (cameraId) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(cameraId)) next.delete(cameraId);
            else next.add(cameraId);
            return next;
        });
    };

    const selectAllFiltered = () => setSelectedIds(new Set(filteredIds));
    const clearSelection = () => setSelectedIds(new Set());

    const resetFilters = () => {
        setSearch('');
        setAreaFilter('all');
        setGroupFilter('all');
        setStatusFilter('all');
    };

    const askApply = (payload, label, count) => {
        if (count === 0) return;
        setPending({ payload, label, count });
    };

    const confirmApply = async () => {
        if (!pending) return;
        await onBulkUpdate(pending.payload);
        setPending(null);
        clearSelection();
    };

    const quickCount = useMemo(() => {
        if (quickScope === 'area') {
            if (!quickArea) return 0;
            return recordings.filter((r) => String(r.area_id) === quickArea).length;
        }
        if (!quickGroup) return 0;
        return recordings.filter((r) => (r.group_name || '').trim() === quickGroup).length;
    }, [quickScope, quickArea, quickGroup, recordings]);

    const filtersActive = search.trim() !== '' || areaFilter !== 'all' || groupFilter !== 'all' || statusFilter !== 'all';
    const applyTargetIds = visibleSelected.length > 0 ? visibleSelected : filteredIds;
    const applyTargetLabel = visibleSelected.length > 0
        ? `${visibleSelected.length} kamera terpilih`
        : `${filteredIds.length} kamera${filtersActive ? ' (hasil filter)' : ''}`;

    const controlClass = 'rounded-lg border border-edge-strong bg-surface px-3 py-2 text-sm text-content focus:ring-2 focus:ring-primary-500';

    return (
        <div className="space-y-4">
            {/* ---- Filter toolbar ---- */}
            <div className="rounded-2xl border border-edge bg-surface p-4 shadow-sm md:p-5">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[10rem] flex-1">
                        <label htmlFor="rec-search" className="mb-1 block text-xs font-medium text-content-muted">Cari kamera</label>
                        <input
                            id="rec-search"
                            type="text"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Nama atau lokasi…"
                            className={`w-full ${controlClass}`}
                        />
                    </div>
                    <div>
                        <label htmlFor="rec-area" className="mb-1 block text-xs font-medium text-content-muted">Area</label>
                        <select id="rec-area" value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)} className={controlClass}>
                            <option value="all">Semua area</option>
                            {areaOptions.map((area) => (
                                <option key={area.id} value={area.id}>{area.name}</option>
                            ))}
                            <option value={NO_AREA}>(Tanpa area)</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="rec-group" className="mb-1 block text-xs font-medium text-content-muted">Grup</label>
                        <select id="rec-group" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className={controlClass}>
                            <option value="all">Semua grup</option>
                            {groupOptions.map((group) => (
                                <option key={group} value={group}>{group}</option>
                            ))}
                            <option value={UNGROUPED}>(Tanpa grup)</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="rec-status" className="mb-1 block text-xs font-medium text-content-muted">Status</label>
                        <select id="rec-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={controlClass}>
                            <option value="all">Semua status</option>
                            <option value="recording">Sedang merekam</option>
                            <option value="stopped">Berhenti</option>
                        </select>
                    </div>
                    {filtersActive && (
                        <button type="button" onClick={resetFilters} className="rounded-lg border border-edge-strong bg-surface px-3 py-2 text-sm font-medium text-content hover:bg-surface-sunken">
                            Reset
                        </button>
                    )}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-content-muted">
                        Menampilkan <span className="font-semibold text-content">{filtered.length}</span> dari {recordings.length} kamera
                        {visibleSelected.length > 0 && <> · <span className="font-semibold text-content">{visibleSelected.length}</span> dipilih</>}
                    </span>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={selectAllFiltered} disabled={filteredIds.length === 0} className="text-xs font-medium text-primary-600 hover:underline disabled:opacity-40 dark:text-primary-300">
                            Pilih semua ({filteredIds.length})
                        </button>
                        {visibleSelected.length > 0 && (
                            <button type="button" onClick={clearSelection} className="text-xs font-medium text-content-muted hover:underline">
                                Bersihkan pilihan
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ---- Bulk apply bar (filter / seleksi) ---- */}
            <div className="rounded-2xl border border-edge bg-surface-sunken p-4 shadow-sm md:p-5">
                <div className="flex flex-wrap items-end gap-3">
                    <div>
                        <label htmlFor="bulk-hours" className="mb-1 block text-xs font-medium text-content-muted">Set durasi retensi</label>
                        <DurationSelect id="bulk-hours" value={bulkHours} onChange={setBulkHours} disabled={bulkBusy} />
                    </div>
                    <button
                        type="button"
                        disabled={bulkBusy || applyTargetIds.length === 0}
                        onClick={() => askApply(
                            { scope: 'ids', cameraIds: applyTargetIds, recordingDurationHours: bulkHours },
                            applyTargetLabel,
                            applyTargetIds.length,
                        )}
                        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                    >
                        Terapkan ke {applyTargetLabel}
                    </button>
                    <p className="text-xs text-content-muted">
                        Centang kamera untuk pilih spesifik, atau atur filter di atas lalu terapkan ke seluruh hasil.
                    </p>
                </div>
            </div>

            {/* ---- Panel pintas per Area / Grup ---- */}
            <details className="rounded-2xl border border-edge bg-surface p-4 shadow-sm md:p-5">
                <summary className="cursor-pointer text-sm font-semibold text-content">Atur cepat per Area / Grup</summary>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                        <label htmlFor="quick-scope" className="mb-1 block text-xs font-medium text-content-muted">Berdasarkan</label>
                        <select id="quick-scope" value={quickScope} onChange={(event) => setQuickScope(event.target.value)} className={controlClass}>
                            <option value="area">Area</option>
                            <option value="group">Grup</option>
                        </select>
                    </div>
                    {quickScope === 'area' ? (
                        <div>
                            <label htmlFor="quick-area" className="mb-1 block text-xs font-medium text-content-muted">Pilih area</label>
                            <select id="quick-area" value={quickArea} onChange={(event) => setQuickArea(event.target.value)} className={controlClass}>
                                <option value="">— pilih area —</option>
                                {areaOptions.map((area) => (
                                    <option key={area.id} value={area.id}>{area.name}</option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <div>
                            <label htmlFor="quick-group" className="mb-1 block text-xs font-medium text-content-muted">Pilih grup</label>
                            <select id="quick-group" value={quickGroup} onChange={(event) => setQuickGroup(event.target.value)} className={controlClass}>
                                <option value="">— pilih grup —</option>
                                {groupOptions.map((group) => (
                                    <option key={group} value={group}>{group}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label htmlFor="quick-hours" className="mb-1 block text-xs font-medium text-content-muted">Durasi retensi</label>
                        <DurationSelect id="quick-hours" value={quickHours} onChange={setQuickHours} disabled={bulkBusy} />
                    </div>
                    <button
                        type="button"
                        disabled={bulkBusy || quickCount === 0}
                        onClick={() => askApply(
                            quickScope === 'area'
                                ? { scope: 'area', areaId: quickArea, recordingDurationHours: quickHours }
                                : { scope: 'group', groupName: quickGroup, recordingDurationHours: quickHours },
                            quickScope === 'area'
                                ? `area "${areaOptions.find((a) => a.id === quickArea)?.name || ''}"`
                                : `grup "${quickGroup}"`,
                            quickCount,
                        )}
                        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                    >
                        Terapkan ({quickCount} kamera)
                    </button>
                </div>
                <p className="mt-2 text-xs text-content-muted">
                    Berlaku untuk semua kamera enabled di area/grup itu, termasuk yang sedang berhenti.
                </p>
            </details>

            {/* ---- Konfirmasi ---- */}
            {pending && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                        Set retensi {pending.payload.recordingDurationHours} jam untuk {pending.count} kamera ({pending.label})?
                    </p>
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        Kamera yang durasi retensinya TURUN akan menghapus rekaman lebih lama dari {pending.payload.recordingDurationHours} jam
                        pada siklus pembersihan berikutnya. Tindakan ini tidak bisa dibatalkan.
                    </p>
                    <div className="mt-3 flex gap-2">
                        <button type="button" onClick={confirmApply} disabled={bulkBusy} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                            {bulkBusy ? 'Menerapkan…' : 'Ya, terapkan'}
                        </button>
                        <button type="button" onClick={() => setPending(null)} disabled={bulkBusy} className="rounded-lg border border-edge-strong bg-surface px-4 py-2 text-sm font-medium text-content hover:bg-surface-sunken disabled:opacity-50">
                            Batal
                        </button>
                    </div>
                </div>
            )}

            {/* ---- Grid kamera (hasil filter) ---- */}
            <RecordingCameraGrid
                recordings={filtered}
                onStartRecording={onStartRecording}
                onStopRecording={onStopRecording}
                onUpdateSettings={onUpdateSettings}
                updatingCameraId={updatingCameraId}
                selectable
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
            />
        </div>
    );
}
