/*
 * Purpose: "Grup" tab — manage custom MANUAL camera groups (area-free bags of cameras, e.g. "Musholla" =
 *   cam A,B,C). Create, rename, edit membership, and delete. The picker tabs (Putar Sekarang / Jadwal)
 *   only APPLY groups as one-tap presets; all management lives here so those surfaces stay tidy.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: CameraMultiSelect (plain member picker), components/ui, contexts.
 * MainFuncs: GroupsTab.
 * SideEffects: none directly — create/update/delete flow through the parent's handlers.
 */

import { useState } from 'react';
import { Button, EmptyState } from '../../ui';
import CameraMultiSelect from './CameraMultiSelect';

function GroupEditor({ initialName = '', initialIds = [], cameras, onCancel, onSave, saving }) {
    const [name, setName] = useState(initialName);
    const [ids, setIds] = useState(initialIds);
    return (
        <div className="space-y-3 rounded-card border border-edge bg-surface-sunken p-3">
            <input
                type="text"
                autoFocus
                value={name}
                maxLength={80}
                placeholder="Nama grup, mis. Musholla / Pasar / Sekolah"
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-control border border-edge bg-surface px-3 py-2 text-sm text-content focus:border-primary focus:outline-none"
            />
            {/* Plain picker (no nested groups) to choose members across any area. */}
            <CameraMultiSelect cameras={cameras} value={ids} onChange={setIds} />
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onCancel} className="rounded-control border border-edge px-3 py-1.5 text-sm font-medium text-content-muted">Batal</button>
                <Button variant="primary" disabled={!name.trim() || ids.length === 0 || saving} loading={saving} onClick={() => onSave(name.trim(), ids)}>Simpan</Button>
            </div>
        </div>
    );
}

export default function GroupsTab({ groups = [], cameras = [], onSaveGroup, onUpdateGroup, onDeleteGroup }) {
    const [creating, setCreating] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [saving, setSaving] = useState(false);

    const create = async (name, ids) => {
        setSaving(true);
        await onSaveGroup(name, ids);
        setSaving(false);
        setCreating(false);
    };
    const save = async (id, name, ids) => {
        setSaving(true);
        await onUpdateGroup(id, { name, cameraIds: ids });
        setSaving(false);
        setEditingId(null);
    };
    const remove = async (g) => {
        if (!window.confirm(`Hapus grup "${g.name}"?`)) return;
        await onDeleteGroup(g.id);
    };

    return (
        <div className="space-y-4">
            <section className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-e1">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold text-content">Grup kamera kustom</h3>
                        <p className="mt-0.5 text-xs text-content-muted">
                            Kumpulkan kamera mana pun ke satu grup bernama (tanpa dasar area), lalu pilih sekali tap
                            di Putar Sekarang &amp; Jadwal. Mis. &quot;Musholla&quot; = 3 kamera musholla.
                        </p>
                    </div>
                    {!creating && <Button onClick={() => { setCreating(true); setEditingId(null); }}>+ Grup baru</Button>}
                </div>

                {creating && (
                    <GroupEditor cameras={cameras} saving={saving} onCancel={() => setCreating(false)} onSave={create} />
                )}
            </section>

            {groups.length === 0 && !creating ? (
                <EmptyState title="Belum ada grup" description="Buat grup pertama untuk memilih beberapa kamera sekaligus dengan satu tap." />
            ) : (
                <ul className="space-y-2">
                    {groups.map((g) => (
                        <li key={g.id} className="rounded-card border border-edge bg-surface p-3 shadow-e1">
                            {editingId === g.id ? (
                                <GroupEditor
                                    initialName={g.name}
                                    initialIds={g.camera_ids || []}
                                    cameras={cameras}
                                    saving={saving}
                                    onCancel={() => setEditingId(null)}
                                    onSave={(name, ids) => save(g.id, name, ids)}
                                />
                            ) : (
                                <div className="flex items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-content">
                                            {g.name} <span className="font-normal text-content-subtle">({g.camera_count} kamera)</span>
                                        </p>
                                        {g.cameras && g.cameras.length > 0 ? (
                                            <div className="mt-1.5 flex flex-wrap gap-1">
                                                {g.cameras.map((c) => (
                                                    <span key={c.id} className="inline-flex items-center rounded-full border border-edge bg-surface-sunken px-2 py-0.5 text-xs text-content-muted">
                                                        {c.name}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="mt-1 text-xs text-content-subtle">Tak ada anggota di area aktif saat ini.</p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => { setEditingId(g.id); setCreating(false); }}
                                            className="rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:border-edge-strong hover:text-content"
                                        >
                                            Ubah
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => remove(g)}
                                            className="rounded-control border border-edge bg-surface px-2.5 py-1.5 text-sm font-medium text-content-subtle transition-colors hover:border-status-fault/40 hover:text-status-fault"
                                        >
                                            Hapus
                                        </button>
                                    </div>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
