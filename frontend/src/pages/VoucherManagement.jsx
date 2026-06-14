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

const inputClass =
    'w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5';

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

function codeStatusBadge(status) {
    switch (status) {
        case 'active': return 'bg-green-500/20 text-green-500';
        case 'unused': return 'bg-gray-200 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300';
        case 'expired': return 'bg-amber-500/20 text-amber-500';
        case 'revoked': return 'bg-red-500/20 text-red-500';
        default: return 'bg-gray-100 dark:bg-gray-700/40 text-gray-500';
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
        return <div className="p-6 space-y-6"><TableSkeleton rows={6} columns={5} /></div>;
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header + global flag */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Voucher Akses CCTV</h1>
                    <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
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
            <div className="bg-white dark:bg-gray-800/90 rounded-xl border border-gray-200 dark:border-gray-700/50 overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700/50">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Area Berbayar</h2>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Hanya area yang ditandai yang terkunci (saat fitur aktif). Pengunjung tanpa
                        voucher melihat kamera area ini sebagai terkunci.
                    </p>
                </div>
                {areas.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-500">Belum ada area. Buat area dulu di menu Areas.</div>
                ) : (
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700/50 max-h-72 overflow-y-auto">
                        {areas.map((area) => {
                            const gated = gatedSet.has(area.id);
                            return (
                                <li key={area.id} className="flex items-center justify-between px-4 py-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{areaLabel(area)}</p>
                                    </div>
                                    <button
                                        onClick={() => toggleAreaGated(area)}
                                        disabled={areaBusyId === area.id}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                                            gated ? 'bg-primary-600 text-white hover:bg-primary-700'
                                                  : 'bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
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
            <div className="bg-white dark:bg-gray-800/90 rounded-xl border border-gray-200 dark:border-gray-700/50 overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700/50 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profil Voucher</h2>
                    <button onClick={openCreateProfile} className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm transition-colors">
                        + Tambah Profil
                    </button>
                </div>
                {profiles.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-500">Belum ada profil. Tambah profil pertama (mis. “RW Dander — 1 hari”).</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-100 dark:bg-gray-900/50">
                                <tr>
                                    {['Nama', 'Durasi', 'Harga', 'Maks/Kode', 'Area', 'Status', 'Aksi'].map((h) => (
                                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700/50">
                                {profiles.map((p) => (
                                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                        <td className="px-4 py-3">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</p>
                                            {p.description && <p className="text-xs text-gray-500">{p.description}</p>}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{formatDuration(p.duration_minutes)}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                                            {p.price > 0 ? `Rp ${Number(p.price).toLocaleString('id-ID')}` : 'Gratis'}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{p.max_uses_per_code}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500">
                                            {(p.area_ids || []).map((id) => areas.find((a) => a.id === id)?.name || `#${id}`).join(', ') || '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.active ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                                                    {p.active ? 'Aktif' : 'Nonaktif'}
                                                </span>
                                                {p.online_purchasable
                                                    ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-sky-500/15 text-sky-500">Online</span>
                                                    : <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700/50 text-gray-500">Khusus admin</span>}
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
            <div className="bg-white dark:bg-gray-800/90 rounded-xl border border-gray-200 dark:border-gray-700/50 overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700/50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Kode Voucher</h2>
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
                    <div className="p-6 text-center text-sm text-gray-500">Belum ada kode. Generate dari profil di atas.</div>
                ) : (
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full">
                            <thead className="bg-gray-100 dark:bg-gray-900/50 sticky top-0">
                                <tr>
                                    {['Kode', 'Profil', 'Status', 'Pemakai', 'Berakhir', 'Pembeli', 'Aksi'].map((h) => (
                                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700/50">
                                {filteredCodes.map((c) => (
                                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                        <td className="px-4 py-3 font-mono text-sm text-gray-900 dark:text-white">{c.code}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500">{profilesById[c.profile_id]?.name || `#${c.profile_id}`}</td>
                                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${codeStatusBadge(c.status)}`}>{c.status}</span></td>
                                        <td className="px-4 py-3 text-xs text-gray-500">{c.redeemed_count ?? 0}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500">{c.expires_at ? new Date(c.expires_at).toLocaleString('id-ID') : '—'}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500">{c.buyer_name || c.buyer_phone || '—'}</td>
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
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-5 border-b border-gray-200 dark:border-gray-700/50">
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingId ? 'Edit Profil Voucher' : 'Profil Voucher Baru'}</h2>
                        </div>
                        <form onSubmit={submitProfile} className="p-5 space-y-4">
                            <div>
                                <label className={labelClass}>Nama Profil *</label>
                                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="RW Dander — 1 Hari" required minLength={2} />
                            </div>
                            <div>
                                <label className={labelClass}>Deskripsi</label>
                                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                <div>
                                    <label className={labelClass}>Durasi *</label>
                                    <input type="number" min="1" value={form.duration_value} onChange={(e) => setForm({ ...form, duration_value: e.target.value })} className={inputClass} required />
                                </div>
                                <div>
                                    <label className={labelClass}>Satuan</label>
                                    <select value={form.duration_unit} onChange={(e) => setForm({ ...form, duration_unit: e.target.value })} className={inputClass}>
                                        <option value="menit">Menit</option>
                                        <option value="jam">Jam</option>
                                        <option value="hari">Hari</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}>Maks pemakai/kode</label>
                                    <input type="number" min="1" value={form.max_uses_per_code} onChange={(e) => setForm({ ...form, max_uses_per_code: e.target.value })} className={inputClass} />
                                </div>
                                <div>
                                    <label className={labelClass}>Harga (Rp)</label>
                                    <input type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={inputClass} />
                                </div>
                                <div className="col-span-2 md:col-span-1">
                                    <label className={labelClass}>Masa berlaku kode <span className="text-xs text-gray-500">(hari, kosong=∞)</span></label>
                                    <input type="number" min="1" value={form.code_validity_days} onChange={(e) => setForm({ ...form, code_validity_days: e.target.value })} className={inputClass} />
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                                    <input type="checkbox" checked={form.online_purchasable} onChange={(e) => setForm({ ...form, online_purchasable: e.target.checked })} className="w-4 h-4 rounded" />
                                    Dijual online (mandiri)
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                                    <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 rounded" />
                                    Aktif
                                </label>
                            </div>
                            <div>
                                <label className={labelClass}>Area yang dibuka *</label>
                                <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700/40 rounded-lg divide-y divide-gray-200 dark:divide-gray-700/40">
                                    {areas.length === 0 ? (
                                        <p className="text-xs text-gray-500 p-3">Belum ada area.</p>
                                    ) : areas.map((area) => (
                                        <label key={area.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer">
                                            <input type="checkbox" checked={form.area_ids.includes(area.id)} onChange={() => toggleFormArea(area.id)} className="w-4 h-4 rounded" />
                                            <span className="text-sm text-gray-900 dark:text-white">{areaLabel(area)}</span>
                                            {!gatedSet.has(area.id) && <span className="text-[10px] text-amber-500">(belum ditandai berbayar)</span>}
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowProfileModal(false)} className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-900 dark:text-white px-4 py-2 rounded-lg transition-colors">Batal</button>
                                <button type="submit" disabled={savingProfile} className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors">{editingId ? 'Perbarui' : 'Simpan'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Generate-codes modal */}
            {genProfile && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-5 border-b border-gray-200 dark:border-gray-700/50">
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Generate Kode — {genProfile.name}</h2>
                        </div>
                        {!genResult ? (
                            <form onSubmit={submitGenerate} className="p-5 space-y-4">
                                <div>
                                    <label className={labelClass}>Jumlah kode</label>
                                    <input type="number" min="1" max="500" value={genCount} onChange={(e) => setGenCount(e.target.value)} className={inputClass} required />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelClass}>Nama (opsional)</label>
                                        <input type="text" value={genBuyerName} onChange={(e) => setGenBuyerName(e.target.value)} className={inputClass} placeholder="mis. Pak RT" />
                                    </div>
                                    <div>
                                        <label className={labelClass}>No HP (opsional)</label>
                                        <input type="text" value={genBuyerPhone} onChange={(e) => setGenBuyerPhone(e.target.value)} className={inputClass} />
                                    </div>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button type="button" onClick={() => setGenProfile(null)} className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-900 dark:text-white px-4 py-2 rounded-lg transition-colors">Batal</button>
                                    <button type="submit" disabled={generating} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors">Buat Kode</button>
                                </div>
                            </form>
                        ) : (
                            <div className="p-5 space-y-4">
                                <p className="text-sm text-gray-600 dark:text-gray-400">{genResult.length} kode dibuat. Salin / cetak lalu bagikan.</p>
                                <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 max-h-60 overflow-y-auto font-mono text-sm text-gray-900 dark:text-white space-y-1">
                                    {genResult.map((c) => <div key={c.id}>{c.code}</div>)}
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={() => copyCodes(genResult)} className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors">Salin semua</button>
                                    <button onClick={() => setGenProfile(null)} className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-900 dark:text-white px-4 py-2 rounded-lg transition-colors">Tutup</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
