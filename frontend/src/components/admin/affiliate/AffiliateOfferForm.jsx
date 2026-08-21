/*
 * Purpose: Editor for one affiliate BARANG (offer) — which partner sells it, the product copy,
 *          the outbound product link, which cameras it appears under, its priority, and the three
 *          OPTIONAL extras a visitor may see: a photo, a price, and a WhatsApp button.
 * Caller: pages/AffiliateManagement.jsx.
 * Deps: components/ui (Field, Button, inputClasses), affiliateAdminService (URL + WhatsApp policy
 *       mirrors, image upload/removal, media path builder, read-side normalisers),
 *       NotificationContext.
 * MainFuncs: AffiliateOfferForm.
 * SideEffects: Reads a local file into base64 and POSTs it to the offer image endpoint; clears a
 *              stored photo through an offer update. Everything else is handed to onSubmit.
 *
 * THE THREE EXTRAS: PRESENCE IS THE SWITCH, AND THE FORM HAS TO SAY SO
 * -------------------------------------------------------------------
 * Photo, price and WhatsApp number each gate themselves — filled means the visitor sees it, cleared
 * means it is gone. There is deliberately no "Tampilkan harga" checkbox beside the price and no
 * "Aktifkan WhatsApp" toggle beside the number; adding one later would be a regression, not a
 * feature, because two pieces of state describing one thing eventually disagree and then nothing in
 * the row says which was meant. That rule is invisible unless the form says it out loud, so the
 * three sit in ONE fieldset under a single sentence — learn the rule once, not three special cases.
 *
 * EMPTY PRICE IS NULL, AND NULL IS NOT ZERO
 * ----------------------------------------
 * An empty price submits `null` ("this offer does not advertise a price"). It must never submit 0,
 * which is a real price meaning "gratis" and would advertise the item as free. The two are one
 * keystroke apart and the difference is not guessable, so the field says it in its own helper line
 * too. This is the OPPOSITE default from the partner form, where an empty price legitimately means
 * Rp0 (the operator's own shop runs free) — hence two sets of digit helpers rather than one whose
 * empty case would have to mean both things at once.
 *
 * WHY THE PHOTO IS NOT PART OF THE SAVE
 * ------------------------------------
 * The image endpoint needs an offer id, and a brand-new offer has none until it is saved. Rather
 * than dead-ending the file picker until after the first save, a chosen file is held here with a
 * local object-URL preview and uploaded as soon as the offer exists — the same trick and the same
 * UX as the promo poster (PromoBannerForm.jsx). The parent therefore keeps the editor open on the
 * saved row, so this component is still mounted when that upload runs. Removing a photo is an
 * offer update with `image_base: null`, not a DELETE (presence is the switch, so "no photo" is
 * just a cleared field), and affiliateAdminService.removeOfferImage re-reads the row the server
 * returns — a write the backend ignored surfaces as an error here instead of as a green toast
 * over a photo that is still on the public card.
 *
 * TARGETING IS AN ADMIN-SIDE CONCERN ONLY
 * ---------------------------------------
 * Camera and area names are picked here, but they exist ONLY in this admin session. The public
 * payload is a hand-built thirteen-key allow-list (id, product_title, description, store_name,
 * product_url, store_url, product_href, store_href, whatsapp_url, price_rupiah, image_base,
 * image_width, image_height) with no camera field, no area field and no partner id. The house-promo
 * resolver carries a comment claiming the same thing while actually substituting {kamera}/{area}
 * into a public URL — the bug this feature must not repeat, so nothing chosen in this picker may
 * ever be echoed back to a visitor. The WhatsApp template accepts {barang} and {toko} for the same
 * reason: both are already public on the card carrying the button, and neither names a camera.
 *
 * WHY THE FORM DOES NOT COMPUTE "SEDANG TAYANG"
 * --------------------------------------------
 * Whether a partner's schedule is currently open is decided by the backend against WIB
 * (getLocalDate()). Recomputing it from the browser clock disagrees with the server for the first
 * seven hours of every WIB day — the promo page learned this the hard way — so this form only
 * reports what it can know for certain: the partner's own Aktif switch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Field, Button, inputClasses } from '../../ui';
import {
    affiliateImageSrc,
    describeOutboundUrlProblem,
    describeWhatsAppMessageProblem,
    describeWhatsAppNumberProblem,
    normalizePlacements,
    normalizeTargetIds,
    removeOfferImage,
    toWhatsAppDigits,
    uploadOfferImage,
    MAX_WHATSAPP_MESSAGE_LEN,
} from '../../../services/affiliateAdminService';
import { useNotification } from '../../../contexts/NotificationContext';

/*
 * Phase 1 wires exactly one surface: the slot under the live video. The column accepts a list
 * because the promo banner already shows four surfaces and this will follow, but offering boxes
 * that resolve to nothing would let an operator publish an offer that appears nowhere and looks
 * configured. So: one option, rendered, locked on, and explained.
 */
const PLACEMENT_OPTIONS = [
    { key: 'popup', label: 'Bawah video live', hint: 'Saat pengunjung menonton satu kamera.' },
];

const TARGET_OPTIONS = [
    { key: 'all', label: 'Semua kamera', hint: 'Tampil di mana saja.' },
    { key: 'area', label: 'Area tertentu', hint: 'Mis. DANDER & TANJUNGHARJO.' },
    { key: 'camera', label: 'Kamera tertentu', hint: 'Pilih satu per satu.' },
];

// Mirrors MAX_AFFILIATE_UPLOAD_BYTES on the backend, checked here too so an oversized file is
// refused BEFORE it is read into memory and pushed over a slow uplink. The ceiling applies to the
// SOURCE file: what comes out the other side is a pair of small WebP renditions.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const EMPTY = {
    partner_id: '',
    product_title: '',
    description: '',
    product_url: '',
    whatsapp_number: '',
    whatsapp_message: '',
    target_mode: 'all',
    placements: ['popup'],
    priority: 100,
    active: true,
    area_ids: [],
    camera_ids: [],
};

/*
 * The price is held as a DIGIT STRING so the caret does not jump while the operator types into a
 * separator-formatted box. '' is a first-class value here and means NULL on submit (see header).
 * AffiliatePartnerForm has look-alike helpers whose empty case coerces to '0' — right for a partner
 * deal, wrong here; one shared helper would need one empty case meaning both "gratis" and "no price".
 */
function digitsOf(value) {
    return String(value ?? '').replace(/\D+/g, '');
}

function groupDigits(digits) {
    if (!digits) {
        return '';
    }
    return Number.parseInt(digits, 10).toLocaleString('id-ID');
}

/** Photo columns off an offer row, or null when the offer has no photo. */
function imageFromOffer(row) {
    if (!row?.image_base) {
        return null;
    }
    const int = (value) => (Number.isInteger(value) ? value : null);
    return {
        base: row.image_base, width: int(row.image_width), height: int(row.image_height), bytes: int(row.image_bytes),
    };
}

/**
 * Searchable multi-select, same shape as the promo banner's picker. Cameras number in the
 * hundreds, so the list is filtered and capped — an unfiltered 750-row checkbox list is both
 * unusable and slow to render.
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
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-semibold text-content-muted">{label}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-content-subtle">{selected.length} dipilih</span>
            </div>

            {searchable && (
                <input
                    type="search"
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                    placeholder="Cari nama…"
                    aria-label={`Cari ${label}`}
                    className={inputClasses({ className: 'mb-2' })}
                />
            )}

            <div className="max-h-56 space-y-1 overflow-y-auto">
                {visible.length === 0 && <p className="py-2 text-xs text-content-subtle">Tidak ada yang cocok.</p>}
                {visible.map((option) => (
                    <label
                        key={option.id}
                        className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-sm text-content-muted hover:bg-surface-raised sm:min-h-0"
                    >
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

export default function AffiliateOfferForm({ offer, partners, areas, cameras, saving, onSubmit, onCancel, onUploaded }) {
    const [form, setForm] = useState(EMPTY);
    // '' is meaningful: no price shown. See the header — this must never become 0 on its own.
    const [priceDigits, setPriceDigits] = useState('');
    // What is STORED on the offer right now, kept locally so the widget reflects an upload or a
    // removal immediately instead of waiting for the parent to refetch the list.
    const [image, setImage] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [uploadInfo, setUploadInfo] = useState(null);
    // A brand-new offer has no id yet and the image endpoint needs one, so a file chosen before the
    // first save is held here with a local preview and flushed by handleSubmit.
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
     * Switching to a different offer drops any draft photo, so it can never be attached to the
     * wrong product. The save path is unaffected: handleSubmit holds the file in its own closure,
     * so clearing state here cannot cancel an upload already in flight — which matters, because the
     * parent re-points `offer` at the freshly saved row and re-runs this effect mid-upload.
     */
    useEffect(() => {
        setPendingFile(null);
        replacePendingPreview(null);
        setUploadInfo(null);

        if (!offer) {
            setForm(EMPTY);
            setPriceDigits('');
            setImage(null);
            return;
        }
        const placements = normalizePlacements(offer.placements);
        setForm({
            ...EMPTY,
            ...offer,
            partner_id: offer.partner_id ? String(offer.partner_id) : '',
            description: offer.description || '',
            product_url: offer.product_url || '',
            whatsapp_number: offer.whatsapp_number || '',
            whatsapp_message: offer.whatsapp_message || '',
            target_mode: offer.target_mode || 'all',
            placements: placements.length ? placements : ['popup'],
            priority: offer.priority ?? 100,
            active: Boolean(offer.active),
            area_ids: normalizeTargetIds(offer, 'area'),
            camera_ids: normalizeTargetIds(offer, 'camera'),
        });
        // NOT `?? 0`: a NULL price must come back as an empty box, or reopening an offer would
        // silently turn "no price" into "Rp0 · gratis" the next time it is saved.
        setPriceDigits(offer.product_price_rupiah === null || offer.product_price_rupiah === undefined
            ? ''
            : digitsOf(offer.product_price_rupiah));
        setImage(imageFromOffer(offer));
    }, [offer, replacePendingPreview]);

    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

    const urlProblem = useMemo(
        () => describeOutboundUrlProblem(form.product_url, { required: true }),
        [form.product_url]
    );
    const waNumberProblem = useMemo(
        () => describeWhatsAppNumberProblem(form.whatsapp_number),
        [form.whatsapp_number]
    );
    const waMessageProblem = useMemo(
        () => describeWhatsAppMessageProblem(form.whatsapp_message),
        [form.whatsapp_message]
    );
    // What wa.me will actually be handed — shown to the operator, because "081…" becoming "6281…"
    // is a silent rewrite otherwise, and a wrong number fails inside WhatsApp where nobody sees it.
    const waDigits = useMemo(() => toWhatsAppDigits(form.whatsapp_number), [form.whatsapp_number]);

    const areaOptions = useMemo(() => areas.map((area) => ({ id: area.id, label: area.name })), [areas]);
    const cameraOptions = useMemo(() => cameras.map((camera) => ({ id: camera.id, label: camera.name })), [cameras]);

    const selectedPartner = useMemo(
        () => partners.find((partner) => String(partner.id) === String(form.partner_id)) || null,
        [partners, form.partner_id]
    );

    // A locally-picked file wins over what is stored, so the operator sees the photo they just
    // chose rather than the one it is about to replace.
    const previewSrc = pendingPreview || (image ? affiliateImageSrc(image.base) : null);

    // Clearing the input matters: without it, re-picking the SAME file fires no change event, so
    // a rejected file cannot be retried after fixing nothing.
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
                title: 'Foto terlalu besar',
                message: `Maksimal ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB, berkas ini ${(file.size / (1024 * 1024)).toFixed(1)}MB.`,
            };
        }
        return null;
    };

    const uploadFile = async (offerId, file) => {
        setUploading(true);
        try {
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
                reader.onerror = () => reject(new Error('Gagal membaca berkas'));
                reader.readAsDataURL(file);
            });

            const result = await uploadOfferImage(offerId, base64);
            if (!result.success) {
                showNotification({ type: 'error', title: 'Gagal mengunggah', message: result.message });
                return false;
            }

            const uploaded = result.data?.image;
            // Defensive: the toast reports a size, and a missing field must not print "NaNKB".
            const storedKB = Math.round((Number(uploaded?.bytes) || 0) / 1024);
            setImage(imageFromOffer({
                image_base: uploaded?.imageBase,
                image_width: uploaded?.width,
                image_height: uploaded?.height,
                image_bytes: uploaded?.bytes,
            }));
            setUploadInfo(uploaded ? { ...uploaded, sourceName: file.name } : null);
            setPendingFile(null);
            replacePendingPreview(null);
            showNotification({
                type: 'success',
                title: 'Foto diunggah',
                message: `Dikonversi ke WebP: ${Math.round(file.size / 1024)}KB → ${storedKB}KB.`,
            });
            // The list row still says "tanpa foto" until the parent refetches.
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

        if (!offer?.id) {
            // Nothing to attach it to yet — hold it and preview locally. handleSubmit uploads it
            // as soon as the offer has an id.
            setPendingFile(file);
            replacePendingPreview(URL.createObjectURL(file));
            return;
        }

        await uploadFile(offer.id, file);
    };

    /*
     * One button, two jobs, because there are two ways an offer can "have" a photo: a draft file
     * that exists only in this browser, and a photo already stored on the row. Cancelling the draft
     * must not touch the stored one, or picking a replacement then changing your mind would delete
     * the picture that was already live.
     */
    const handleRemoveImage = async () => {
        if (pendingFile) {
            setPendingFile(null);
            replacePendingPreview(null);
            resetFileInput();
            return;
        }
        if (!offer?.id || !image) {
            return;
        }

        setRemoving(true);
        const result = await removeOfferImage(offer.id);
        setRemoving(false);

        if (!result.success) {
            showNotification({ type: 'error', title: 'Gagal menghapus foto', message: result.message });
            return;
        }
        setImage(null);
        setUploadInfo(null);
        showNotification({
            type: 'success',
            title: 'Foto dihapus',
            message: 'Kartu barang ini sekarang tampil tanpa gambar.',
        });
        onUploaded?.();
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!form.partner_id) {
            showNotification({ type: 'warning', title: 'Mitra belum dipilih', message: 'Setiap barang harus menempel pada satu mitra.' });
            return;
        }
        if (!form.product_title.trim()) {
            showNotification({ type: 'warning', title: 'Judul barang kosong', message: 'Isi nama barangnya.' });
            return;
        }
        if (urlProblem) {
            showNotification({ type: 'warning', title: 'Link barang ditolak', message: urlProblem });
            return;
        }
        // A present-but-implausible number is refused rather than stored: the resulting wa.me link
        // fails inside WhatsApp where nobody sees it. An EMPTY number is not an error — that is the
        // off switch.
        if (waNumberProblem) {
            showNotification({ type: 'warning', title: 'Nomor WhatsApp ditolak', message: waNumberProblem });
            return;
        }
        if (waMessageProblem) {
            showNotification({ type: 'warning', title: 'Pesan WhatsApp terlalu panjang', message: waMessageProblem });
            return;
        }
        /*
         * An offer targeted at "area"/"camera" with nothing ticked matches nothing and silently
         * never appears. Saying so beats letting the operator believe it is running.
         */
        if (form.target_mode === 'area' && form.area_ids.length === 0) {
            showNotification({ type: 'warning', title: 'Area belum dipilih', message: 'Pilih minimal satu area, atau ubah ke "Semua kamera".' });
            return;
        }
        if (form.target_mode === 'camera' && form.camera_ids.length === 0) {
            showNotification({ type: 'warning', title: 'Kamera belum dipilih', message: 'Pilih minimal satu kamera, atau ubah ke "Semua kamera".' });
            return;
        }

        const saved = await onSubmit({
            partner_id: Number.parseInt(form.partner_id, 10),
            product_title: form.product_title.trim(),
            description: form.description.trim() || null,
            product_url: form.product_url.trim(),
            // Presence is the switch, so each extra submits null when empty — that IS the "off"
            // position. The price especially: '' -> null ("no price"), never 0 ("gratis").
            whatsapp_number: form.whatsapp_number.trim() || null,
            whatsapp_message: form.whatsapp_message.trim() || null,
            product_price_rupiah: priceDigits === '' ? null : Number.parseInt(priceDigits, 10),
            target_mode: form.target_mode,
            placements: form.placements.length ? form.placements : ['popup'],
            priority: Number.parseInt(form.priority, 10) || 100,
            active: Boolean(form.active),
            area_ids: form.target_mode === 'area' ? form.area_ids : [],
            camera_ids: form.target_mode === 'camera' ? form.camera_ids : [],
        });

        // Now that the offer has an id, flush the photo picked while it was still a draft.
        if (saved?.id && pendingFile) {
            await uploadFile(saved.id, pendingFile);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <Field
                as="select"
                label="Mitra pemilik barang"
                required
                value={form.partner_id}
                onChange={(event) => set('partner_id', event.target.value)}
                hint="Nama toko, link toko dan masa kerjasama ikut dari mitra ini."
            >
                <option value="">— pilih mitra —</option>
                {partners.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                        {partner.store_name}{partner.active ? '' : ' (nonaktif)'}
                    </option>
                ))}
            </Field>

            {selectedPartner && !selectedPartner.active && (
                <p className="rounded-control border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-xs text-status-warn">
                    Mitra <strong>{selectedPartner.store_name}</strong> sedang nonaktif, jadi barang ini
                    <strong> tidak akan tampil</strong> sampai mitranya diaktifkan lagi.
                </p>
            )}

            <Field
                label="Judul barang"
                required
                value={form.product_title}
                onChange={(event) => set('product_title', event.target.value)}
                placeholder="Kamera Wi-Fi Indoor 3MP"
                hint="Tampil sebagai judul kartu di bawah video."
            />

            <Field
                as="textarea"
                rows={3}
                label="Deskripsi"
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
                placeholder="Garansi 1 tahun, bisa pasang sendiri, stok ready."
                hint="Satu-dua kalimat. Ini juga tampil ke pengunjung."
            />

            <Field
                label="Link barang"
                required
                type="url"
                inputMode="url"
                value={form.product_url}
                onChange={(event) => set('product_url', event.target.value)}
                placeholder="https://tokoku.example.com/produk/kamera-3mp"
                error={form.product_url ? (urlProblem || undefined) : undefined}
                hint="Wajib https. Tombolnya membuka link ini langsung di browser, dan setiap klik tetap dihitung lewat pengalih /go milik kita."
            />

            {/* ------------------------------------------------- tambahan opsional
              * Grouped on purpose: "what you fill in is what appears" is a property of the GROUP,
              * so an operator who learns it once here never has to rediscover it per field.
              */}
            <fieldset className="space-y-4 rounded-card border border-edge bg-surface-sunken p-3">
                <legend className="px-1 text-xs font-semibold text-content-muted">Tambahan opsional</legend>
                <p className="px-1 text-xs text-content-subtle">
                    Foto, harga dan tombol WhatsApp berdiri sendiri-sendiri, dan{' '}
                    <strong className="font-semibold text-content-muted">isian inilah saklarnya</strong>: yang
                    diisi akan tampil ke pengunjung, yang dikosongkan otomatis tidak ditampilkan.
                    Tidak ada centang &quot;tampilkan&quot; terpisah untuk ketiganya.
                </p>

                {/* ----------------------------------------------------- foto barang */}
                <div className="rounded-card border border-edge bg-surface p-3">
                    <span className="mb-2 block text-xs font-semibold text-content-muted">Foto barang</span>
                    {previewSrc ? (
                        <img
                            src={previewSrc}
                            alt="Pratinjau foto barang"
                            // max-w-xs is 320px: exactly the widest rendition, so the operator is
                            // previewing the picture at the size a visitor actually gets.
                            className="mb-3 h-auto w-full max-w-xs rounded-card border border-edge"
                        />
                    ) : (
                        <p className="mb-3 text-xs text-content-subtle">Belum ada foto — kartunya tampil tanpa gambar.</p>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPTED_TYPES.join(',')}
                        onChange={handleFile}
                        disabled={uploading || removing}
                        aria-label="Pilih foto barang"
                        className="block w-full text-sm text-content-muted file:mr-3 file:rounded-control file:border file:border-edge file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-content"
                    />

                    <p className="mt-2 text-xs text-content-subtle">
                        PNG/JPG/WebP, maksimal {Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB. Otomatis dikecilkan
                        jadi WebP 320px + 160px — ini gambar kartu kecil, bukan poster. Dibiarkan kosong artinya
                        kartunya memang tampil tanpa foto.
                    </p>
                    {pendingFile && (
                        <p className="mt-1 text-xs text-content-muted">
                            <strong>{pendingFile.name}</strong> akan diunggah otomatis begitu barang ini disimpan.
                        </p>
                    )}
                    {uploading && <p className="mt-2 text-xs text-content-muted">Mengunggah dan mengonversi…</p>}
                    {uploadInfo && (
                        <p className="mt-2 font-mono text-xs tabular-nums text-content-muted">
                            {uploadInfo.width}×{uploadInfo.height}
                            {(uploadInfo.renditions || []).map((r) => ` · ${r.key}px=${Math.round(r.bytes / 1024)}KB`).join('')}
                        </p>
                    )}
                    {(pendingFile || image) && (
                        <Button
                            type="button"
                            size="sm"
                            variant="dangerGhost"
                            onClick={handleRemoveImage}
                            loading={removing}
                            disabled={uploading}
                            className="mt-3"
                        >
                            {pendingFile ? 'Batalkan foto baru' : 'Hapus foto'}
                        </Button>
                    )}
                </div>

                {/* ---------------------------------------------------- harga barang */}
                <div className="rounded-card border border-edge bg-surface p-3">
                    {/* Hand-rolled instead of <Field> because of the "Rp" adornment: the box holds a
                      * GROUPED string for the human ("1.500.000") while the payload stays an integer.
                      * The label/hint wiring mirrors Field, so the control is still named + described.
                      */}
                    <label htmlFor="affiliate-offer-price" className="mb-1.5 block text-xs font-semibold text-content-muted">Harga barang</label>
                    <div className="flex items-stretch gap-2">
                        <span aria-hidden="true" className="flex min-h-11 shrink-0 items-center rounded-control border border-edge bg-surface-sunken px-3 text-sm font-medium text-content-muted">
                            Rp
                        </span>
                        <input
                            id="affiliate-offer-price"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={groupDigits(priceDigits)}
                            onChange={(event) => setPriceDigits(digitsOf(event.target.value))}
                            placeholder="kosong = tanpa harga"
                            aria-describedby="affiliate-offer-price-hint"
                            className={inputClasses({ className: 'font-mono tabular-nums' })}
                        />
                    </div>
                    <p id="affiliate-offer-price-hint" className="mt-1 text-xs text-content-subtle">
                        Angka bulat rupiah, tanpa koma. <strong className="font-semibold text-content-muted">Kosong
                        dan 0 tidak sama:</strong> kosong berarti kartunya tidak menampilkan harga sama sekali,
                        sedangkan 0 adalah harga nol dan tampil sebagai barang gratis. Isi 0 hanya kalau
                        barangnya memang digratiskan.
                    </p>
                </div>

                {/* --------------------------------------------------- tombol whatsapp */}
                <div className="space-y-3 rounded-card border border-edge bg-surface p-3">
                    <Field
                        label="Nomor WhatsApp"
                        type="tel"
                        inputMode="tel"
                        value={form.whatsapp_number}
                        onChange={(event) => set('whatsapp_number', event.target.value)}
                        placeholder="081234567890"
                        error={waNumberProblem || undefined}
                        hint="Boleh ditulis 08xx atau 62xx. Dikosongkan berarti tombol WhatsApp tidak ditampilkan di kartu."
                    />
                    {waDigits && !waNumberProblem && (
                        <p className="text-xs text-content-subtle">
                            Tombolnya akan membuka{' '}
                            <span className="font-mono text-content-muted">wa.me/{waDigits}</span>
                            {' '}— awalan 0 otomatis diganti kode negara 62.
                        </p>
                    )}
                    <Field
                        as="textarea"
                        rows={2}
                        label="Pesan otomatis"
                        value={form.whatsapp_message}
                        onChange={(event) => set('whatsapp_message', event.target.value)}
                        placeholder="Halo, saya ingin bertanya tentang {barang} di {toko}."
                        error={waMessageProblem || undefined}
                        hint={`Terisi otomatis di aplikasi WhatsApp pengunjung, masih bisa mereka ubah sebelum kirim. {barang} dan {toko} diganti sesuai barang ini. Maksimal ${MAX_WHATSAPP_MESSAGE_LEN} karakter; kosong = pakai kalimat bawaan.`}
                    />
                    {form.whatsapp_message.trim() && !waDigits && (
                        <p className="text-xs text-content-subtle">
                            Pesan ini belum terpakai: tanpa nomor WhatsApp, tombolnya tidak ditampilkan.
                        </p>
                    )}
                </div>
            </fieldset>

            {/* ----------------------------------------------------- lokasi tampil */}
            <fieldset className="rounded-card border border-edge bg-surface-sunken p-3">
                <legend className="px-1 text-xs font-semibold text-content-muted">Lokasi tampil</legend>
                <div className="space-y-2">
                    {PLACEMENT_OPTIONS.map((option) => (
                        <label key={option.key} className="flex min-h-[40px] items-start gap-2 rounded-control p-2 text-sm sm:min-h-0">
                            <input
                                type="checkbox"
                                checked={form.placements.includes(option.key)}
                                readOnly
                                disabled
                                className="mt-0.5 h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0">
                                <span className="block text-content">{option.label}</span>
                                <span className="block text-xs text-content-subtle">{option.hint}</span>
                            </span>
                        </label>
                    ))}
                </div>
                <p className="mt-1 px-2 text-xs text-content-subtle">
                    Untuk sekarang baru satu lokasi yang tersambung, jadi pilihannya dikunci. Halaman
                    area, halaman depan dan halaman rekaman menyusul — kalau ditawarkan sekarang,
                    barangnya akan terlihat &quot;terpasang&quot; padahal tidak muncul di mana pun.
                </p>
            </fieldset>

            {/* --------------------------------------------------------- targeting */}
            <fieldset className="space-y-3">
                <legend className="text-xs font-semibold text-content-muted">Tampil di kamera mana</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                    {TARGET_OPTIONS.map((option) => (
                        <label
                            key={option.key}
                            className="flex min-h-[40px] cursor-pointer items-start gap-2 rounded-card border border-edge bg-surface p-2 text-sm hover:border-edge-strong sm:min-h-0"
                        >
                            <input
                                type="radio"
                                name="affiliate_target_mode"
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

            <Field
                label="Prioritas"
                type="number"
                value={form.priority}
                onChange={(event) => set('priority', event.target.value)}
                hint="Angka kecil menang saat dua barang sama-sama cocok. Target kamera selalu mengalahkan target area, dan area mengalahkan 'semua'."
                className="sm:max-w-xs"
            />

            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-content sm:min-h-0">
                <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => set('active', event.target.checked)}
                    className="h-4 w-4 shrink-0"
                />
                <span className="min-w-0">Aktif</span>
            </label>

            <div className="flex flex-wrap gap-2 border-t border-edge pt-4">
                <Button type="submit" variant="primary" loading={saving}>
                    {saving ? 'Menyimpan…' : 'Simpan barang'}
                </Button>
                <Button type="button" onClick={onCancel}>Batal</Button>
            </div>
        </form>
    );
}
