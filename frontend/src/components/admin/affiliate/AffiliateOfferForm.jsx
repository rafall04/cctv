/*
 * Purpose: Editor for one affiliate BARANG (offer) — which partner sells it, the product copy,
 *          the outbound product link, which cameras it appears under, and its priority.
 * Caller: pages/AffiliateManagement.jsx.
 * Deps: components/ui (Field, Button, inputClasses), affiliateAdminService (URL policy mirror +
 *       read-side normalisers), NotificationContext.
 * MainFuncs: AffiliateOfferForm.
 * SideEffects: None of its own — it hands a plain payload to the caller's onSubmit.
 *
 * TARGETING IS AN ADMIN-SIDE CONCERN ONLY
 * ---------------------------------------
 * Camera and area names are picked here, but they exist ONLY in this admin session. The public
 * payload for an offer is a hand-built six-key allow-list (id, product_title, description,
 * store_name, product_href, store_href) with no camera field, no area field and no partner id.
 * The house-promo resolver carries a comment claiming the same thing while actually substituting
 * {kamera}/{area} into a public URL — that is the bug this feature must not repeat, so nothing
 * chosen in this picker may ever be echoed back to a visitor.
 *
 * WHY THE FORM DOES NOT COMPUTE "SEDANG TAYANG"
 * --------------------------------------------
 * Whether a partner's schedule is currently open is decided by the backend against WIB
 * (getLocalDate()). Recomputing it from the browser clock disagrees with the server for the first
 * seven hours of every WIB day — the promo page learned this the hard way — so this form only
 * reports what it can know for certain: the partner's own Aktif switch.
 */

import { useEffect, useMemo, useState } from 'react';
import { Field, Button, inputClasses } from '../../ui';
import { describeOutboundUrlProblem, normalizePlacements, normalizeTargetIds } from '../../../services/affiliateAdminService';
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

const EMPTY = {
    partner_id: '',
    product_title: '',
    description: '',
    product_url: '',
    target_mode: 'all',
    placements: ['popup'],
    priority: 100,
    active: true,
    area_ids: [],
    camera_ids: [],
};

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

export default function AffiliateOfferForm({ offer, partners, areas, cameras, saving, onSubmit, onCancel }) {
    const [form, setForm] = useState(EMPTY);
    const { showNotification } = useNotification();

    useEffect(() => {
        if (!offer) {
            setForm(EMPTY);
            return;
        }
        const placements = normalizePlacements(offer.placements);
        setForm({
            ...EMPTY,
            ...offer,
            partner_id: offer.partner_id ? String(offer.partner_id) : '',
            description: offer.description || '',
            product_url: offer.product_url || '',
            target_mode: offer.target_mode || 'all',
            placements: placements.length ? placements : ['popup'],
            priority: offer.priority ?? 100,
            active: Boolean(offer.active),
            area_ids: normalizeTargetIds(offer, 'area'),
            camera_ids: normalizeTargetIds(offer, 'camera'),
        });
    }, [offer]);

    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

    const urlProblem = useMemo(
        () => describeOutboundUrlProblem(form.product_url, { required: true }),
        [form.product_url]
    );

    const areaOptions = useMemo(() => areas.map((area) => ({ id: area.id, label: area.name })), [areas]);
    const cameraOptions = useMemo(() => cameras.map((camera) => ({ id: camera.id, label: camera.name })), [cameras]);

    const selectedPartner = useMemo(
        () => partners.find((partner) => String(partner.id) === String(form.partner_id)) || null,
        [partners, form.partner_id]
    );

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

        await onSubmit({
            partner_id: Number.parseInt(form.partner_id, 10),
            product_title: form.product_title.trim(),
            description: form.description.trim() || null,
            product_url: form.product_url.trim(),
            target_mode: form.target_mode,
            placements: form.placements.length ? form.placements : ['popup'],
            priority: Number.parseInt(form.priority, 10) || 100,
            active: Boolean(form.active),
            area_ids: form.target_mode === 'area' ? form.area_ids : [],
            camera_ids: form.target_mode === 'camera' ? form.camera_ids : [],
        });
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
                hint="Wajib https. Pengunjung tidak pernah melihat link ini langsung — tombolnya lewat pengalih /go milik kita, jadi mitra yang dimatikan langsung berhenti bekerja."
            />

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
