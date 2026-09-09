/*
 * Purpose: "Pustaka" tab — upload an audio file and list stored clips (name, length, size), with
 *   quick play and delete. Uploads are re-encoded server-side to a ready-to-stream G.711 clip.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService, audioFormatting, contexts (notification/confirm), components/ui.
 * MainFuncs: LibraryTab.
 * SideEffects: uploads/deletes clips via the API.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadClip, deleteClip, importClip, getImportJobs } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Field, EmptyState } from '../../ui';
import { formatDuration, formatBytes, fileToBase64 } from './audioFormatting';

const MAX_MB = 12;
const JOB_LABEL = { queued: 'Menunggu', processing: 'Memproses…', ready: 'Selesai', failed: 'Gagal' };

export default function LibraryTab({ clips, loading, reload, onPlayClip }) {
    const [name, setName] = useState('');
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [importUrl, setImportUrl] = useState('');
    const [importName, setImportName] = useState('');
    const [importing, setImporting] = useState(false);
    const [jobs, setJobs] = useState([]);
    const fileRef = useRef(null);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    // Fetch jobs; when a job newly flips to 'ready' (it just created a clip), refresh the clip library.
    const loadJobs = useCallback(async () => {
        const r = await getImportJobs();
        if (!r.success) return;
        setJobs((prev) => {
            const next = r.data || [];
            const wasReady = new Set(prev.filter((j) => j.status === 'ready').map((j) => j.id));
            if (next.some((j) => j.status === 'ready' && !wasReady.has(j.id))) reload();
            return next;
        });
    }, [reload]);

    // Poll on a steady interval while the Pustaka tab is mounted (loadJobs is stable, so no render loop).
    useEffect(() => {
        loadJobs();
        const t = setInterval(loadJobs, 4000);
        return () => clearInterval(t);
    }, [loadJobs]);

    const handleImport = async (event) => {
        event.preventDefault();
        if (!importUrl.trim()) { showNotification({ type: 'error', title: 'Isi URL dulu' }); return; }
        setImporting(true);
        const result = await importClip(importUrl.trim(), importName.trim());
        setImporting(false);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal impor', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: 'Impor dimulai', message: 'Berjalan di latar belakang.' });
        setImportUrl('');
        setImportName('');
        await loadJobs();
    };

    const pickFile = (f) => {
        setFile(f || null);
        // Default the name to the filename (sans extension) so the operator rarely types one.
        if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ''));
    };

    const handleUpload = async (event) => {
        event.preventDefault();
        if (!file) {
            showNotification({ type: 'error', title: 'Pilih berkas audio dulu' });
            return;
        }
        if (file.size > MAX_MB * 1024 * 1024) {
            showNotification({ type: 'error', title: 'Berkas terlalu besar', message: `Maksimal ${MAX_MB}MB` });
            return;
        }
        setUploading(true);
        try {
            const base64 = await fileToBase64(file);
            const result = await uploadClip(name.trim() || file.name, base64);
            if (!result.success) {
                showNotification({ type: 'error', title: 'Gagal mengunggah', message: result.message });
                return;
            }
            showNotification({ type: 'success', title: 'Audio diunggah', message: result.data?.name });
            setName('');
            setFile(null);
            if (fileRef.current) fileRef.current.value = '';
            await reload();
        } catch (error) {
            showNotification({ type: 'error', title: 'Gagal membaca berkas', message: error.message });
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (clip) => {
        const confirmed = await confirm({
            title: 'Hapus audio?',
            message: `"${clip.name}" akan dihapus permanen. Playlist yang memakainya ikut kehilangan item ini.`,
            confirmLabel: 'Hapus',
            cancelLabel: 'Batal',
            tone: 'danger',
        });
        if (!confirmed) return;
        const result = await deleteClip(clip.id);
        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menghapus', message: result.message });
            return;
        }
        showNotification({ type: 'success', title: 'Audio dihapus' });
        await reload();
    };

    return (
        <div className="space-y-6">
            <form
                onSubmit={handleUpload}
                className="grid grid-cols-1 gap-3 rounded-card border border-edge bg-surface p-4 shadow-e1 sm:grid-cols-[1fr_auto] sm:items-end"
            >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                        label="Nama audio"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="mis. Pengumuman Pagi"
                        maxLength={120}
                    />
                    <div className="min-w-0">
                        <span className="mb-1.5 flex items-baseline gap-0.5">
                            <span className="text-xs font-semibold text-content-muted">Berkas (MP3/WAV/M4A/OGG/FLAC)</span>
                        </span>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
                            onChange={(e) => pickFile(e.target.files?.[0])}
                            className="w-full min-h-11 rounded-control border border-edge bg-surface px-3 py-2 text-sm text-content file:mr-3 file:rounded-control file:border-0 file:bg-surface-sunken file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-content-muted hover:border-edge-strong"
                        />
                    </div>
                </div>
                <Button type="submit" variant="primary" loading={uploading} disabled={!file}>
                    {uploading ? 'Mengunggah…' : 'Unggah'}
                </Button>
            </form>

            {/* Import from a link — a direct media URL (works anytime) or a YouTube link (if yt-dlp is installed). */}
            <form
                onSubmit={handleImport}
                className="grid grid-cols-1 gap-3 rounded-card border border-edge bg-surface p-4 shadow-e1 sm:grid-cols-[1fr_auto] sm:items-end"
            >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                        label="URL audio / YouTube"
                        value={importUrl}
                        onChange={(e) => setImportUrl(e.target.value)}
                        placeholder="https://…/lagu.mp3  atau  https://youtu.be/…"
                        hint="Berkas media langsung, atau tautan YouTube."
                    />
                    <Field label="Nama (opsional)" value={importName} onChange={(e) => setImportName(e.target.value)} placeholder="mis. Lagu Desa" maxLength={120} />
                </div>
                <Button type="submit" variant="secondary" loading={importing} disabled={!importUrl.trim()}>
                    {importing ? 'Memulai…' : 'Impor'}
                </Button>
                <p className="text-xs text-content-subtle sm:col-span-2">
                    Pastikan Anda berhak menyiarkan audio ini di ruang publik (hak cipta/ToS jadi tanggung jawab operator).
                </p>
            </form>

            {jobs.length > 0 && (
                <ul className="space-y-1.5">
                    {jobs.slice(0, 6).map((j) => (
                        <li key={j.id} className="flex items-center gap-2 rounded-control border border-edge bg-surface-sunken px-3 py-2 text-sm">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${
                                j.status === 'ready' ? 'bg-status-live' : j.status === 'failed' ? 'bg-status-fault' : 'bg-status-warn'
                            }`} />
                            <span className="min-w-0 flex-1 truncate text-content-muted">{j.title || j.requested_name || j.source_url}</span>
                            <span className={`shrink-0 text-xs ${j.status === 'failed' ? 'text-status-fault' : 'text-content-subtle'}`}>
                                {j.status === 'failed' && j.error ? j.error : (JOB_LABEL[j.status] || j.status)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {loading ? (
                <p className="text-sm text-content-muted">Memuat…</p>
            ) : clips.length === 0 ? (
                <EmptyState
                    title="Belum ada audio"
                    description="Unggah lagu atau rekaman pengumuman. Berkas otomatis dikonversi ke format yang siap disiarkan ke speaker kamera."
                />
            ) : (
                <ul className="space-y-2">
                    {clips.map((clip) => (
                        <li
                            key={clip.id}
                            className="flex items-center gap-3 rounded-card border border-edge bg-surface p-3 shadow-e1"
                        >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l11-2v13M9 19a2 2 0 11-4 0 2 2 0 014 0zm11-2a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-content">{clip.name}</p>
                                <p className="font-mono text-xs tabular-nums text-content-subtle">
                                    {formatDuration(clip.duration_sec)} · {formatBytes(clip.source_bytes)}
                                </p>
                            </div>
                            {onPlayClip && (
                                <button
                                    type="button"
                                    onClick={() => onPlayClip(clip)}
                                    className="shrink-0 rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:border-edge-strong hover:text-content"
                                >
                                    Putar
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => handleDelete(clip)}
                                className="shrink-0 rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-status-fault transition-colors hover:border-status-fault/40"
                            >
                                Hapus
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
