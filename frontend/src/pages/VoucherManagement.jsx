/*
 * Purpose: Admin management for the voucher area-access feature — global on/off flag, per-area
 *          "berbayar" toggles, voucher-profile CRUD, and code generation/listing/revocation.
 * Caller: Protected admin route /admin/voucher (adminOnly).
 * Deps: React hooks, NotificationContext, ConfirmContext, voucherAdminService, areaService, Skeleton.
 * MainFuncs: VoucherManagement.
 * SideEffects: Calls /api/admin/voucher/* + /api/areas.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import voucherAdminService from '../services/voucherAdminService';
import { areaService } from '../services/areaService';
import { TableSkeleton } from '../components/ui/Skeleton';
import { Button, Field, Modal } from '../components/ui';

const inputClass =
    'w-full bg-surface border border-edge-strong rounded-lg px-3 py-2 text-content text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary';

const PROFILE_FORM_DEFAULT = {
    name: '',
    description: '',
    duration_value: 1,
    duration_unit: 'hari',
    max_uses_per_code: 1,
    price: 0,
    code_validity_days: '',
    online_purchasable: true,
    active: true,
    area_ids: [],
};

function minutesToParts(minutes) {
    const m = Number(minutes) || 0;
    if (m > 0 && m % 1440 === 0) return { value: m / 1440, unit: 'hari' };
    if (m > 0 && m % 60 === 0) return { value: m / 60, unit: 'jam' };
    return { value: m, unit: 'menit' };
}

function formatDuration(minutes) {
    const { value, unit } = minutesToParts(minutes);
    return `${value} ${unit}`;
}

// Voucher-code state is a lifecycle, not a health reading: `revoked` is the only one that means
// something went wrong, so it is the only one allowed the fault token.
function codeStatusBadge(status) {
    switch (status) {
        case 'active': return 'bg-status-live/10 text-status-live';
        case 'expired': return 'bg-status-warn/10 text-status-warn';
        case 'revoked': return 'bg-status-fault/10 text-status-fault';
        case 'unused':
        default: return 'bg-surface-sunken text-content-muted';
    }
}

function normalizeAreas(response) {
    const data = response?.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.areas)) return data.areas;
    return [];
}

function areaLabel(area) {
    const parts = [area.name];
    if (area.rw) parts.push(`RW ${area.rw}`);
    if (area.kelurahan) parts.push(area.kelurahan);
    return parts.filter(Boolean).join(' · ');
}

export default function VoucherManagement() {
    const { success: notifySuccess, error: notifyError } = useNotification();
    const confirm = useConfirm();

    const [loading, setLoading] = useState(true);
    const [enabled, setEnabled] = useState(false);
    const [gatedAreaIds, setGatedAreaIds] = useState([]);
    const [areas, setAreas] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [codes, setCodes] = useState([]);
    const [savingFlag, setSavingFlag] = useState(false);
    const [areaBusyId, setAreaBusyId] = useState(null);

    // Profile modal
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(PROFILE_FORM_DEFAULT);
    const [savingProfile, setSavingProfile] = useState(false);

    // Generate-codes modal
    const [genProfile, setGenProfile] = useState(null);
    const [genCount, setGenCount] = useState(5);
    const [genBuyerName, setGenBuyerName] = useState('');
    const [genBuyerPhone, setGenBuyerPhone] = useState('');
    const [genResult, setGenResult] = useState(null); // array of issued codes
    const [generating, setGenerating] = useState(false);

    // Code list filters
    const [codeProfileFilter, setCodeProfileFilter] = useState('');
    const [codeStatusFilter, setCodeStatusFilter] = useState('');

    const gatedSet = useMemo(() => new Set(gatedAreaIds), [gatedAreaIds]);
    const profilesById = useMemo(() => {
        const map = {};
        for (const p of profiles) map[p.id] = p;
        return map;
    }, [profiles]);

    const loadData = useCallback(async () => {
        setLoading(true);
        const [settingsRes, areasRes, profilesRes, codesRes] = await Promise.all([
            voucherAdminService.getSettings(),
            areaService.getAllAreas(),
            voucherAdminService.getProfiles(),
            voucherAdminService.getCodes({ limit: 300 }),
        ]);

        if (settingsRes?.success) {
            setEnabled(!!settingsRes.data.enabled);
            setGatedAreaIds(settingsRes.data.gated_area_ids || []);
        } else {
            notifyError('Gagal memuat pengaturan voucher', settingsRes?.message);
        }
        if (areasRes?.success) setAreas(normalizeAreas(areasRes));
        if (profilesRes?.success) setProfiles(Array.isArray(profilesRes.data) ? profilesRes.data : []);
        if (codesRes?.success) setCodes(Array.isArray(codesRes.data) ? codesRes.data : []);

        setLoading(false);
    }, [notifyError]);

    useEffect(() => { loadData(); }, [loadData]);

    const reloadCodes = useCallback(async () => {
        const res = await voucherAdminService.getCodes({ limit: 300 });
        if (res?.success) setCodes(Array.isArray(res.data) ? res.data : []);
    }, []);

    // --- Feature flag -----------------------------------------------------
    const toggleFlag = async () => {
        const next = !enabled;
        if (next && !(await confirm({
            title: 'Aktifkan pembatasan akses voucher?',
            body: 'Kamera di area yang ditandai "berbayar" akan terkunci untuk pengunjung tanpa voucher aktif. Pastikan ada area yang ditandai + profil voucher dulu.',
            confirmLabel: 'Aktifkan',
        }))) return;
        setSavingFlag(true);
        const res = await voucherAdminService.updateSettings(next);
        setSavingFlag(false);
        if (!res?.success) { notifyError('Gagal mengubah status fitur', res?.message); return; }
        setEnabled(!!res.data.enabled);
        setGatedAreaIds(res.data.gated_area_ids || []);
        notifySuccess(res.data.enabled ? 'Fitur voucher AKTIF' : 'Fitur voucher non-aktif');
    };

    // --- Area gating ------------------------------------------------------
    const toggleAreaGated = async (area) => {
        const gated = !gatedSet.has(area.id);
        setAreaBusyId(area.id);
        const res = await voucherAdminService.setAreaGated(area.id, gated);
        setAreaBusyId(null);
        if (!res?.success) { notifyError('Gagal mengubah status area', res?.message); return; }
        setGatedAreaIds((cur) => (gated ? [...new Set([...cur, area.id])] : cur.filter((id) => id !== area.id)));
        notifySuccess(gated ? `${area.name} ditandai berbayar` : `${area.name} kembali gratis`);
    };

    // --- Profiles ---------------------------------------------------------
    const openCreateProfile = () => {
        setEditingId(null);
        setForm(PROFILE_FORM_DEFAULT);
        setShowProfileModal(true);
    };

    const openEditProfile = (p) => {
        const { value, unit } = minutesToParts(p.duration_minutes);
        setEditingId(p.id);
        setForm({
            name: p.name || '',
            description: p.description || '',
            duration_value: value,
            duration_unit: unit,
            max_uses_per_code: p.max_uses_per_code ?? 1,
            price: p.price ?? 0,
            code_validity_days: p.code_validity_days ?? '',
            online_purchasable: p.online_purchasable === 1 || p.online_purchasable === true,
            active: p.active === 1 || p.active === true,
            area_ids: Array.isArray(p.area_ids) ? [...p.area_ids] : [],
        });
        setShowProfileModal(true);
    };

    const toggleFormArea = (areaId) => {
        setForm((cur) => {
            const has = cur.area_ids.includes(areaId);
            return { ...cur, area_ids: has ? cur.area_ids.filter((id) => id !== areaId) : [...cur.area_ids, areaId] };
        });
    };

    const submitProfile = async (e) => {
        e.preventDefault();
        setSavingProfile(true);
        const payload = {
            name: form.name.trim(),
            description: form.description?.trim() || null,
            duration_value: Number(form.duration_value),
            duration_unit: form.duration_unit,
            max_uses_per_code: Number(form.max_uses_per_code),
            price: Math.max(0, Math.floor(Number(form.price) || 0)),
            code_validity_days: form.code_validity_days === '' || form.code_validity_days === null
                ? null
                : Number(form.code_validity_days),
            online_purchasable: !!form.online_purchasable,
            active: !!form.active,
            area_ids: form.area_ids,
        };
        const res = editingId
            ? await voucherAdminService.updateProfile(editingId, payload)
            : await voucherAdminService.createProfile(payload);
        setSavingProfile(false);
        if (!res?.success) {
            notifyError(editingId ? 'Gagal memperbarui profil' : 'Gagal membuat profil', res?.message || 'Permintaan ditolak server.');
            return;
        }
        notifySuccess(editingId ? 'Profil diperbarui' : 'Profil dibuat');
        setShowProfileModal(false);
        loadData();
    };

    const deleteProfile = async (p) => {
        if (!(await confirm({ title: `Hapus profil "${p.name}"?`, confirmLabel: 'Hapus', tone: 'danger' }))) return;
        const res = await voucherAdminService.deleteProfile(p.id);
        if (!res?.success) { notifyError('Gagal menghapus profil', res?.message); return; }
        notifySuccess('Profil dihapus');
        loadData();
    };

    // --- Codes ------------------------------------------------------------
    const openGenerate = (p) => {
        setGenProfile(p);
        setGenCount(5);
        setGenBuyerName('');
        setGenBuyerPhone('');
        setGenResult(null);
    };

    const submitGenerate = async (e) => {
        e.preventDefault();
        setGenerating(true);
        const res = await voucherAdminService.generateCodes(genProfile.id, {
            count: Number(genCount),
            source: 'admin',
            buyer_name: genBuyerName.trim() || undefined,
            buyer_phone: genBuyerPhone.trim() || undefined,
        });
        setGenerating(false);
        if (!res?.success) { notifyError('Gagal membuat kode', res?.message); return; }
        setGenResult(res.data || []);
        notifySuccess(`${res.data?.length || 0} kode dibuat`);
        reloadCodes();
    };

    const copyCodes = async (list) => {
        const text = list.map((c) => c.code).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            notifySuccess('Kode disalin ke clipboard');
        } catch {
            notifyError('Tidak bisa menyalin', 'Salin manual dari daftar.');
        }
    };

    const revokeCode = async (code) => {
        if (!(await confirm({ title: `Cabut kode ${code.code}?`, body: 'Akses yang sedang berjalan dengan kode ini akan dihentikan.', confirmLabel: 'Cabut', tone: 'danger' }))) return;
        const res = await voucherAdminService.revokeCode(code.id);
        if (!res?.success) { notifyError('Gagal mencabut kode', res?.message); return; }
        notifySuccess('Kode dicabut');
        reloadCodes();
    };

    const filteredCodes = useMemo(() => {
        return codes.filter((c) =>
            (!codeProfileFilter || String(c.profile_id) === String(codeProfileFilter))
            && (!codeStatusFilter || c.status === codeStatusFilter));
    }, [codes, codeProfileFilter, codeStatusFilter]);

    if (loading) {
        return <div className="space-y-5"><TableSkeleton rows={6} columns={5} /></div>;
    }

    return (
        <div className="space-y-5">
            {/* Header + global flag */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-content">Voucher Akses CCTV</h1>
                    <p className="text-content-muted text-sm mt-1">
                        Batasi akses live kamera per-area dengan kode voucher berdurasi. Tandai area
                        “berbayar”, buat profil, lalu bagikan kodenya.
                    </p>
                </div>
                <button
                    onClick={toggleFlag}
                    disabled={savingFlag}
                    className={`px-4 py-2.5 rounded-lg font-semibold text-white transition-colors disabled:opacity-60 ${
                        enabled ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-500 hover:bg-gray-600'
                    }`}
                >
                    {enabled ? '● Fitur AKTIF — klik untuk matikan' : '○ Fitur non-aktif — klik untuk aktifkan'}
                </button>
            </div>

            {!enabled && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                    Fitur masih <b>non-aktif</b> — kamera tetap publik untuk semua orang. Tandai area
                    + buat profil dulu, lalu aktifkan fitur saat siap.
                </div>
            )}

            {/* Area gating */}
            <div className="bg-surface rounded-xl border border-edge overflow-hidden">
                <div className="p-4 border-b border-edge">
                    <h2 className="text-lg font-semibold text-content">Area Berbayar</h2>
                    <p className="text-xs text-content-muted mt-1">
                        Hanya area yang ditandai yang terkunci (saat fitur aktif). Pengunjung tanpa
                        voucher melihat kamera area ini sebagai terkunci.
                    </p>
                </div>
                {areas.length === 0 ? (
                    <div className="p-6 text-center text-sm text-content-muted">Belum ada area. Buat area dulu di menu Areas.</div>
                ) : (
                    <ul className="divide-y divide-edge max-h-72 overflow-y-auto">
                        {areas.map((area) => {
                            const gated = gatedSet.has(area.id);
                            return (
                                <li key={area.id} className="flex items-center justify-between px-4 py-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-content truncate">{areaLabel(area)}</p>
                                    </div>
                                    <button
                                        onClick={() => toggleAreaGated(area)}
                                        disabled={areaBusyId === area.id}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                                            gated ? 'bg-primary-600 text-white hover:bg-primary-700'
                                                  : 'bg-surface-sunken text-content-muted hover:bg-surface-sunken'
                                        }`}
                                    >
                                        {gated ? '🔒 Berbayar' : 'Gratis'}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Profiles */}
            <div className="bg-surface rounded-xl border border-edge overflow-hidden">
                <div className="p-4 border-b border-edge flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-content">Profil Voucher</h2>
                    <button onClick={openCreateProfile} className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm transition-colors">
                        + Tambah Profil
                    </button>
                </div>
                {profiles.length === 0 ? (
                    <div className="p-6 text-center text-sm text-content-muted">Belum ada profil. Tambah profil pertama (mis. “RW Dander — 1 hari”).</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-100 dark:bg-gray-900/50">
                                <tr>
                                    {['Nama', 'Durasi', 'Harga', 'Maks/Kode', 'Area', 'Status', 'Aksi'].map((h) => (
                                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-edge">
                                {profiles.map((p) => (
                                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                        <td className="px-4 py-3">
                                            <p className="text-sm font-medium text-content">{p.name}</p>
                                            {p.description && <p className="text-xs text-content-muted">{p.description}</p>}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-content-muted">{formatDuration(p.duration_minutes)}</td>
                                        <td className="px-4 py-3 text-sm text-content">
                                            {p.price > 0 ? `Rp ${Number(p.price).toLocaleString('id-ID')}` : 'Gratis'}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-content-muted">{p.max_uses_per_code}</td>
                                        <td className="px-4 py-3 text-xs text-content-muted">
                                            {(p.area_ids || []).map((id) => areas.find((a) => a.id === id)?.name || `#${id}`).join(', ') || '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.active ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                                                    {p.active ? 'Aktif' : 'Nonaktif'}
                                                </span>
                                                {p.online_purchasable
                                                    ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-sky-500/15 text-sky-500">Online</span>
                                                    : <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700/50 text-content-muted">Khusus admin</span>}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => openGenerate(p)} className="text-emerald-500 hover:text-emerald-400 text-sm">Generate</button>
                                                <button onClick={() => openEditProfile(p)} className="text-primary-500 hover:text-primary-400 text-sm">Edit</button>
                                                <button onClick={() => deleteProfile(p)} className="text-red-500 hover:text-red-400 text-sm">Hapus</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Codes */}
            <div className="bg-surface rounded-xl border border-edge overflow-hidden">
                <div className="p-4 border-b border-edge flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <h2 className="text-lg font-semibold text-content">Kode Voucher</h2>
                    <div className="flex gap-2">
                        <select value={codeProfileFilter} onChange={(e) => setCodeProfileFilter(e.target.value)} className={`${inputClass} md:w-44`}>
                            <option value="">Semua profil</option>
                            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <select value={codeStatusFilter} onChange={(e) => setCodeStatusFilter(e.target.value)} className={`${inputClass} md:w-36`}>
                            <option value="">Semua status</option>
                            {['unused', 'active', 'expired', 'revoked'].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>
                {filteredCodes.length === 0 ? (
                    <div className="p-6 text-center text-sm text-content-muted">Belum ada kode. Generate dari profil di atas.</div>
                ) : (
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full">
                            <thead className="bg-gray-100 dark:bg-gray-900/50 sticky top-0">
                                <tr>
                                    {['Kode', 'Profil', 'Status', 'Pemakai', 'Berakhir', 'Pembeli', 'Aksi'].map((h) => (
                                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-edge">
                                {filteredCodes.map((c) => (
                                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                        <td className="px-4 py-3 font-mono text-sm text-content">{c.code}</td>
                                        <td className="px-4 py-3 text-xs text-content-muted">{profilesById[c.profile_id]?.name || `#${c.profile_id}`}</td>
                                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${codeStatusBadge(c.status)}`}>{c.status}</span></td>
                                        <td className="px-4 py-3 text-xs text-content-muted">{c.redeemed_count ?? 0}</td>
                                        <td className="px-4 py-3 text-xs text-content-muted">{c.expires_at ? new Date(c.expires_at).toLocaleString('id-ID') : '—'}</td>
                                        <td className="px-4 py-3 text-xs text-content-muted">{c.buyer_name || c.buyer_phone || '—'}</td>
                                        <td className="px-4 py-3">
                                            {c.status !== 'revoked' && c.status !== 'expired' && (
                                                <button onClick={() => revokeCode(c)} className="text-red-500 hover:text-red-400 text-sm">Cabut</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Profile modal */}
            {showProfileModal && (
                <Modal
                    title={editingId ? 'Edit Profil Voucher' : 'Profil Voucher Baru'}
                    size="lg"
                    onClose={() => setShowProfileModal(false)}
                    footer={(
                        <>
                            <Button onClick={() => setShowProfileModal(false)} disabled={savingProfile}>Batal</Button>
                            <Button type="submit" form="voucher-profile-form" variant="primary" loading={savingProfile}>
                                {editingId ? 'Perbarui' : 'Simpan'}
                            </Button>
                        </>
                    )}
                >
                    <form id="voucher-profile-form" onSubmit={submitProfile} className="space-y-4">
                        <Field
                            label="Nama Profil"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="RW Dander — 1 Hari"
                            required
                            minLength={2}
                        />
                        <Field
                            label="Deskripsi"
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                        />
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            <Field
                                label="Durasi"
                                type="number"
                                min="1"
                                value={form.duration_value}
                                onChange={(e) => setForm({ ...form, duration_value: e.target.value })}
                                required
                            />
                            <Field
                                as="select"
                                label="Satuan"
                                value={form.duration_unit}
                                onChange={(e) => setForm({ ...form, duration_unit: e.target.value })}
                            >
                                <option value="menit">Menit</option>
                                <option value="jam">Jam</option>
                                <option value="hari">Hari</option>
                            </Field>
                            <Field
                                label="Maks pemakai/kode"
                                type="number"
                                min="1"
                                value={form.max_uses_per_code}
                                onChange={(e) => setForm({ ...form, max_uses_per_code: e.target.value })}
                            />
                            <Field
                                label="Harga (Rp)"
                                type="number"
                                min="0"
                                value={form.price}
                                onChange={(e) => setForm({ ...form, price: e.target.value })}
                            />
                            <Field
                                className="col-span-2 md:col-span-1"
                                label="Masa berlaku kode"
                                hint="Hari; kosongkan untuk tanpa batas"
                                type="number"
                                min="1"
                                value={form.code_validity_days}
                                onChange={(e) => setForm({ ...form, code_validity_days: e.target.value })}
                            />
                        </div>
                        <div className="flex flex-wrap gap-4">
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-content-muted">
                                <input type="checkbox" checked={form.online_purchasable} onChange={(e) => setForm({ ...form, online_purchasable: e.target.checked })} className="h-4 w-4 rounded accent-primary" />
                                Dijual online (mandiri)
                            </label>
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-content-muted">
                                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 rounded accent-primary" />
                                Aktif
                            </label>
                        </div>
                        <fieldset>
                            <legend className="mb-1.5 text-xs font-semibold text-content-muted">Area yang dibuka *</legend>
                            <div className="max-h-40 divide-y divide-edge overflow-y-auto rounded-control border border-edge">
                                {areas.length === 0 ? (
                                    <p className="p-3 text-xs text-content-subtle">Belum ada area.</p>
                                ) : areas.map((area) => (
                                    <label key={area.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-raised">
                                        <input type="checkbox" checked={form.area_ids.includes(area.id)} onChange={() => toggleFormArea(area.id)} className="h-4 w-4 rounded accent-primary" />
                                        <span className="text-sm text-content">{areaLabel(area)}</span>
                                        {!gatedSet.has(area.id) && <span className="text-xs text-status-warn">(belum ditandai berbayar)</span>}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    </form>
                </Modal>
            )}

            {/* Generate-codes modal */}
            {genProfile && (
                <Modal
                    title={`Generate Kode — ${genProfile.name}`}
                    size="md"
                    onClose={() => setGenProfile(null)}
                    footer={!genResult ? (
                        <>
                            <Button onClick={() => setGenProfile(null)} disabled={generating}>Batal</Button>
                            <Button type="submit" form="voucher-generate-form" variant="primary" loading={generating}>Buat Kode</Button>
                        </>
                    ) : (
                        <>
                            <Button onClick={() => setGenProfile(null)}>Tutup</Button>
                            <Button variant="primary" onClick={() => copyCodes(genResult)}>Salin semua</Button>
                        </>
                    )}
                >
                    {!genResult ? (
                        <form id="voucher-generate-form" onSubmit={submitGenerate} className="space-y-4">
                            <Field
                                label="Jumlah kode"
                                type="number"
                                min="1"
                                max="500"
                                value={genCount}
                                onChange={(e) => setGenCount(e.target.value)}
                                required
                            />
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Field
                                    label="Nama (opsional)"
                                    value={genBuyerName}
                                    onChange={(e) => setGenBuyerName(e.target.value)}
                                    placeholder="mis. Pak RT"
                                />
                                <Field
                                    label="No HP (opsional)"
                                    type="tel"
                                    value={genBuyerPhone}
                                    onChange={(e) => setGenBuyerPhone(e.target.value)}
                                />
                            </div>
                        </form>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-sm text-content-muted">{genResult.length} kode dibuat. Salin / cetak lalu bagikan.</p>
                            <div className="max-h-60 space-y-1 overflow-y-auto rounded-control bg-surface-sunken p-3 font-mono text-sm tabular-nums text-content">
                                {genResult.map((c) => <div key={c.id}>{c.code}</div>)}
                            </div>
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
}
