/*
 * Purpose: Editor for one provider promo banner — poster upload, targeting, schedule, CTA.
 * Caller: pages/PromoBannerManagement.jsx.
 * Deps: promoBannerService (upload), NotificationContext.
 * MainFuncs: PromoBannerForm, PROMO_FORM_ID.
 * SideEffects: Reads a local file into base64 and POSTs it to the image endpoint.
 *
 * NO ACTION ROW HERE. This is the body of a ui/Modal, so Simpan and Batal live in the dialog's
 * pinned footer — reachable above the keyboard and above env(safe-area-inset-bottom) instead of a
 * two-dozen-field scroll away — and reach back into the form through `form={PROMO_FORM_ID}`. The
 * caller passes dismissible={false} so a stray backdrop tap cannot discard the draft.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadPromoBannerImage } from '../../../services/promoBannerService';
import { useNotification } from '../../../contexts/NotificationContext';

const PLACEMENT_OPTIONS = [
    { key: 'popup', label: 'Bawah video live', hint: 'Saat pengunjung menonton satu kamera' },
    { key: 'area', label: 'Halaman area', hint: 'Halaman publik per-area' },
    { key: 'landing', label: 'Halaman depan', hint: 'Di bawah daftar kamera' },
    { key: 'playback', label: 'Halaman rekaman', hint: 'Di bawah pemutar rekaman' },
];

const TARGET_OPTIONS = [
    { key: 'all', label: 'Semua kamera', hint: 'Tampil di mana saja' },
    { key: 'area', label: 'Area tertentu', hint: 'Mis. DANDER & TANJUNGHARJO' },
    { key: 'camera', label: 'Kamera tertentu', hint: 'Pilih satu per satu' },
];

// Mirrors MAX_PROMO_UPLOAD_BYTES on the backend; checked here too so an oversized
// file is refused before it is read into memory and sent over a slow uplink.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/* The Modal footer's Simpan button sits outside this <form> and targets it by id. */
export const PROMO_FORM_ID = 'promo-banner-form';

const EMPTY = {
    title: '',
    alt_text: '',
    cta_label: 'Tanya Pemasangan',
    cta_url: '',
    whatsapp_number: '',
    whatsapp_message: 'Halo, saya ingin bertanya tentang pemasangan CCTV di {area}.',
    target_mode: 'all',
    placements: ['popup'],
    active: true,
    start_date: '',
    end_date: '',
    priority: 100,
    area_ids: [],
    camera_ids: [],
};

function Field({ label, hint, children }) {
    return (
        <label className="block">
            <span className="mb-1 block text-sm font-medium text-content">{label}</span>
            {children}
            {hint && <span className="mt-1 block text-xs text-content-subtle">{hint}</span>}
        </label>
    );
}

const inputClass = 'w-full rounded-control border border-edge bg-surface px-3 py-2 text-sm text-content transition-colors focus:border-edge-strong focus:outline-none';

/**
 * Searchable multi-select. Cameras number in the hundreds, so the list is filtered
 * down and capped — an unfiltered 750-row checkbox list is unusable and slow.
 */
function TargetPicker({ label, options, selected, onChange, searchable }) {
    const [term, setTerm] = useState('');

    const visible = useMemo(() => {
        const needle = term.trim().toLowerCase();
        const matched = needle
            ? options.filter((option) => option.label.toLowerCase().includes(needle))
            : options;
        return matched.slice(0, 200);
    }, [options, term]);

    const toggle = (id) => {
        onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
    };

    return (
        <div className="rounded-card border border-edge bg-surface-sunken p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-content">{label}</span>
                <span className="font-mono text-xs tabular-nums text-content-subtle">{selected.length} dipilih</span>
            </div>

            {searchable && (
                <input
                    type="search"
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                    placeholder="Cari nama…"
                    aria-label={`Cari ${label}`}
                    className={`${inputClass} mb-2`}
                />
            )}

            <div className="max-h-56 space-y-1 overflow-y-auto">
                {visible.length === 0 && (
                    <p className="py-2 text-xs text-content-subtle">Tidak ada yang cocok.</p>
                )}
                {visible.map((option) => (
                    <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-sm text-content-muted hover:bg-surface-raised">
                        <input
                            type="checkbox"
                            checked={selected.includes(option.id)}
                            onChange={() => toggle(option.id)}
                            className="h-4 w-4 shrink-0"
                        />
                        <span className="min-w-0 truncate">{option.label}</span>
                    </label>
                ))}
            </div>

            {options.length > visible.length && (
                <p className="mt-2 text-xs text-content-subtle">
                    Menampilkan {visible.length} dari {options.length}. Gunakan pencarian untuk mempersempit.
                </p>
            )}
        </div>
    );
}

export default function PromoBannerForm({ promo, areas, cameras, onSubmit, onUploaded }) {
    const [form, setForm] = useState(EMPTY);
    const [uploading, setUploading] = useState(false);
    const [uploadInfo, setUploadInfo] = useState(null);
    /*
     * A brand-new promo has no id yet, and the image endpoint needs one. Rather than
     * dead-ending the file picker until after a save, the chosen file is held here
     * with a local preview and uploaded automatically once the promo exists.
     */
    const [pendingFile, setPendingFile] = useState(null);
    const [pendingPreview, setPendingPreview] = useState(null);
    const fileInputRef = useRef(null);
    // Mirrors pendingPreview so unmount cleanup can revoke without a state update.
    const pendingPreviewRef = useRef(null);
    const { showNotification } = useNotification();

    // An object URL holds its blob until revoked.
    const replacePendingPreview = useCallback((url) => {
        if (pendingPreviewRef.current) {
            URL.revokeObjectURL(pendingPreviewRef.current);
        }
        pendingPreviewRef.current = url;
        setPendingPreview(url);
    }, []);

    useEffect(() => () => {
        if (pendingPreviewRef.current) {
            URL.revokeObjectURL(pendingPreviewRef.current);
            pendingPreviewRef.current = null;
        }
    }, []);

    /*
     * Switching to a different promo drops any draft poster, so it can never be
     * attached to the wrong banner. The save path is unaffected: handleSubmit holds
     * the file in its own closure, so clearing state here does not cancel the upload.
     */
    useEffect(() => {
        setPendingFile(null);
        replacePendingPreview(null);
        if (!promo) {
            setForm(EMPTY);
            setUploadInfo(null);
            return;
        }
        setForm({
            ...EMPTY,
            ...promo,
            active: Boolean(promo.active),
            start_date: promo.start_date || '',
            end_date: promo.end_date || '',
            placements: promo.placements?.length ? promo.placements : ['popup'],
            area_ids: promo.area_ids || [],
            camera_ids: promo.camera_ids || [],
        });
        setUploadInfo(null);
    }, [promo, replacePendingPreview]);

    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

    const togglePlacement = (key) => {
        set('placements', form.placements.includes(key)
            ? form.placements.filter((value) => value !== key)
            : [...form.placements, key]);
    };

    // Clearing the input matters: without it, re-picking the SAME file fires no
    // change event, so a rejected file cannot be retried after fixing nothing.
    const resetFileInput = () => {
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const rejectionReason = (file) => {
        if (!ACCEPTED_TYPES.includes(file.type)) {
            return { title: 'Format tidak didukung', message: 'Gunakan PNG, JPG, atau WebP.' };
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return {
                title: 'Gambar terlalu besar',
                message: `Maksimal ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB, berkas ini ${(file.size / (1024 * 1024)).toFixed(1)}MB.`,
            };
        }
        return null;
    };

    const handleFile = async (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        const rejection = rejectionReason(file);
        if (rejection) {
            showNotification({ type: 'error', ...rejection });
            resetFileInput();
            return;
        }

        if (!promo?.id) {
            // Nothing to attach it to yet — hold it and preview locally.
            // handleSubmit uploads it as soon as the promo has an id.
            setPendingFile(file);
            replacePendingPreview(URL.createObjectURL(file));
            return;
        }

        await uploadFile(promo.id, file);
    };

    const uploadFile = async (promoId, file) => {
        setUploading(true);
        try {
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
                reader.onerror = () => reject(new Error('Gagal membaca berkas'));
                reader.readAsDataURL(file);
            });

            const result = await uploadPromoBannerImage(promoId, base64);
            if (!result.success) {
                showNotification({ type: 'error', title: 'Gagal mengunggah', message: result.message });
                return false;
            }

            const image = result.data?.image;
            setUploadInfo({ ...image, sourceName: file.name });
            setPendingFile(null);
            replacePendingPreview(null);
            showNotification({
                type: 'success',
                title: 'Gambar diunggah',
                message: `Dikonversi ke WebP: ${(file.size / 1024).toFixed(0)}KB → ${(image.bytes / 1024).toFixed(0)}KB.`,
            });
            // The list row still shows "Tanpa gambar" until the parent refetches.
            onUploaded?.();
            return true;
        } catch (error) {
            showNotification({ type: 'error', title: 'Gagal mengunggah', message: error.message });
            return false;
        } finally {
            setUploading(false);
            resetFileInput();
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        /*
         * A banner targeted at "area" or "camera" with nothing selected matches
         * nothing and silently never appears. Better to say so than to let the
         * operator believe it is live.
         */
        if (form.placements.length === 0) {
            showNotification({ type: 'warning', title: 'Lokasi tampil kosong', message: 'Centang minimal satu lokasi tampil.' });
            return;
        }
        if (form.target_mode === 'area' && form.area_ids.length === 0) {
            showNotification({ type: 'warning', title: 'Area belum dipilih', message: 'Pilih minimal satu area, atau ubah ke "Semua kamera".' });
            return;
        }
        if (form.target_mode === 'camera' && form.camera_ids.length === 0) {
            showNotification({ type: 'warning', title: 'Kamera belum dipilih', message: 'Pilih minimal satu kamera, atau ubah ke "Semua kamera".' });
            return;
        }

        const saved = await onSubmit({
            ...form,
            priority: Number.parseInt(form.priority, 10) || 100,
            start_date: form.start_date || null,
            end_date: form.end_date || null,
        });

        // Now that the promo has an id, flush the poster the operator picked
        // while it was still a draft.
        if (saved?.id && pendingFile) {
            await uploadFile(saved.id, pendingFile);
        }
    };

    const areaOptions = useMemo(() => areas.map((area) => ({ id: area.id, label: area.name })), [areas]);
    const cameraOptions = useMemo(
        () => cameras.map((camera) => ({ id: camera.id, label: camera.name })),
        [cameras]
    );

    // A locally-picked file wins over what is stored, so the operator sees the
    // poster they just chose rather than the one it is about to replace.
    const storedImageBase = uploadInfo?.imageBase || promo?.image_base;
    const previewSrc = pendingPreview || (storedImageBase ? `/api/promo-media/${storedImageBase}-640.webp` : null);

    return (
        <form id={PROMO_FORM_ID} onSubmit={handleSubmit} className="space-y-5">
            <Field label="Judul promo" hint="Hanya untuk pengelolaan internal — tidak tampil di poster.">
                <input
                    type="text"
                    required
                    value={form.title}
                    onChange={(event) => set('title', event.target.value)}
                    placeholder="Pemasangan CCTV Gratis"
                    className={inputClass}
                />
            </Field>

            {/* --------------------------------------------------------- poster */}
            <div className="rounded-card border border-edge bg-surface-sunken p-3">
                <span className="mb-2 block text-sm font-medium text-content">Gambar poster</span>

                {previewSrc ? (
                    <img
                        src={previewSrc}
                        alt="Pratinjau poster promo"
                        className="mb-3 h-auto w-full max-w-sm rounded-card border border-edge"
                    />
                ) : (
                    <p className="mb-3 text-xs text-content-subtle">Belum ada gambar.</p>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TYPES.join(',')}
                    onChange={handleFile}
                    disabled={uploading}
                    aria-label="Pilih gambar poster"
                    className="block w-full text-sm text-content-muted file:mr-3 file:rounded-control file:border file:border-edge file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-content"
                />
                <p className="mt-2 text-xs text-content-subtle">
                    PNG/JPG/WebP, maksimal {Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB. Otomatis dikecilkan jadi WebP 1200px + 640px.
                </p>
                {pendingFile && (
                    <p className="mt-1 text-xs text-content-muted">
                        <strong>{pendingFile.name}</strong> akan diunggah otomatis begitu promo disimpan.
                    </p>
                )}
                {uploading && <p className="mt-2 text-xs text-content-muted">Mengunggah dan mengonversi…</p>}
                {uploadInfo && (
                    <p className="mt-2 font-mono text-xs tabular-nums text-content-muted">
                        {uploadInfo.width}×{uploadInfo.height} · {uploadInfo.renditions?.map((r) => `${r.key}px=${Math.round(r.bytes / 1024)}KB`).join(' · ')}
                    </p>
                )}
            </div>

            <Field label="Teks alternatif (alt)" hint="Dibacakan pembaca layar dan tampil saat gambar gagal dimuat. Ringkas isi posternya.">
                <input
                    type="text"
                    value={form.alt_text}
                    onChange={(event) => set('alt_text', event.target.value)}
                    placeholder="Promo pemasangan CCTV gratis untuk area minimal 6 pelanggan"
                    className={inputClass}
                />
            </Field>

            {/* ----------------------------------------------------- placements */}
            <fieldset className="rounded-card border border-edge bg-surface-sunken p-3">
                <legend className="px-1 text-sm font-medium text-content">Lokasi tampil</legend>

                {/*
                 * The landing page is not about any one camera, so there is no area to
                 * match against. An area/camera-targeted banner therefore never appears
                 * there. Saying so beats letting the operator tick the box and wonder
                 * why the poster never shows up.
                 */}
                {form.placements.includes('landing') && form.target_mode !== 'all' && (
                    <p className="mb-3 rounded-control border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-xs text-status-warn">
                        Halaman depan tidak terikat satu kamera, jadi promo dengan target{' '}
                        {form.target_mode === 'area' ? 'area' : 'kamera'} tertentu <strong>tidak akan tampil di sana</strong>.
                        Pilih target &quot;Semua kamera&quot; kalau memang ingin tampil di halaman depan.
                    </p>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                    {PLACEMENT_OPTIONS.map((option) => (
                        <label key={option.key} className="flex cursor-pointer items-start gap-2 rounded-control p-2 text-sm hover:bg-surface-raised">
                            <input
                                type="checkbox"
                                checked={form.placements.includes(option.key)}
                                onChange={() => togglePlacement(option.key)}
                                className="mt-0.5 h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0">
                                <span className="block text-content">{option.label}</span>
                                <span className="block text-xs text-content-subtle">{option.hint}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>

            {/* --------------------------------------------------------- targeting */}
            {/*
              * `min-w-0` is load-bearing, not tidy-up. A <fieldset> keeps the UA default
              * `min-inline-size: min-content` and Tailwind preflight never resets it, so with the
              * 750-camera picker open this block refused to shrink and measured 729px inside a
              * 391px dialog body (1092px at 1.5x root font) — the picker's checkbox column ran off
              * the panel edge. Identical defect to the 689px affiliate one, found the moment the
              * admin-overflow guard could finally see inside a dialog. Do not remove it.
              */}
            <fieldset className="min-w-0 space-y-3">
                <legend className="text-sm font-medium text-content">Tampil di kamera mana</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                    {TARGET_OPTIONS.map((option) => (
                        <label key={option.key} className="flex cursor-pointer items-start gap-2 rounded-card border border-edge bg-surface p-2 text-sm hover:border-edge-strong">
                            <input
                                type="radio"
                                name="target_mode"
                                checked={form.target_mode === option.key}
                                onChange={() => set('target_mode', option.key)}
                                className="mt-0.5 h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0">
                                <span className="block text-content">{option.label}</span>
                                <span className="block text-xs text-content-subtle">{option.hint}</span>
                            </span>
                        </label>
                    ))}
                </div>

                {form.target_mode === 'area' && (
                    <TargetPicker
                        label="Area"
                        options={areaOptions}
                        selected={form.area_ids}
                        onChange={(value) => set('area_ids', value)}
                        searchable={areaOptions.length > 12}
                    />
                )}
                {form.target_mode === 'camera' && (
                    <TargetPicker
                        label="Kamera"
                        options={cameraOptions}
                        selected={form.camera_ids}
                        onChange={(value) => set('camera_ids', value)}
                        searchable
                    />
                )}
            </fieldset>

            {/* --------------------------------------------------------------- CTA */}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nomor WhatsApp" hint="Boleh 08xx atau 62xx. Kosongkan kalau mau pakai URL sendiri.">
                    <input
                        type="tel"
                        value={form.whatsapp_number}
                        onChange={(event) => set('whatsapp_number', event.target.value)}
                        placeholder="081234567890"
                        className={inputClass}
                    />
                </Field>
                <Field label="Label tombol">
                    <input
                        type="text"
                        value={form.cta_label}
                        onChange={(event) => set('cta_label', event.target.value)}
                        placeholder="Tanya Pemasangan"
                        className={inputClass}
                    />
                </Field>
            </div>

            <Field label="Pesan WhatsApp otomatis" hint="Pakai {area} dan {kamera} — otomatis diganti sesuai kamera yang sedang ditonton.">
                <textarea
                    rows={2}
                    value={form.whatsapp_message}
                    onChange={(event) => set('whatsapp_message', event.target.value)}
                    className={inputClass}
                />
            </Field>

            <Field label="URL tujuan (opsional)" hint="Dipakai hanya kalau nomor WhatsApp dikosongkan.">
                <input
                    type="url"
                    value={form.cta_url}
                    onChange={(event) => set('cta_url', event.target.value)}
                    placeholder="https://…"
                    className={inputClass}
                />
            </Field>

            {/* ---------------------------------------------------------- schedule */}
            <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Mulai tayang" hint="Kosong = langsung.">
                    <input type="date" value={form.start_date} onChange={(event) => set('start_date', event.target.value)} className={inputClass} />
                </Field>
                <Field label="Berhenti tayang" hint="Kosong = tanpa batas.">
                    <input type="date" value={form.end_date} onChange={(event) => set('end_date', event.target.value)} className={inputClass} />
                </Field>
                <Field label="Prioritas" hint="Angka kecil menang saat dua promo sama-sama cocok.">
                    <input type="number" value={form.priority} onChange={(event) => set('priority', event.target.value)} className={inputClass} />
                </Field>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-content">
                <input type="checkbox" checked={form.active} onChange={(event) => set('active', event.target.checked)} className="h-4 w-4" />
                Aktif
            </label>
        </form>
    );
}
