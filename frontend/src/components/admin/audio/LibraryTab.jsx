/*
 * Purpose: "Pustaka" tab — upload an audio file and list stored clips (name, length, size), with
 *   quick play and delete. Uploads are re-encoded server-side to a ready-to-stream G.711 clip.
 * Caller: pages/AudioBroadcast.jsx.
 * Deps: audioService, audioFormatting, contexts (notification/confirm), components/ui.
 * MainFuncs: LibraryTab.
 * SideEffects: uploads/deletes clips via the API.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadClip, deleteClip, updateClipMeta, importClip, getImportJobs, getTtsEngines, createTts, getTemplates, createTemplate, deleteTemplate, fetchClipPreview, getTtsConfig, setTtsConfig, previewTtsVoice } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Button, Field, EmptyState } from '../../ui';
import { formatDuration, formatBytes, fileToBase64 } from './audioFormatting';

const MAX_MB = 12;
const MAX_TTS = 1500;
const JOB_LABEL = { queued: 'Menunggu', processing: 'Memproses…', ready: 'Selesai', failed: 'Gagal' };

export default function LibraryTab({ clips, loading, reload, onPlayClip }) {
    const [name, setName] = useState('');
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [importUrl, setImportUrl] = useState('');
    const [importName, setImportName] = useState('');
    const [importing, setImporting] = useState(false);
    const [jobs, setJobs] = useState([]);
    // TTS (ketik teks -> suara)
    const [ttsText, setTtsText] = useState('');
    const [ttsName, setTtsName] = useState('');
    const [ttsEngine, setTtsEngine] = useState('');
    const [ttsVoice, setTtsVoice] = useState('');
    const [engines, setEngines] = useState([]);
    const [ttsBusy, setTtsBusy] = useState(false);
    const [ttsCfg, setTtsCfg] = useState(null);       // { gemini_configured, gemini_source, gemini_hint }
    const [geminiKey, setGeminiKey] = useState('');
    const [savingKey, setSavingKey] = useState(false);
    const [voicePreviewBusy, setVoicePreviewBusy] = useState(false);
    const [templates, setTemplates] = useState([]);
    const [templateId, setTemplateId] = useState('');
    const [tplBody, setTplBody] = useState('');
    const [tplFills, setTplFills] = useState({});
    const [favOnly, setFavOnly] = useState(false);
    const [catFilter, setCatFilter] = useState('');
    // In-page preview: which clip is loaded in the hidden <audio>, and whether it's playing.
    const [previewId, setPreviewId] = useState(null);
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const audioRef = useRef(null);
    const previewUrlRef = useRef(null);
    const fileRef = useRef(null);
    const { showNotification } = useNotification();
    const confirm = useConfirm();

    // Load TTS engines/voices + cloud-key status. autoPick (first load) defaults to the most NATURAL
    // available engine (prefer an online neural voice — offline piper is noticeably more robotic).
    const loadEngines = useCallback(async (autoPick) => {
        const [r, c] = await Promise.all([getTtsEngines(), getTtsConfig()]);
        if (c.success) setTtsCfg(c.data);
        if (!r.success) return;
        const list = r.data || [];
        setEngines(list);
        if (autoPick) {
            const pick = list.find((e) => e.available && e.online) || list.find((e) => e.available) || list[0];
            if (pick) { setTtsEngine(pick.id); setTtsVoice(pick.voices?.[0]?.id || ''); }
        }
    }, []);
    useEffect(() => { loadEngines(true); }, [loadEngines]);

    const saveGeminiKey = async () => {
        if (!geminiKey.trim()) { showNotification({ type: 'error', title: 'Tempel kunci API dulu' }); return; }
        setSavingKey(true);
        const r = await setTtsConfig({ geminiApiKey: geminiKey.trim() });
        setSavingKey(false);
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        setGeminiKey('');
        showNotification({ type: 'success', title: 'Kunci Gemini disimpan', message: 'Mesin Gemini aktif.' });
        await loadEngines(false); // refresh availability, keep the current selection
    };
    const removeGeminiKey = async () => {
        const r = await setTtsConfig({ geminiApiKey: '' });
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        showNotification({ type: 'success', title: 'Kunci dihapus' });
        await loadEngines(false);
    };

    // Stop + release the current preview (revoke the blob URL so it doesn't leak).
    const stopPreview = useCallback(() => {
        const a = audioRef.current;
        if (a) { try { a.pause(); } catch { /* not started */ } a.removeAttribute('src'); try { a.load(); } catch { /* ignore */ } }
        if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
        setPreviewId(null);
        setPreviewPlaying(false);
    }, []);
    // Release the preview on unmount.
    useEffect(() => stopPreview, [stopPreview]);

    // "Putar" now PREVIEWS the clip in the browser (not a jump to the broadcast tab). Toggle: playing this
    // clip -> pause; otherwise fetch a WAV blob (decoded server-side from u-law) and play it inline.
    const togglePreview = async (clip) => {
        const a = audioRef.current;
        if (!a) return;
        if (previewId === clip.id) {
            if (previewPlaying) { a.pause(); } else { try { await a.play(); } catch { /* ignore */ } }
            return;
        }
        stopPreview();
        const r = await fetchClipPreview(clip.id);
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal pratinjau', message: r.message }); return; }
        previewUrlRef.current = r.url;
        a.src = r.url;
        setPreviewId(clip.id);
        try { await a.play(); } catch { /* a user gesture triggered this, so autoplay is allowed */ }
    };

    // "Coba suara": synthesize a short sample with the chosen engine/voice and play it inline, so the
    // operator hears the voice BEFORE creating a clip or broadcasting to the cameras.
    const previewVoice = async () => {
        const a = audioRef.current;
        if (!a) return;
        setVoicePreviewBusy(true);
        stopPreview();
        const r = await previewTtsVoice({ text: ttsText.trim(), engine: ttsEngine, voice: ttsVoice });
        setVoicePreviewBusy(false);
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal coba suara', message: r.message }); return; }
        previewUrlRef.current = r.url;
        a.src = r.url;
        setPreviewId('voice-preview');
        try { await a.play(); } catch { /* user gesture present */ }
    };

    const loadTemplates = useCallback(async () => {
        const r = await getTemplates();
        if (r.success) setTemplates(r.data || []);
    }, []);
    useEffect(() => { loadTemplates(); }, [loadTemplates]);

    // Fill-in-the-blank: parse {placeholder} tokens so the operator fills a FIELD (replacing EVERY
    // occurrence at once) instead of hand-editing raw text — a missed {nama} would otherwise be spoken.
    const PLACEHOLDER_RE = /\{([^{}]+)\}/g;
    const parsePlaceholders = (body) => [...new Set((String(body).match(PLACEHOLDER_RE) || []).map((m) => m.slice(1, -1)))];
    const substitute = (body, fills) => String(body).replace(PLACEHOLDER_RE, (m, k) => (fills[k] && fills[k].trim() ? fills[k].trim() : m));
    const placeholders = tplBody ? parsePlaceholders(tplBody) : [];

    const applyTemplate = (id) => {
        setTemplateId(id);
        const t = templates.find((x) => String(x.id) === String(id));
        if (!t) { setTplBody(''); setTplFills({}); return; }
        setTplBody(t.body);
        setTplFills({});
        setTtsText(t.body);
        if (!ttsName.trim()) setTtsName(t.name);
    };
    const setFill = (key, val) => {
        const next = { ...tplFills, [key]: val };
        setTplFills(next);
        setTtsText(substitute(tplBody, next));
    };
    const saveAsTemplate = async () => {
        const name = window.prompt('Nama template:');
        if (!name || !name.trim()) return;
        const r = await createTemplate({ name: name.trim(), body: ttsText.trim() });
        if (r.success) { showNotification({ type: 'success', title: 'Template disimpan' }); loadTemplates(); }
        else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };
    const removeTemplate = async () => {
        const t = templates.find((x) => String(x.id) === String(templateId));
        if (!t) return;
        const ok = await confirm({ title: 'Hapus template?', message: `"${t.name}" akan dihapus.`, confirmLabel: 'Hapus', cancelLabel: 'Batal', tone: 'danger' });
        if (!ok) return;
        const r = await deleteTemplate(t.id);
        if (r.success) { setTemplateId(''); loadTemplates(); } else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };

    const currentEngine = engines.find((e) => e.id === ttsEngine);

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
        // Determine success from the JOB LIST, not the POST response: under a Cloudflare idle-drop the POST
        // reaches the server (a job is created) but the client sees a network error. So the truth is
        // "did a new job appear?", which is idempotent + reliable.
        const beforeIds = new Set(jobs.map((j) => j.id));
        const result = await importClip(importUrl.trim(), importName.trim());
        const jr = await getImportJobs();
        setImporting(false);
        const freshJobs = jr.success ? (jr.data || []) : jobs;
        setJobs(freshJobs);
        const created = freshJobs.some((j) => !beforeIds.has(j.id));
        if (result.success || created) {
            showNotification({ type: 'success', title: 'Impor dimulai', message: 'Berjalan di latar belakang.' });
            setImportUrl('');
            setImportName('');
            return;
        }
        // No new job AND the POST failed -> a genuine error (e.g. invalid/blocked URL).
        showNotification({ type: 'error', title: 'Gagal impor', message: result.message });
    };

    const onEngineChange = (id) => {
        setTtsEngine(id);
        const e = engines.find((x) => x.id === id);
        setTtsVoice(e?.voices?.[0]?.id || '');
    };

    const handleTts = async (event) => {
        event.preventDefault();
        if (!ttsText.trim()) { showNotification({ type: 'error', title: 'Tulis teksnya dulu' }); return; }
        // Catch a missed {placeholder} before it becomes silent/garbled speech.
        if (/\{[^{}]+\}/.test(ttsText)) {
            const ok = await confirm({
                title: 'Masih ada bagian belum diisi',
                message: 'Ada bagian {…} yang belum diisi — bagian itu tidak akan dibacakan. Tetap buat suara?',
                confirmLabel: 'Tetap buat', cancelLabel: 'Batal', tone: 'default',
            });
            if (!ok) return;
        }
        setTtsBusy(true);
        // Outcome-checked like import: a job appearing is the source of truth (survives a Cloudflare idle-drop).
        const beforeIds = new Set(jobs.map((j) => j.id));
        const result = await createTts({ text: ttsText.trim(), engine: ttsEngine, voice: ttsVoice, name: ttsName.trim() });
        const jr = await getImportJobs();
        setTtsBusy(false);
        const freshJobs = jr.success ? (jr.data || []) : jobs;
        setJobs(freshJobs);
        const created = freshJobs.some((j) => !beforeIds.has(j.id));
        if (result.success || created) {
            showNotification({ type: 'success', title: 'Suara sedang dibuat', message: 'Muncul di pustaka saat selesai.' });
            setTtsText('');
            setTtsName('');
            return;
        }
        showNotification({ type: 'error', title: 'Gagal membuat suara', message: result.message });
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

    const toggleFav = async (clip) => {
        const r = await updateClipMeta(clip.id, { isFavorite: !clip.is_favorite });
        if (r.success) reload(); else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };
    const editCategory = async (clip) => {
        const cat = window.prompt('Kategori audio (kosongkan untuk hapus):', clip.category || '');
        if (cat === null) return;
        const r = await updateClipMeta(clip.id, { category: cat });
        if (r.success) reload(); else showNotification({ type: 'error', title: 'Gagal', message: r.message });
    };

    // Filter chips: favourites + distinct categories.
    const categories = [...new Set(clips.map((c) => c.category).filter(Boolean))].sort();
    const shownClips = clips.filter((c) => (!favOnly || c.is_favorite) && (!catFilter || c.category === catFilter));

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
            {/* Hidden player for in-page clip preview (▶ Putar). One per tab; state mirrors its events. */}
            <audio
                ref={audioRef}
                className="hidden"
                onPlay={() => setPreviewPlaying(true)}
                onPause={() => setPreviewPlaying(false)}
                onEnded={stopPreview}
            />
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

            {/* Buat suara dari teks (TTS) — suara neural natural, bukan robot. */}
            <form onSubmit={handleTts} className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-e1">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-content">Buat suara dari teks (TTS)</span>
                    <span className="text-xs text-content-subtle">{ttsText.length}/{MAX_TTS}</span>
                </div>

                {/* Template pengumuman: pilih -> isi otomatis, ganti bagian {…}. */}
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={templateId}
                        onChange={(e) => applyTemplate(e.target.value)}
                        className="min-w-0 flex-1 rounded-control border border-edge bg-surface px-2 py-1.5 text-sm text-content focus:border-primary focus:outline-none"
                    >
                        <option value="">— pakai template —</option>
                        {templates.map((t) => (
                            <option key={t.id} value={t.id}>{t.category ? `${t.category} · ` : ''}{t.name}</option>
                        ))}
                    </select>
                    {templateId && (
                        <button type="button" onClick={removeTemplate} className="shrink-0 rounded-control border border-edge px-2.5 py-1.5 text-xs font-medium text-status-fault hover:border-status-fault/40">Hapus template</button>
                    )}
                    <button type="button" onClick={saveAsTemplate} disabled={!ttsText.trim()} className="shrink-0 rounded-control border border-edge px-2.5 py-1.5 text-xs font-medium text-content-muted hover:border-edge-strong disabled:opacity-40">Simpan teks jadi template</button>
                </div>

                {/* Isian per-placeholder: isi sekali -> ganti SEMUA kemunculan {ini} di teks. */}
                {placeholders.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 rounded-control border border-edge bg-surface-sunken p-2 sm:grid-cols-3">
                        {placeholders.map((key) => (
                            <label key={key} className="text-xs text-content-muted">
                                <span className="mb-0.5 block truncate">{key}</span>
                                <input
                                    type="text"
                                    value={tplFills[key] || ''}
                                    onChange={(e) => setFill(key, e.target.value)}
                                    placeholder={`isi ${key}`}
                                    className="w-full rounded-control border border-edge bg-surface px-2 py-1 text-sm text-content focus:border-primary focus:outline-none"
                                />
                            </label>
                        ))}
                    </div>
                )}

                <textarea
                    value={ttsText}
                    onChange={(e) => setTtsText(e.target.value.slice(0, MAX_TTS))}
                    rows={3}
                    placeholder="Ketik pengumuman… mis. 'Diberitahukan kepada seluruh warga, kerja bakti akan dilaksanakan besok pagi pukul tujuh.'"
                    className="w-full rounded-control border border-edge bg-surface px-3 py-2 text-sm text-content focus:border-primary focus:outline-none"
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="min-w-0">
                        <span className="mb-1.5 block text-xs font-semibold text-content-muted">Mesin suara</span>
                        <select
                            value={ttsEngine}
                            onChange={(e) => onEngineChange(e.target.value)}
                            className="w-full min-h-11 rounded-control border border-edge bg-surface px-3 py-2 text-sm text-content focus:border-primary focus:outline-none"
                        >
                            {engines.map((e) => (
                                // NOT disabled even when unavailable: Gemini becomes available only AFTER a key
                                // is pasted, and the key box below only shows when Gemini is selected — disabling
                                // the option made entering the key impossible. Selecting an unavailable engine
                                // just reveals its activation hint; the synth buttons stay disabled until ready.
                                <option key={e.id} value={e.id}>
                                    {e.label}{e.available ? '' : (e.id === 'gemini' ? ' — belum aktif (butuh kunci)' : ' — belum terpasang')}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="min-w-0">
                        <span className="mb-1.5 block text-xs font-semibold text-content-muted">Suara</span>
                        <select
                            value={ttsVoice}
                            onChange={(e) => setTtsVoice(e.target.value)}
                            className="w-full min-h-11 rounded-control border border-edge bg-surface px-3 py-2 text-sm text-content focus:border-primary focus:outline-none"
                        >
                            {(currentEngine?.voices || []).map((v) => (
                                <option key={v.id} value={v.id}>{v.label}</option>
                            ))}
                        </select>
                    </div>
                    <Field label="Nama (opsional)" value={ttsName} onChange={(e) => setTtsName(e.target.value)} placeholder="mis. Kerja Bakti" maxLength={120} />
                </div>

                {/* Gemini = mesin cloud paling natural; operator tempel kunci API GRATIS di sini (tanpa SSH). */}
                {currentEngine?.id === 'gemini' && (
                    ttsCfg?.gemini_configured ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-status-live/30 bg-status-live/10 p-2.5 text-xs">
                            <span className="text-content-muted">
                                ✓ Gemini aktif{ttsCfg.gemini_hint ? ` — kunci ${ttsCfg.gemini_hint}` : ''}{ttsCfg.gemini_source === 'env' ? ' (dari server)' : ''}. Bisa disuruh bicara santai.
                            </span>
                            {ttsCfg.gemini_source === 'ui' && (
                                <button type="button" onClick={removeGeminiKey} className="shrink-0 font-medium text-status-fault hover:underline">Hapus kunci</button>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-2 rounded-control border border-status-warn/40 bg-status-warn/10 p-2.5">
                            <p className="text-xs text-content-muted">
                                Gemini butuh kunci API <span className="font-semibold">gratis</span> (tanpa kartu kredit). Buat di{' '}
                                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">aistudio.google.com/apikey</a>, lalu tempel di sini.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    type="password"
                                    value={geminiKey}
                                    onChange={(e) => setGeminiKey(e.target.value)}
                                    placeholder="Tempel kunci API Gemini (AIza…)"
                                    className="min-w-0 flex-1 rounded-control border border-edge bg-surface px-2.5 py-1.5 text-sm text-content focus:border-primary focus:outline-none"
                                />
                                <Button type="button" variant="secondary" loading={savingKey} onClick={saveGeminiKey} disabled={!geminiKey.trim()}>Simpan kunci</Button>
                            </div>
                        </div>
                    )
                )}

                <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-content-subtle">
                        {currentEngine?.id === 'gemini' ? 'Suara cloud paling natural — dibuat sekali lalu tersimpan (main offline).'
                            : currentEngine?.online ? 'Suara cloud gratis (butuh internet), natural.' : 'Suara offline di server, natural (bukan robot).'}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button type="button" variant="ghost" loading={voicePreviewBusy} disabled={!currentEngine?.available} onClick={previewVoice} title="Dengar contoh suara sebelum dibuat/disiarkan">
                            {voicePreviewBusy ? 'Menyiapkan…' : '🔊 Coba suara'}
                        </Button>
                        <Button type="submit" variant="secondary" loading={ttsBusy} disabled={!ttsText.trim() || !currentEngine?.available}>
                            {ttsBusy ? 'Membuat…' : 'Buat suara'}
                        </Button>
                    </div>
                </div>
                {engines.length > 0 && !engines.some((e) => e.available) && (
                    <p className="text-xs text-status-warn">Belum ada mesin TTS terpasang di server. Hubungi admin untuk memasang Piper/edge-tts.</p>
                )}
            </form>

            {jobs.length > 0 && (
                <ul className="space-y-1.5">
                    {jobs.slice(0, 6).map((j) => (
                        <li key={j.id} className="flex items-center gap-2 rounded-control border border-edge bg-surface-sunken px-3 py-2 text-sm">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${
                                j.status === 'ready' ? 'bg-status-live' : j.status === 'failed' ? 'bg-status-fault' : 'bg-status-warn'
                            }`} />
                            <span className="min-w-0 flex-1 truncate text-content-muted">{j.title || j.requested_name || (j.source_kind === 'tts' ? j.tts_text : j.source_url)}</span>
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
                <div className="space-y-2">
                    {/* Filter: favourites + categories (favourites sort first from the server). */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setFavOnly((v) => !v)}
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${favOnly ? 'border-status-warn/40 bg-status-warn/10 text-status-warn' : 'border-edge bg-surface text-content-muted hover:border-edge-strong'}`}
                        >
                            ★ Favorit
                        </button>
                        {categories.length > 0 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setCatFilter('')}
                                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${!catFilter ? 'border-primary bg-primary/10 text-primary' : 'border-edge bg-surface text-content-muted hover:border-edge-strong'}`}
                                >
                                    Semua
                                </button>
                                {categories.map((cat) => (
                                    <button
                                        key={cat}
                                        type="button"
                                        onClick={() => setCatFilter(cat === catFilter ? '' : cat)}
                                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${catFilter === cat ? 'border-primary bg-primary/10 text-primary' : 'border-edge bg-surface text-content-muted hover:border-edge-strong'}`}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </>
                        )}
                    </div>

                    <ul className="space-y-2">
                        {shownClips.map((clip) => (
                            <li
                                key={clip.id}
                                className="flex items-center gap-3 rounded-card border border-edge bg-surface p-3 shadow-e1"
                            >
                                <button
                                    type="button"
                                    onClick={() => toggleFav(clip)}
                                    aria-label={clip.is_favorite ? 'Hapus dari favorit' : 'Jadikan favorit'}
                                    className={`shrink-0 text-lg leading-none transition-colors ${clip.is_favorite ? 'text-status-warn' : 'text-content-subtle hover:text-status-warn'}`}
                                >
                                    {clip.is_favorite ? '★' : '☆'}
                                </button>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-content">
                                        {clip.name}
                                        {clip.category ? <span className="ml-1.5 rounded-full bg-surface-sunken px-1.5 py-0.5 text-xs font-normal text-content-muted">{clip.category}</span> : null}
                                    </p>
                                    <p className="font-mono text-xs tabular-nums text-content-subtle">
                                        {formatDuration(clip.duration_sec)}
                                        {clip.source_bytes > 0 ? ` · ${formatBytes(clip.source_bytes)}` : ''}
                                        {clip.source_type === 'youtube' ? ' · YouTube' : clip.source_type === 'url' ? ' · URL' : clip.source_type === 'tts' ? ' · Suara (TTS)' : ''}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => editCategory(clip)}
                                    className="shrink-0 rounded-control border border-edge bg-surface px-2.5 py-1.5 text-xs font-medium text-content-subtle transition-colors hover:border-edge-strong hover:text-content"
                                    title="Beri/ubah kategori"
                                >
                                    Kategori
                                </button>
                                <button
                                    type="button"
                                    onClick={() => togglePreview(clip)}
                                    className={`shrink-0 rounded-control border px-3 py-1.5 text-sm font-medium transition-colors ${
                                        previewId === clip.id
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'border-edge bg-surface text-content-muted hover:border-edge-strong hover:text-content'
                                    }`}
                                    title="Dengarkan di sini (pratinjau)"
                                >
                                    {previewId === clip.id && previewPlaying ? '⏸ Jeda' : '▶ Putar'}
                                </button>
                                {onPlayClip && (
                                    <button
                                        type="button"
                                        onClick={() => onPlayClip(clip)}
                                        className="shrink-0 rounded-control border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:border-edge-strong hover:text-content"
                                        title="Kirim ke tab Putar Sekarang untuk disiarkan ke speaker kamera"
                                    >
                                        Siarkan
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
                        {shownClips.length === 0 && (
                            <li className="rounded-control border border-dashed border-edge bg-surface-sunken p-3 text-center text-xs text-content-subtle">Tak ada audio yang cocok filter.</li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}
