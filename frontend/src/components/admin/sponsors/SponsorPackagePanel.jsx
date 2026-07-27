/*
Purpose: Admin CRUD for the sponsor package catalog — key, label, color, default price, default camera limit, features.
Caller: pages/SponsorManagement.
Deps: React hooks, NotificationContext, sponsorPackageService.
MainFuncs: SponsorPackagePanel.
SideEffects: Triggers /api/sponsor-packages mutations on save/delete.

The panel is intentionally minimal — it sits at the top of the sponsor
admin so admins can spin up custom profiles ("Paket Pasar Rp 200rb / 2
kamera", "Lokasi Sukamaju Rp 100rb / 1 kamera") before they actually
need them in the sponsor form. Sponsors elsewhere read the package
catalog through useSponsorPackages so the dropdown stays in sync after
saves here.
*/

import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useNotification } from '../../../contexts/NotificationContext';
import sponsorPackageService from '../../../services/sponsorPackageService';
import { Button, Modal, inputClasses } from '../../ui';

const DEFAULT_FORM = {
    key: '',
    name: '',
    color: 'gray',
    default_price: 500_000,
    default_camera_limit: '',
    features: '',
    sort_order: 100,
};

const COLOR_OPTIONS = [
    { value: 'yellow', label: 'Yellow (Gold)' },
    { value: 'gray', label: 'Gray (Silver)' },
    { value: 'orange', label: 'Orange (Bronze)' },
    { value: 'sky', label: 'Sky' },
    { value: 'emerald', label: 'Emerald' },
    { value: 'rose', label: 'Rose' },
    { value: 'purple', label: 'Purple' },
];

function badgeClass(color) {
    switch (color) {
        case 'yellow': return 'bg-yellow-500/20 text-yellow-400';
        case 'gray': return 'bg-gray-400/20 text-content-muted';
        case 'orange': return 'bg-orange-500/20 text-orange-400';
        case 'sky': return 'bg-primary/20 text-primary';
        case 'emerald': return 'bg-emerald-500/20 text-emerald-400';
        case 'rose': return 'bg-rose-500/20 text-rose-400';
        case 'purple': return 'bg-purple-500/20 text-purple-400';
        default: return 'bg-gray-100 dark:bg-gray-700/40 text-content-muted';
    }
}

function featuresToTextarea(features) {
    return Array.isArray(features) ? features.join('\n') : '';
}

function textareaToFeatures(text) {
    return String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

export default function SponsorPackagePanel({ packages = [], onChanged }) {
    const { success: notifySuccess, error: notifyError } = useNotification();
    const confirm = useConfirm();
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(DEFAULT_FORM);
    const [saving, setSaving] = useState(false);

    const resetForm = useCallback(() => {
        setEditingId(null);
        setForm(DEFAULT_FORM);
    }, []);

    const openCreate = () => {
        resetForm();
        setShowModal(true);
    };

    const openEdit = (pkg) => {
        setEditingId(pkg.id);
        setForm({
            key: pkg.key,
            name: pkg.name || '',
            color: pkg.color || 'gray',
            default_price: pkg.default_price ?? 0,
            default_camera_limit: pkg.default_camera_limit ?? '',
            features: featuresToTextarea(pkg.features),
            sort_order: pkg.sort_order ?? 100,
        });
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        const payload = {
            name: form.name.trim(),
            color: form.color || 'gray',
            default_price: Number(form.default_price) || 0,
            default_camera_limit: form.default_camera_limit === ''
                ? null
                : Math.max(0, Math.floor(Number(form.default_camera_limit))),
            features: textareaToFeatures(form.features),
            sort_order: Number(form.sort_order) || 100,
        };

        // `key` is only sent on create — backend rejects key updates so the
        // public denormalized sponsor_package column on cameras stays valid.
        if (!editingId) {
            payload.key = form.key.trim().toLowerCase();
        }

        const result = editingId
            ? await sponsorPackageService.updatePackage(editingId, payload)
            : await sponsorPackageService.createPackage(payload);

        setSaving(false);

        if (!result.success) {
            notifyError(
                editingId ? 'Gagal memperbarui profil paket' : 'Gagal menambah profil paket',
                result.message || 'Permintaan ditolak server.'
            );
            return;
        }

        notifySuccess(
            editingId ? 'Profil paket diperbarui' : 'Profil paket dibuat',
            'Daftar paket sponsor disegarkan.',
        );
        setShowModal(false);
        resetForm();
        onChanged?.();
    };

    const handleDelete = async (pkg) => {
        if (!(await confirm({ title: `Hapus profil paket "${pkg.name}"?`, confirmLabel: 'Hapus', tone: 'danger' }))) return;
        const result = await sponsorPackageService.deletePackage(pkg.id);
        if (!result.success) {
            notifyError('Gagal menghapus profil paket', result.message || 'Permintaan ditolak server.');
            return;
        }
        notifySuccess('Profil paket dihapus', `${pkg.name} dihapus dari katalog.`);
        onChanged?.();
    };

    useEffect(() => {
        if (!showModal) resetForm();
    }, [showModal, resetForm]);

    return (
        <div className="bg-surface backdrop-blur-md rounded-xl border border-edge overflow-hidden">
            <div className="p-4 border-b border-edge flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-content">Profil Paket</h2>
                    <p className="text-xs text-content-muted mt-1">
                        Katalog paket sponsor (label, warna, harga default, batas kamera, fitur). Sponsor di list bawah pakai key dari katalog ini.
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    className="bg-primary-600 hover:bg-primary-700 text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
                >
                    + Tambah Profil
                </button>
            </div>

            {packages.length === 0 ? (
                <div className="p-6 text-center text-content-muted text-sm">Belum ada profil paket.</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                    {packages.map((pkg) => (
                        <div key={pkg.id} className="bg-surface-sunken border border-edge rounded-lg p-4 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-base font-semibold text-content">{pkg.name}</h3>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${badgeClass(pkg.color)}`}>
                                            {pkg.key}
                                        </span>
                                    </div>
                                    <p className="text-xs text-content-muted mt-0.5">
                                        Urutan: {pkg.sort_order} &middot; {pkg.sponsor_count || 0} sponsor pakai
                                    </p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <button onClick={() => openEdit(pkg)} className="text-primary-400 hover:text-primary-300 text-xs">
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDelete(pkg)}
                                        disabled={(pkg.sponsor_count || 0) > 0}
                                        className="text-red-400 hover:text-red-300 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                                        title={(pkg.sponsor_count || 0) > 0 ? 'Masih dipakai sponsor — pindahkan dulu' : ''}
                                    >
                                        Hapus
                                    </button>
                                </div>
                            </div>
                            <div className="text-sm text-content-muted">
                                Harga default: <span className="text-content">Rp {(pkg.default_price || 0).toLocaleString('id-ID')}</span>
                            </div>
                            <div className="text-sm text-content-muted">
                                Limit kamera:{' '}
                                <span className="text-content">
                                    {pkg.default_camera_limit === null || pkg.default_camera_limit === undefined
                                        ? 'Tanpa batas'
                                        : `${pkg.default_camera_limit} kamera`}
                                </span>
                            </div>
                            {pkg.features?.length > 0 && (
                                <ul className="text-xs text-content-muted space-y-1">
                                    {pkg.features.map((feature, i) => (
                                        <li key={i} className="flex gap-2"><span className="text-green-400">✓</span>{feature}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {showModal && (
                <Modal
                    title={editingId ? 'Edit Profil Paket' : 'Tambah Profil Paket'}
                    size="lg"
                    onClose={() => setShowModal(false)}
                    footer={(
                        <>
                            <Button onClick={() => setShowModal(false)} disabled={saving}>Batal</Button>
                            <Button type="submit" form="sponsor-package-form" variant="primary" loading={saving}>
                                {editingId ? 'Perbarui' : 'Simpan'}
                            </Button>
                        </>
                    )}
                >
                    <form id="sponsor-package-form" onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="mb-1.5 block text-xs font-semibold text-content-muted">
                                    Key (kode unik, lowercase) *
                                </label>
                                <input
                                    type="text"
                                    value={form.key}
                                    onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })}
                                    disabled={!!editingId}
                                    className={inputClasses()}
                                    placeholder="paket-sukamaju"
                                    pattern="^[a-z0-9_-]{1,40}$"
                                    required
                                />
                                {editingId && (
                                    <p className="mt-1 text-xs text-content-subtle">Key tidak bisa diubah karena melekat di sponsor & kolom kamera.</p>
                                )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1.5 block text-xs font-semibold text-content-muted">Nama Tampilan *</label>
                                    <input
                                        type="text"
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        className={inputClasses()}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-semibold text-content-muted">Warna Badge</label>
                                    <select
                                        value={form.color}
                                        onChange={(e) => setForm({ ...form, color: e.target.value })}
                                        className={inputClasses()}
                                    >
                                        {COLOR_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="mb-1.5 block text-xs font-semibold text-content-muted">Harga Default (Rp)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.default_price}
                                        onChange={(e) => setForm({ ...form, default_price: e.target.value })}
                                        className={inputClasses()}
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-semibold text-content-muted">
                                        Limit Kamera
                                        <span className="text-xs text-content-muted ml-1">(kosong = tanpa batas)</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.default_camera_limit}
                                        onChange={(e) => setForm({ ...form, default_camera_limit: e.target.value })}
                                        className={inputClasses()}
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-semibold text-content-muted">Urutan</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.sort_order}
                                        onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                                        className={inputClasses()}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-semibold text-content-muted">
                                    Fitur (1 baris per fitur)
                                </label>
                                <textarea
                                    value={form.features}
                                    onChange={(e) => setForm({ ...form, features: e.target.value })}
                                    rows={4}
                                    className={inputClasses()}
                                    placeholder={'Logo di kamera tertentu\nLink ke website\n...'}
                                />
                            </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
