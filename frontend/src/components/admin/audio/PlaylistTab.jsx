/*
 * Purpose: "Playlist" tab — list playlists and a create/edit dialog that orders clips (add, reorder,
 *   remove). A playlist plays its clips in order; a clip may repeat.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService, audioFormatting, contexts, components/ui.
 * MainFuncs: PlaylistTab.
 * SideEffects: creates/updates/deletes playlists via the API.
 */

import { useState } from 'react';
import {
    getPlaylist, createPlaylist, updatePlaylist, deletePlaylist,
} from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Modal, Field, EmptyState } from '../../ui';
import { formatDuration } from './audioFormatting';

function PlaylistForm({ clips, initial, onSubmit }) {
    const [name, setName] = useState(initial?.name || '');
    // Ordered list of clip ids; duplicates are allowed (a clip may repeat in a playlist).
    const [items, setItems] = useState((initial?.items || []).map((i) => i.clip_id));
    const [toAdd, setToAdd] = useState('');

    const clipById = new Map(clips.map((c) => [c.id, c]));

    const add = () => {
        const id = parseInt(toAdd, 10);
        if (Number.isInteger(id)) setItems((prev) => [...prev, id]);
        setToAdd('');
    };
    const move = (idx, delta) => setItems((prev) => {
        const next = [...prev];
        const j = idx + delta;
        if (j < 0 || j >= next.length) return prev;
        [next[idx], next[j]] = [next[j], next[idx]];
        return next;
    });
    const remove = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

    const totalSec = items.reduce((sum, id) => sum + (clipById.get(id)?.duration_sec || 0), 0);

    return (
        <form
            id="playlist-form"
            onSubmit={(e) => { e.preventDefault(); onSubmit({ name: name.trim(), clipIds: items }); }}
            className="space-y-4"
        >
            <Field label="Nama playlist" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="mis. Putar Siang" />

            <div className="flex items-end gap-2">
                <Field as="select" label="Tambah audio" value={toAdd} onChange={(e) => setToAdd(e.target.value)} className="flex-1">
                    <option value="">— pilih audio —</option>
                    {clips.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({formatDuration(c.duration_sec)})</option>
                    ))}
                </Field>
                <Button type="button" onClick={add} disabled={!toAdd}>Tambah</Button>
            </div>

            <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-xs font-semibold text-content-muted">Urutan ({items.length} audio)</span>
                    <span className="font-mono text-xs tabular-nums text-content-subtle">{formatDuration(totalSec)}</span>
                </div>
                {items.length === 0 ? (
                    <p className="rounded-control border border-dashed border-edge bg-surface-sunken p-3 text-xs text-content-subtle">
                        Belum ada audio. Tambahkan dari daftar di atas.
                    </p>
                ) : (
                    <ol className="space-y-1">
                        {items.map((id, idx) => {
                            const clip = clipById.get(id);
                            return (
                                <li key={`${id}-${idx}`} className="flex items-center gap-2 rounded-control border border-edge bg-surface px-2 py-1.5 text-sm">
                                    <span className="w-5 shrink-0 text-center font-mono text-xs text-content-subtle">{idx + 1}</span>
                                    <span className="min-w-0 flex-1 truncate text-content">{clip ? clip.name : `#${id} (hilang)`}</span>
                                    <span className="shrink-0 font-mono text-xs tabular-nums text-content-subtle">{clip ? formatDuration(clip.duration_sec) : '—'}</span>
                                    <div className="flex shrink-0 gap-0.5">
                                        <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="rounded p-1 text-content-muted hover:bg-surface-sunken disabled:opacity-30" aria-label="Naik">▲</button>
                                        <button type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} className="rounded p-1 text-content-muted hover:bg-surface-sunken disabled:opacity-30" aria-label="Turun">▼</button>
                                        <button type="button" onClick={() => remove(idx)} className="rounded p-1 text-status-fault hover:bg-status-fault/10" aria-label="Hapus">✕</button>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>
        </form>
    );
}

export default function PlaylistTab({ playlists, clips, loading, reload }) {
    const [editing, setEditing] = useState(null); // { } for new, {id,...} for edit
    const [saving, setSaving] = useState(false);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    const openNew = () => setEditing({ name: '', items: [] });

    const openEdit = async (pl) => {
        const result = await getPlaylist(pl.id);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal memuat playlist', message: result.message });
            return;
        }
        setEditing(result.data);
    };

    const handleSubmit = async ({ name, clipIds }) => {
        if (!name) {
            showNotification({ type: 'error', title: 'Nama playlist wajib diisi' });
            return;
        }
        setSaving(true);
        const result = editing?.id
            ? await updatePlaylist(editing.id, { name, clipIds })
            : await createPlaylist(name, clipIds);
        setSaving(false);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menyimpan', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: editing?.id ? 'Playlist diperbarui' : 'Playlist dibuat' });
        setEditing(null);
        await reload();
    };

    const handleDelete = async (pl) => {
        const confirmed = await confirm({
            title: 'Hapus playlist?',
            message: `"${pl.name}" akan dihapus. Audio di dalamnya tetap ada di Pustaka.`,
            confirmLabel: 'Hapus', cancelLabel: 'Batal', tone: 'danger',
        });
        if (!confirmed) return;
        const result = await deletePlaylist(pl.id);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menghapus', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: 'Playlist dihapus' });
        await reload();
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Button variant="primary" onClick={openNew} disabled={clips.length === 0}>Playlist baru</Button>
            </div>

            {loading ? (
                <p className="text-sm text-content-muted">Memuat…</p>
            ) : playlists.length === 0 ? (
                <EmptyState
                    title="Belum ada playlist"
                    description={clips.length === 0
                        ? 'Unggah audio dulu di tab Pustaka, lalu susun jadi playlist.'
                        : 'Kelompokkan beberapa audio jadi satu playlist agar bisa diputar berurutan.'}
                />
            ) : (
                <ul className="space-y-2">
                    {playlists.map((pl) => (
                        <li key={pl.id} className="flex items-center gap-3 rounded-card border border-edge bg-surface p-3 shadow-e1">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-content">{pl.name}</p>
                                <p className="font-mono text-xs tabular-nums text-content-subtle">
                                    {pl.clip_count || 0} audio · {formatDuration(pl.duration_sec)}
                                </p>
                            </div>
                            <button type="button" onClick={() => openEdit(pl)} className="shrink-0 rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:border-edge-strong hover:text-content">Ubah</button>
                            <button type="button" onClick={() => handleDelete(pl)} className="shrink-0 rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-status-fault transition-colors hover:border-status-fault/40">Hapus</button>
                        </li>
                    ))}
                </ul>
            )}

            {editing && (
                <Modal
                    title={editing.id ? `Ubah: ${editing.name}` : 'Playlist baru'}
                    size="lg"
                    onClose={() => setEditing(null)}
                    footer={(
                        <>
                            <Button onClick={() => setEditing(null)} disabled={saving}>Batal</Button>
                            <Button type="submit" form="playlist-form" variant="primary" loading={saving}>Simpan</Button>
                        </>
                    )}
                >
                    <PlaylistForm clips={clips} initial={editing} onSubmit={handleSubmit} />
                </Modal>
            )}
        </div>
    );
}
