/*
Purpose: Admin sponsor management — package catalog CRUD, sponsor CRUD with multi-camera picker, per-camera quick-swap.
Caller: Protected admin sponsor route.
Deps: React hooks, NotificationContext, sponsorService, sponsorPackageService, cameraService, SponsorPackagePanel.
MainFuncs: SponsorManagement.
SideEffects: Calls admin sponsor / sponsor-packages / camera APIs.
*/

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import * as sponsorService from '../services/sponsorService';
import sponsorPackageService from '../services/sponsorPackageService';
import { cameraService } from '../services/cameraService';
import { TableSkeleton, StatCardSkeleton } from '../components/ui/Skeleton';
import SponsorPackagePanel from '../components/admin/sponsors/SponsorPackagePanel.jsx';

// Pre-bound Tailwind color classes — using template literals against the
// `color` field would silently get purged by the JIT compiler. The list
// here mirrors the COLOR_OPTIONS in SponsorPackagePanel.
function badgeClass(color) {
    switch (color) {
        case 'yellow': return 'bg-yellow-500/20 text-yellow-400';
        case 'gray': return 'bg-gray-400/20 text-gray-300';
        case 'orange': return 'bg-orange-500/20 text-orange-400';
        case 'sky': return 'bg-sky-500/20 text-sky-400';
        case 'emerald': return 'bg-emerald-500/20 text-emerald-400';
        case 'rose': return 'bg-rose-500/20 text-rose-400';
        case 'purple': return 'bg-purple-500/20 text-purple-400';
        default: return 'bg-dark-700/40 text-gray-400';
    }
}

const SPONSOR_FORM_DEFAULT = {
    name: '',
    logo: '',
    url: '',
    package: '',
    price: 0,
    camera_limit: '',
    active: true,
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    notes: '',
};

function normalizeCameraRows(response) {
    const data = response?.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.cameras)) return data.cameras;
    return [];
}

function SponsorManagement() {
    const { success: notifySuccess, error: notifyError } = useNotification();
    const [sponsors, setSponsors] = useState([]);
    const [packages, setPackages] = useState([]);
    const [stats, setStats] = useState(null);
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(SPONSOR_FORM_DEFAULT);
    const [selectedCameraIds, setSelectedCameraIds] = useState(new Set());
    const [originalCameraIds, setOriginalCameraIds] = useState(new Set());
    const [cameraSearch, setCameraSearch] = useState('');
    const [assignmentSearch, setAssignmentSearch] = useState('');
    const [pendingCameraId, setPendingCameraId] = useState(null);
    const [saving, setSaving] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        const [sponsorsRes, statsRes, camerasRes, packagesRes] = await Promise.all([
            sponsorService.getAllSponsors(),
            sponsorService.getSponsorStats(),
            cameraService.getAllCameras(),
            sponsorPackageService.listPackages(),
        ]);

        if (sponsorsRes.success) {
            setSponsors(Array.isArray(sponsorsRes.data) ? sponsorsRes.data : []);
        } else {
            notifyError('Gagal memuat sponsor', sponsorsRes.message);
        }
        if (statsRes.success) setStats(statsRes.data);
        if (camerasRes?.success) setCameras(normalizeCameraRows(camerasRes));
        if (packagesRes?.success) {
            setPackages(Array.isArray(packagesRes.data) ? packagesRes.data : []);
        } else {
            notifyError('Gagal memuat profil paket', packagesRes?.message);
        }

        setLoading(false);
    }, [notifyError]);

    useEffect(() => { loadData(); }, [loadData]);

    const packagesByKey = useMemo(() => {
        const map = {};
        for (const pkg of packages) map[pkg.key] = pkg;
        return map;
    }, [packages]);

    const recordingCameras = useMemo(
        () => cameras.filter((camera) => camera.enable_recording !== 0),
        [cameras],
    );

    const resetForm = useCallback(() => {
        setEditingId(null);
        const firstPackage = packages[0]?.key || '';
        setForm({
            ...SPONSOR_FORM_DEFAULT,
            package: firstPackage,
            price: packages[0]?.default_price ?? 0,
            camera_limit: packages[0]?.default_camera_limit ?? '',
            start_date: new Date().toISOString().split('T')[0],
        });
        setSelectedCameraIds(new Set());
        setOriginalCameraIds(new Set());
        setCameraSearch('');
    }, [packages]);

    const openCreate = () => {
        resetForm();
        setShowModal(true);
    };

    const openEdit = (sponsor) => {
        setEditingId(sponsor.id);
        setForm({
            name: sponsor.name || '',
            logo: sponsor.logo || '',
            url: sponsor.url || '',
            package: sponsor.package || '',
            price: sponsor.price ?? 0,
            // camera_limit on the row may be null (unlimited) — show as empty
            // string in the input so admin sees "blank = no cap" affordance.
            camera_limit: sponsor.camera_limit === null || sponsor.camera_limit === undefined ? '' : sponsor.camera_limit,
            active: sponsor.active === 1 || sponsor.active === true,
            contact_name: sponsor.contact_name || '',
            contact_email: sponsor.contact_email || '',
            contact_phone: sponsor.contact_phone || '',
            start_date: sponsor.start_date || '',
            end_date: sponsor.end_date || '',
            notes: sponsor.notes || '',
        });
        // Pre-select cameras that currently carry this sponsor's name.
        const assigned = new Set(
            cameras.filter((c) => c.sponsor_name === sponsor.name).map((c) => c.id)
        );
        setSelectedCameraIds(new Set(assigned));
        setOriginalCameraIds(new Set(assigned));
        setCameraSearch('');
        setShowModal(true);
    };

    const handlePackageChange = (pkgKey) => {
        const pkg = packagesByKey[pkgKey];
        setForm((current) => ({
            ...current,
            package: pkgKey,
            // Prefill price + camera_limit from package defaults so a fresh
            // selection looks sensible, but admin can still override per-row.
            price: pkg?.default_price ?? current.price,
            camera_limit: pkg?.default_camera_limit ?? '',
        }));
    };

    const toggleCameraInModal = (cameraId) => {
        setSelectedCameraIds((current) => {
            const next = new Set(current);
            if (next.has(cameraId)) next.delete(cameraId);
            else next.add(cameraId);
            return next;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);

        // Step 1: persist sponsor row (create or update).
        const payload = {
            ...form,
            price: Number(form.price) || 0,
            camera_limit: form.camera_limit === '' || form.camera_limit === null
                ? null
                : Math.max(0, Math.floor(Number(form.camera_limit))),
        };

        const result = editingId
            ? await sponsorService.updateSponsor(editingId, payload)
            : await sponsorService.createSponsor(payload);

        if (!result.success) {
            setSaving(false);
            notifyError(
                editingId ? 'Gagal memperbarui sponsor' : 'Gagal menambahkan sponsor',
                result.message || 'Permintaan ditolak server.',
            );
            return;
        }

        // Step 2: reconcile camera assignments. Only on edits do we have
        // an "original" set to diff against; on creates everything is an
        // add. We send adds first so the cap check sees the freed slots
        // from removes BEFORE judging whether the new ones fit.
        const sponsorName = form.name.trim();
        const sponsorMeta = {
            sponsor_name: sponsorName,
            sponsor_logo: form.logo || null,
            sponsor_url: form.url || null,
            sponsor_package: form.package || null,
        };

        const toAdd = [...selectedCameraIds].filter((id) => !originalCameraIds.has(id));
        const toRemove = [...originalCameraIds].filter((id) => !selectedCameraIds.has(id));

        const errors = [];
        for (const cameraId of toRemove) {
            const removeRes = await sponsorService.removeSponsorFromCamera(cameraId);
            if (!removeRes.success) errors.push(`Lepas kamera #${cameraId}: ${removeRes.message}`);
        }
        for (const cameraId of toAdd) {
            const assignRes = await sponsorService.assignSponsorToCamera(cameraId, sponsorMeta);
            if (!assignRes.success) errors.push(`Tugaskan kamera #${cameraId}: ${assignRes.message}`);
        }

        setSaving(false);

        if (errors.length > 0) {
            notifyError('Sebagian penugasan gagal', errors.join(' | '));
        } else {
            notifySuccess(
                editingId ? 'Sponsor diperbarui' : 'Sponsor ditambahkan',
                `Sponsor tersimpan${toAdd.length || toRemove.length ? ` & ${toAdd.length + toRemove.length} penugasan kamera disinkronkan.` : '.'}`,
            );
        }

        setShowModal(false);
        resetForm();
        loadData();
    };

    const handleDelete = async (sponsor) => {
        if (!window.confirm(`Hapus sponsor "${sponsor.name}"?`)) return;
        const result = await sponsorService.deleteSponsor(sponsor.id);
        if (!result.success) {
            notifyError('Gagal menghapus sponsor', result.message);
            return;
        }
        notifySuccess('Sponsor dihapus', `${sponsor.name} dihapus.`);
        loadData();
    };

    // --- Quick-swap assignment table at the bottom -------------------------
    const findSponsorByName = useCallback(
        (name) => sponsors.find((s) => s.name === name) || null,
        [sponsors],
    );

    const handleQuickAssign = async (cameraId, sponsorName) => {
        setPendingCameraId(cameraId);
        const sponsor = findSponsorByName(sponsorName);
        if (!sponsor) {
            notifyError('Sponsor tidak ditemukan', 'Refresh halaman ini lalu coba lagi.');
            setPendingCameraId(null);
            return;
        }
        const result = await sponsorService.assignSponsorToCamera(cameraId, {
            sponsor_name: sponsor.name,
            sponsor_logo: sponsor.logo || null,
            sponsor_url: sponsor.url || null,
            sponsor_package: sponsor.package || null,
        });
        setPendingCameraId(null);
        if (!result.success) {
            notifyError('Gagal menautkan sponsor', result.message);
            return;
        }
        notifySuccess('Sponsor ditautkan', `${sponsor.name} muncul di kamera ini.`);
        loadData();
    };

    const handleQuickUnassign = async (cameraId, cameraName) => {
        if (!window.confirm(`Lepas sponsor dari "${cameraName}"?`)) return;
        setPendingCameraId(cameraId);
        const result = await sponsorService.removeSponsorFromCamera(cameraId);
        setPendingCameraId(null);
        if (!result.success) {
            notifyError('Gagal melepas sponsor', result.message);
            return;
        }
        notifySuccess('Sponsor dilepas', `${cameraName} tidak lagi disponsori.`);
        loadData();
    };

    const filteredCamerasForAssignment = useMemo(() => {
        const term = assignmentSearch.trim().toLowerCase();
        if (!term) return recordingCameras;
        return recordingCameras.filter((camera) => {
            const haystack = [
                camera.name, camera.location, camera.area_name, camera.group_name, camera.sponsor_name,
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(term);
        });
    }, [assignmentSearch, recordingCameras]);

    const activeSponsorOptions = useMemo(
        () => sponsors.filter((s) => s.active === 1 || s.active === true),
        [sponsors],
    );

    // --- Camera picker filter inside the sponsor modal ---------------------
    const camerasForModal = useMemo(() => {
        const term = cameraSearch.trim().toLowerCase();
        if (!term) return recordingCameras;
        return recordingCameras.filter((camera) => {
            const haystack = [camera.name, camera.location, camera.area_name, camera.sponsor_name]
                .filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(term);
        });
    }, [cameraSearch, recordingCameras]);

    const cameraLimitValue = form.camera_limit === '' ? null : Number(form.camera_limit);
    const overCameraLimit = cameraLimitValue !== null && selectedCameraIds.size > cameraLimitValue;

    if (loading) {
        return (
            <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
                </div>
                <TableSkeleton rows={5} columns={5} />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white">Manajemen Sponsor</h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Kelola profil paket, sponsor lokal, & penugasan kamera-nya.
                        <span className="ml-1 text-gray-500">(Ads-network di halaman Ads, terpisah.)</span>
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    disabled={packages.length === 0}
                    className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                    title={packages.length === 0 ? 'Buat minimal 1 profil paket dulu' : 'Tambah sponsor baru'}
                >
                    <span>+</span>
                    <span>Tambah Sponsor</span>
                </button>
            </div>

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-dark-800/90 rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Total Sponsor</p>
                        <p className="text-2xl font-bold text-white mt-1">{stats.total_sponsors}</p>
                    </div>
                    <div className="bg-dark-800/90 rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Sponsor Aktif</p>
                        <p className="text-2xl font-bold text-green-400 mt-1">{stats.active_sponsors}</p>
                    </div>
                    <div className="bg-dark-800/90 rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Pendapatan/Bulan</p>
                        <p className="text-2xl font-bold text-primary-400 mt-1">
                            Rp {(stats.monthly_revenue || 0).toLocaleString('id-ID')}
                        </p>
                    </div>
                    <div className="bg-dark-800/90 rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Akan Berakhir</p>
                        <p className="text-2xl font-bold text-yellow-400 mt-1">{stats.expiring_soon?.length || 0}</p>
                    </div>
                </div>
            )}

            {/* Package Catalog */}
            <SponsorPackagePanel packages={packages} onChanged={loadData} />

            {/* Sponsor list */}
            <div className="bg-dark-800/90 rounded-xl border border-dark-700/50 overflow-hidden">
                <div className="p-4 border-b border-dark-700/50">
                    <h2 className="text-lg font-semibold text-white">Daftar Sponsor</h2>
                </div>
                {sponsors.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                        <p>Belum ada sponsor</p>
                        <button onClick={openCreate} disabled={packages.length === 0}
                            className="mt-4 text-primary-400 hover:text-primary-300 disabled:opacity-50">
                            Tambah sponsor pertama
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-dark-900/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Sponsor</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Paket</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Harga</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Periode</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Kamera</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Kontak</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-700/50">
                                {sponsors.map((sponsor) => {
                                    const limit = sponsor.camera_limit;
                                    const used = sponsor.camera_count || 0;
                                    const cap = limit === null || limit === undefined ? '∞' : limit;
                                    const over = typeof limit === 'number' && used > limit;
                                    return (
                                        <tr key={sponsor.id} className="hover:bg-dark-700/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    {sponsor.logo ? (
                                                        <img src={sponsor.logo} alt={sponsor.name} className="w-12 h-12 object-contain bg-white rounded" />
                                                    ) : (
                                                        <div className="w-12 h-12 bg-dark-700 rounded flex items-center justify-center">
                                                            <span className="text-gray-500 text-xs">No Logo</span>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <p className="text-white font-medium">{sponsor.name}</p>
                                                        {sponsor.url && (
                                                            <a href={sponsor.url} target="_blank" rel="noopener noreferrer"
                                                                className="text-xs text-primary-400 hover:text-primary-300">
                                                                {sponsor.url}
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badgeClass(sponsor.package_color || packagesByKey[sponsor.package]?.color)}`}>
                                                    {sponsor.package_name || packagesByKey[sponsor.package]?.name || sponsor.package || '—'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-white">Rp {(sponsor.price || 0).toLocaleString('id-ID')}</td>
                                            <td className="px-4 py-3 text-gray-400 text-sm">
                                                {sponsor.start_date && (
                                                    <div>
                                                        <p>{new Date(sponsor.start_date).toLocaleDateString('id-ID')}</p>
                                                        {sponsor.end_date && <p className="text-xs">s/d {new Date(sponsor.end_date).toLocaleDateString('id-ID')}</p>}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-sm">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${over
                                                    ? 'bg-red-500/20 text-red-400'
                                                    : used > 0
                                                        ? 'bg-primary-500/15 text-primary-300'
                                                        : 'bg-dark-700/40 text-gray-500'
                                                    }`}>
                                                    {used}/{cap}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-400 text-sm">
                                                {sponsor.contact_name && <p>{sponsor.contact_name}</p>}
                                                {sponsor.contact_email && <p className="text-xs">{sponsor.contact_email}</p>}
                                                {sponsor.contact_phone && <p className="text-xs">{sponsor.contact_phone}</p>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded text-xs font-medium ${(sponsor.active === 1 || sponsor.active === true)
                                                    ? 'bg-green-500/20 text-green-400'
                                                    : 'bg-red-500/20 text-red-400'
                                                    }`}>
                                                    {(sponsor.active === 1 || sponsor.active === true) ? 'Aktif' : 'Nonaktif'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button onClick={() => openEdit(sponsor)} className="text-primary-400 hover:text-primary-300 text-sm">Edit</button>
                                                    <button onClick={() => handleDelete(sponsor)} className="text-red-400 hover:text-red-300 text-sm">Hapus</button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Penugasan Kamera quick swap */}
            <div className="bg-dark-800/90 rounded-xl border border-dark-700/50 overflow-hidden">
                <div className="p-4 border-b border-dark-700/50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Penugasan Kamera (Quick Swap)</h2>
                        <p className="text-xs text-gray-400 mt-1">
                            Mode cepat untuk ganti / lepas sponsor per kamera. Penugasan utama disarankan lewat form sponsor (centang banyak kamera sekaligus).
                        </p>
                    </div>
                    <input
                        type="search"
                        value={assignmentSearch}
                        onChange={(e) => setAssignmentSearch(e.target.value)}
                        placeholder="Cari kamera / area / sponsor"
                        className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500 md:w-72"
                    />
                </div>
                {recordingCameras.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 text-sm">Belum ada kamera ber-recording.</div>
                ) : filteredCamerasForAssignment.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 text-sm">Tidak ada kamera cocok dengan filter.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-dark-900/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Kamera</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Lokasi</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Sponsor Saat Ini</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Ganti</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-700/50">
                                {filteredCamerasForAssignment.map((camera) => {
                                    const isBusy = pendingCameraId === camera.id;
                                    return (
                                        <tr key={camera.id} className="hover:bg-dark-700/30 transition-colors">
                                            <td className="px-4 py-3 text-white text-sm">
                                                <p className="font-medium">{camera.name || `Kamera ${camera.id}`}</p>
                                                <p className="text-xs text-gray-500">#{camera.id}</p>
                                            </td>
                                            <td className="px-4 py-3 text-gray-400 text-sm">{camera.location || camera.area_name || '—'}</td>
                                            <td className="px-4 py-3 text-sm">
                                                {camera.sponsor_name ? (
                                                    <span className="text-white">{camera.sponsor_name}</span>
                                                ) : (
                                                    <span className="text-gray-500">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <select
                                                    value={camera.sponsor_name || ''}
                                                    disabled={isBusy || activeSponsorOptions.length === 0}
                                                    onChange={(e) => {
                                                        const target = e.target.value;
                                                        if (!target) {
                                                            handleQuickUnassign(camera.id, camera.name || `#${camera.id}`);
                                                            return;
                                                        }
                                                        if (target === camera.sponsor_name) return;
                                                        handleQuickAssign(camera.id, target);
                                                    }}
                                                    className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary-500 disabled:opacity-50"
                                                >
                                                    <option value="">— Tanpa sponsor —</option>
                                                    {activeSponsorOptions.map((sponsor) => (
                                                        <option key={sponsor.id} value={sponsor.name}>
                                                            {sponsor.name} ({sponsor.package_name || sponsor.package})
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {camera.sponsor_name && (
                                                    <button onClick={() => handleQuickUnassign(camera.id, camera.name || `#${camera.id}`)}
                                                        disabled={isBusy}
                                                        className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50">
                                                        Lepas
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Sponsor Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-dark-800 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-5 border-b border-dark-700/50">
                            <h2 className="text-xl font-bold text-white">
                                {editingId ? 'Edit Sponsor' : 'Tambah Sponsor Baru'}
                            </h2>
                        </div>
                        <form onSubmit={handleSubmit} className="p-5 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Nama Sponsor *</label>
                                    <input type="text" value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                                        required />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">URL Logo</label>
                                    <input type="url" value={form.logo}
                                        onChange={(e) => setForm({ ...form, logo: e.target.value })}
                                        placeholder="https://example.com/logo.png"
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Website URL</label>
                                    <input type="url" value={form.url}
                                        onChange={(e) => setForm({ ...form, url: e.target.value })}
                                        placeholder="https://example.com"
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Paket *</label>
                                    <select
                                        value={form.package}
                                        onChange={(e) => handlePackageChange(e.target.value)}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                                        required
                                    >
                                        <option value="" disabled>Pilih paket</option>
                                        {packages.map((pkg) => (
                                            <option key={pkg.key} value={pkg.key}>
                                                {pkg.name} — Rp {(pkg.default_price || 0).toLocaleString('id-ID')}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Harga (Rp) *</label>
                                    <input type="number" min="0" value={form.price}
                                        onChange={(e) => setForm({ ...form, price: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                                        required />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Limit Kamera <span className="text-xs text-gray-500">(kosong = tanpa batas)</span>
                                    </label>
                                    <input type="number" min="0" value={form.camera_limit}
                                        onChange={(e) => setForm({ ...form, camera_limit: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Tanggal Mulai</label>
                                    <input type="date" value={form.start_date}
                                        onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Tanggal Berakhir</label>
                                    <input type="date" value={form.end_date}
                                        onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Nama Kontak</label>
                                    <input type="text" value={form.contact_name}
                                        onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Email Kontak</label>
                                    <input type="email" value={form.contact_email}
                                        onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Telepon Kontak</label>
                                    <input type="tel" value={form.contact_phone}
                                        onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Catatan</label>
                                    <textarea value={form.notes}
                                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                        rows="3"
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={form.active}
                                            onChange={(e) => setForm({ ...form, active: e.target.checked })}
                                            className="w-4 h-4 text-primary-600 bg-dark-700 border-dark-600 rounded focus:ring-primary-500" />
                                        <span className="text-sm text-gray-300">Sponsor Aktif</span>
                                    </label>
                                </div>
                            </div>

                            {/* Camera picker */}
                            <div className="bg-dark-900/40 rounded-lg p-4 space-y-3">
                                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-medium text-gray-200">Tugaskan ke Kamera</p>
                                        <p className="text-xs text-gray-500">
                                            Pilih kamera yang akan menampilkan logo sponsor ini.{' '}
                                            <span className={overCameraLimit ? 'text-red-400' : 'text-gray-500'}>
                                                {selectedCameraIds.size}{cameraLimitValue === null ? '' : ` / ${cameraLimitValue}`} dipilih
                                            </span>
                                        </p>
                                    </div>
                                    <input
                                        type="search"
                                        value={cameraSearch}
                                        onChange={(e) => setCameraSearch(e.target.value)}
                                        placeholder="Cari kamera"
                                        className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary-500 md:w-60"
                                    />
                                </div>
                                {overCameraLimit && (
                                    <p className="text-xs text-red-400">
                                        Melebihi limit paket. Naikkan limit kamera atau hapus pilihan.
                                    </p>
                                )}
                                <div className="max-h-64 overflow-y-auto border border-dark-700/40 rounded-lg divide-y divide-dark-700/40">
                                    {camerasForModal.length === 0 ? (
                                        <p className="text-xs text-gray-500 p-3">Tidak ada kamera cocok.</p>
                                    ) : (
                                        camerasForModal.map((camera) => {
                                            const isSelected = selectedCameraIds.has(camera.id);
                                            const heldByOtherSponsor =
                                                camera.sponsor_name && camera.sponsor_name !== form.name;
                                            return (
                                                <label
                                                    key={camera.id}
                                                    className="flex items-center gap-3 px-3 py-2 hover:bg-dark-700/30 cursor-pointer"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleCameraInModal(camera.id)}
                                                        className="w-4 h-4 text-primary-600 bg-dark-700 border-dark-600 rounded focus:ring-primary-500"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-white truncate">{camera.name || `Kamera #${camera.id}`}</p>
                                                        <p className="text-xs text-gray-500 truncate">
                                                            {camera.location || camera.area_name || `#${camera.id}`}
                                                            {heldByOtherSponsor && (
                                                                <span className="ml-2 text-amber-400">
                                                                    Saat ini disponsori {camera.sponsor_name} — centang untuk override
                                                                </span>
                                                            )}
                                                        </p>
                                                    </div>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => { setShowModal(false); resetForm(); }}
                                    className="flex-1 bg-dark-700 hover:bg-dark-600 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving || overCameraLimit}
                                    className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    {editingId ? 'Perbarui' : 'Simpan'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default SponsorManagement;
