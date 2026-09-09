/*
 * Purpose: "Jadwal" tab — list scheduled broadcasts and a create/edit dialog (source, cameras, time,
 *   weekdays, repeat, on/off). Times are WIB; the backend scheduler fires them (see audioScheduleService).
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService, CameraMultiSelect, audioFormatting, contexts, components/ui.
 * MainFuncs: ScheduleTab.
 * SideEffects: creates/updates/toggles/deletes schedules via the API.
 */

import { useState } from 'react';
import {
    createSchedule, updateSchedule, toggleSchedule, deleteSchedule,
} from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Modal, Field, EmptyState } from '../../ui';
import CameraMultiSelect from './CameraMultiSelect';
import { DAYS, MASK_DAILY, MASK_WEEKDAYS, MASK_WEEKEND, describeDays } from './audioFormatting';

function DayPicker({ mask, onChange }) {
    const presets = [
        ['Setiap hari', MASK_DAILY],
        ['Sen–Jum', MASK_WEEKDAYS],
        ['Sabtu & Minggu', MASK_WEEKEND],
    ];
    return (
        <div className="space-y-2">
            <span className="text-xs font-semibold text-content-muted">Hari</span>
            <div className="flex flex-wrap gap-1.5">
                {presets.map(([label, val]) => (
                    <button
                        key={label}
                        type="button"
                        onClick={() => onChange(val)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                            (mask & 127) === val ? 'border-primary bg-primary/10 text-primary' : 'border-edge text-content-muted hover:border-edge-strong'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap gap-1">
                {DAYS.map((d) => {
                    const on = mask & d.bit;
                    return (
                        <button
                            key={d.bit}
                            type="button"
                            onClick={() => onChange(on ? (mask & ~d.bit) : (mask | d.bit))}
                            className={`h-9 w-11 rounded-control border text-xs font-medium transition-colors ${
                                on ? 'border-primary bg-primary/10 text-primary' : 'border-edge text-content-muted hover:border-edge-strong'
                            }`}
                        >
                            {d.short}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** Human timing phrase for a schedule row, per kind. */
function describeSchedule(s) {
    const kind = s.schedule_kind || 'recurring';
    if (kind === 'once') return `Sekali · ${s.run_date || '—'}`;
    if (kind === 'range') return `${describeDays(s.days_mask)} · ${s.start_date || '…'} → ${s.end_date || '…'}`;
    return describeDays(s.days_mask);
}

function ScheduleForm({ initial, clips, playlists, cameras, onSubmit }) {
    const [name, setName] = useState(initial?.name || '');
    const [sourceType, setSourceType] = useState(initial?.source_type || 'clip');
    const [sourceId, setSourceId] = useState(initial?.source_id ? String(initial.source_id) : '');
    const [cameraIds, setCameraIds] = useState(initial?.camera_ids || []);
    const [timeHHmm, setTimeHHmm] = useState(initial?.time_hhmm || '07:00');
    const [daysMask, setDaysMask] = useState(initial?.days_mask ?? MASK_DAILY);
    const [loopCount, setLoopCount] = useState(initial?.loop_count || 1);
    const [scheduleKind, setScheduleKind] = useState(initial?.schedule_kind || 'recurring');
    const [runDate, setRunDate] = useState(initial?.run_date || '');
    const [startDate, setStartDate] = useState(initial?.start_date || '');
    const [endDate, setEndDate] = useState(initial?.end_date || '');

    const options = sourceType === 'clip' ? clips : playlists;

    return (
        <form
            id="schedule-form"
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit({
                    name: name.trim(),
                    sourceType,
                    sourceId: Number(sourceId),
                    cameraIds,
                    timeHHmm,
                    daysMask,
                    loopCount,
                    scheduleKind,
                    runDate: scheduleKind === 'once' ? runDate : '',
                    startDate: scheduleKind === 'range' ? startDate : '',
                    endDate: scheduleKind === 'range' ? endDate : '',
                });
            }}
            className="space-y-4"
        >
            <Field label="Nama jadwal" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="mis. Pengumuman Pagi" />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <span className="text-xs font-semibold text-content-muted">Sumber</span>
                    <div className="flex gap-2">
                        {[['clip', 'Audio'], ['playlist', 'Playlist']].map(([val, label]) => (
                            <button
                                key={val}
                                type="button"
                                onClick={() => { setSourceType(val); setSourceId(''); }}
                                className={`flex-1 rounded-control border px-3 py-2 text-sm font-medium transition-colors ${
                                    sourceType === val ? 'border-primary bg-primary/10 text-primary' : 'border-edge text-content-muted hover:border-edge-strong'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <Field as="select" label={sourceType === 'clip' ? 'Pilih audio' : 'Pilih playlist'} value={sourceId} onChange={(e) => setSourceId(e.target.value)} required>
                    <option value="">— pilih —</option>
                    {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field type="time" label="Jam (WIB)" value={timeHHmm} onChange={(e) => setTimeHHmm(e.target.value)} required />
                <Field type="number" label="Ulang berapa kali" min={1} max={20} value={loopCount} onChange={(e) => setLoopCount(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)))} />
            </div>

            <div className="space-y-2">
                <span className="text-xs font-semibold text-content-muted">Jenis jadwal</span>
                <div className="flex gap-2">
                    {[['recurring', 'Berulang'], ['once', 'Sekali'], ['range', 'Rentang']].map(([val, label]) => (
                        <button
                            key={val}
                            type="button"
                            onClick={() => setScheduleKind(val)}
                            className={`flex-1 rounded-control border px-3 py-2 text-sm font-medium transition-colors ${
                                scheduleKind === val ? 'border-primary bg-primary/10 text-primary' : 'border-edge text-content-muted hover:border-edge-strong'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-content-subtle">
                    {scheduleKind === 'once' ? 'Diputar sekali pada satu tanggal, lalu nonaktif otomatis.'
                        : scheduleKind === 'range' ? 'Berulang mingguan, tapi hanya dalam rentang tanggal.'
                            : 'Berulang mingguan sesuai hari yang dipilih, tanpa batas tanggal.'}
                </p>
            </div>

            {scheduleKind === 'once' && (
                <Field type="date" label="Tanggal (WIB)" value={runDate} onChange={(e) => setRunDate(e.target.value)} required />
            )}
            {scheduleKind === 'range' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field type="date" label="Mulai (opsional)" value={startDate} onChange={(e) => setStartDate(e.target.value)} hint="Kosongkan = tanpa batas awal" />
                    <Field type="date" label="Selesai (opsional)" value={endDate} onChange={(e) => setEndDate(e.target.value)} hint="Kosongkan = tanpa batas akhir" />
                </div>
            )}

            {scheduleKind !== 'once' && <DayPicker mask={daysMask} onChange={setDaysMask} />}

            <CameraMultiSelect cameras={cameras} value={cameraIds} onChange={setCameraIds} />
        </form>
    );
}

export default function ScheduleTab({ schedules, clips, playlists, cameras, loading, reload }) {
    const [editing, setEditing] = useState(null);
    const [saving, setSaving] = useState(false);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const handleSubmit = async (payload) => {
        if (!payload.name) { showNotification({ type: 'error', title: 'Nama jadwal wajib diisi' }); return; }
        if (!payload.sourceId) { showNotification({ type: 'error', title: 'Pilih audio atau playlist' }); return; }
        if (!payload.cameraIds.length) { showNotification({ type: 'error', title: 'Pilih minimal satu kamera' }); return; }
        setSaving(true);
        const result = editing?.id
            ? await updateSchedule(editing.id, payload)
            : await createSchedule(payload);
        setSaving(false);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menyimpan', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: editing?.id ? 'Jadwal diperbarui' : 'Jadwal dibuat' });
        setEditing(null);
        await reload();
    };

    const handleToggle = async (s) => {
        const result = await toggleSchedule(s.id, !s.enabled);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal mengubah status', message: result.message });
            return;
        }
        await reload();
    };

    const handleDelete = async (s) => {
        const confirmed = await confirm({
            title: 'Hapus jadwal?',
            message: `"${s.name}" akan dihapus permanen.`,
            confirmLabel: 'Hapus', cancelLabel: 'Batal', tone: 'danger',
        });
        if (!confirmed) return;
        const result = await deleteSchedule(s.id);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menghapus', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: 'Jadwal dihapus' });
        await reload();
    };

    const canCreate = clips.length > 0 || playlists.length > 0;

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Button variant="primary" onClick={() => setEditing({})} disabled={!canCreate}>Jadwal baru</Button>
            </div>

            {loading ? (
                <p className="text-sm text-content-muted">Memuat…</p>
            ) : schedules.length === 0 ? (
                <EmptyState
                    title="Belum ada jadwal"
                    description={canCreate
                        ? 'Atur audio otomatis diputar ke kamera pada jam & hari tertentu.'
                        : 'Unggah audio atau buat playlist dulu, lalu jadwalkan.'}
                />
            ) : (
                <ul className="space-y-2">
                    {schedules.map((s) => (
                        <li key={s.id} className="flex items-center gap-3 rounded-card border border-edge bg-surface p-3 shadow-e1">
                            <span className="shrink-0 rounded-control bg-surface-sunken px-2.5 py-1.5 font-mono text-sm font-semibold tabular-nums text-content">
                                {s.time_hhmm}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-content">{s.name}</p>
                                <p className="truncate text-xs text-content-subtle">
                                    {describeSchedule(s)} · {s.source_name || (s.source_type === 'clip' ? 'audio' : 'playlist')} · {(s.camera_ids || []).length} kamera
                                    {s.loop_count > 1 ? ` · ${s.loop_count}×` : ''}
                                </p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={Boolean(s.enabled)}
                                onClick={() => handleToggle(s)}
                                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${s.enabled ? 'bg-status-live' : 'bg-edge-strong'}`}
                                aria-label={s.enabled ? 'Nonaktifkan jadwal' : 'Aktifkan jadwal'}
                            >
                                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${s.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                            </button>
                            <button type="button" onClick={() => setEditing(s)} className="shrink-0 rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:border-edge-strong hover:text-content">Ubah</button>
                            <button type="button" onClick={() => handleDelete(s)} className="shrink-0 rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-status-fault transition-colors hover:border-status-fault/40">Hapus</button>
                        </li>
                    ))}
                </ul>
            )}

            {editing && (
                <Modal
                    title={editing.id ? `Ubah: ${editing.name}` : 'Jadwal baru'}
                    size="lg"
                    onClose={() => setEditing(null)}
                    footer={(
                        <>
                            <Button onClick={() => setEditing(null)} disabled={saving}>Batal</Button>
                            <Button type="submit" form="schedule-form" variant="primary" loading={saving}>Simpan</Button>
                        </>
                    )}
                >
                    <ScheduleForm initial={editing.id ? editing : null} clips={clips} playlists={playlists} cameras={cameras} onSubmit={handleSubmit} />
                </Modal>
            )}
        </div>
    );
}
