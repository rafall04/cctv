/*
Purpose: Admin sponsor management — CRUD sponsors, package overview, and per-camera sponsor assignment.
Caller: Protected admin sponsor route.
Deps: React hooks, NotificationContext, sponsorService, cameraService, shared sponsorPackages catalog.
MainFuncs: SponsorManagement.
SideEffects: Calls admin sponsor + camera APIs; updates HttpOnly-free state only.
*/

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import * as sponsorService from '../services/sponsorService';
import { cameraService } from '../services/cameraService';
import { TableSkeleton, StatCardSkeleton } from '../components/ui/Skeleton';
import {
    SPONSOR_PACKAGES,
    SPONSOR_PACKAGE_KEYS,
    getPackageInfo,
} from '../utils/sponsorPackages.js';

const DEFAULT_FORM = {
    name: '',
    logo: '',
    url: '',
    package: 'bronze',
    price: SPONSOR_PACKAGES.bronze.price,
    active: true,
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    notes: '',
};

function packageBadgeClasses(pkgKey) {
    if (pkgKey === 'gold') return 'bg-yellow-500/20 text-yellow-400';
    if (pkgKey === 'silver') return 'bg-gray-400/20 text-gray-300';
    if (pkgKey === 'bronze') return 'bg-orange-500/20 text-orange-400';
    return 'bg-dark-700/40 text-gray-400';
}

function SponsorManagement() {
    // NotificationContext exposes `success(title, message)` / `error(title, message)`.
    // The previous code called `showNotification(message, 'error')` which the
    // context silently ignored — using the typed helpers now so errors and
    // confirmations actually surface.
    const { success: notifySuccess, error: notifyError } = useNotification();
    const [sponsors, setSponsors] = useState([]);
    const [stats, setStats] = useState(null);
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState(DEFAULT_FORM);
    const [assignmentSearch, setAssignmentSearch] = useState('');
    const [pendingCameraId, setPendingCameraId] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        const [sponsorsRes, statsRes, camerasRes] = await Promise.all([
            sponsorService.getAllSponsors(),
            sponsorService.getSponsorStats(),
            cameraService.getAllCameras(),
        ]);

        if (sponsorsRes.success) {
            setSponsors(Array.isArray(sponsorsRes.data) ? sponsorsRes.data : []);
        } else {
            notifyError('Gagal memuat sponsor', sponsorsRes.message || 'Daftar sponsor tidak tersedia');
        }

        if (statsRes.success) {
            setStats(statsRes.data);
        } else {
            notifyError('Gagal memuat statistik sponsor', statsRes.message || 'Statistik sponsor tidak tersedia');
        }

        if (camerasRes?.success) {
            // cameraService.getAllCameras may return either {data: rows} or
            // {data: {cameras: rows}} depending on the source endpoint —
            // normalise here so the assignment table is independent of that
            // shape drift.
            const rows = Array.isArray(camerasRes.data)
                ? camerasRes.data
                : Array.isArray(camerasRes.data?.cameras)
                    ? camerasRes.data.cameras
                    : [];
            setCameras(rows);
        }

        setLoading(false);
    }, [notifyError]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const resetForm = () => {
        setEditingId(null);
        setFormData({ ...DEFAULT_FORM, start_date: new Date().toISOString().split('T')[0] });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const result = editingId
            ? await sponsorService.updateSponsor(editingId, formData)
            : await sponsorService.createSponsor(formData);

        if (!result.success) {
            notifyError(
                editingId ? 'Gagal memperbarui sponsor' : 'Gagal menambahkan sponsor',
                result.message || 'Permintaan ditolak server.',
            );
            return;
        }

        notifySuccess(
            editingId ? 'Sponsor diperbarui' : 'Sponsor ditambahkan',
            editingId
                ? 'Perubahan tersimpan.'
                : 'Sponsor baru siap ditautkan ke kamera di bagian Penugasan Kamera.',
        );
        setShowModal(false);
        resetForm();
        loadData();
    };

    const handleEdit = (sponsor) => {
        setEditingId(sponsor.id);
        setFormData({
            name: sponsor.name || '',
            logo: sponsor.logo || '',
            url: sponsor.url || '',
            package: sponsor.package || 'bronze',
            price: sponsor.price || getPackageInfo(sponsor.package)?.price || 500000,
            active: sponsor.active === 1 || sponsor.active === true,
            contact_name: sponsor.contact_name || '',
            contact_email: sponsor.contact_email || '',
            contact_phone: sponsor.contact_phone || '',
            start_date: sponsor.start_date || '',
            end_date: sponsor.end_date || '',
            notes: sponsor.notes || '',
        });
        setShowModal(true);
    };

    const handleDelete = async (id, name) => {
        // confirm() is used consistently by other admin pages (UserManagement,
        // FeedbackManagement). Keeping the same UX here intentionally — a
        // shared confirm modal is a separate cross-page cleanup.
        if (!window.confirm(`Hapus sponsor "${name}"?`)) return;

        const result = await sponsorService.deleteSponsor(id);
        if (!result.success) {
            notifyError('Gagal menghapus sponsor', result.message || 'Hapus ditolak server.');
            return;
        }
        notifySuccess('Sponsor dihapus', `${name} dihapus dari daftar.`);
        loadData();
    };

    const handlePackageChange = (pkgKey) => {
        const info = getPackageInfo(pkgKey);
        setFormData((current) => ({
            ...current,
            package: pkgKey,
            price: info?.price ?? current.price,
        }));
    };

    // --- Penugasan kamera ---------------------------------------------------
    // The backend assignment endpoint denormalizes name/logo/url/package onto
    // the cameras table. We send all four so the public surface (badge,
    // landing strip) can render straight from the camera row without an
    // extra sponsor-table join. Matching by name is the existing link key.

    const findSponsorByName = useCallback(
        (name) => sponsors.find((sponsor) => sponsor.name === name) || null,
        [sponsors],
    );

    const handleAssignSponsor = async (cameraId, sponsorName) => {
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
            notifyError('Gagal menautkan sponsor', result.message || 'Permintaan ditolak server.');
            return;
        }
        notifySuccess('Sponsor ditautkan', `${sponsor.name} sekarang muncul di kamera ini.`);
        loadData();
    };

    const handleUnassignSponsor = async (cameraId, cameraName) => {
        if (!window.confirm(`Lepas sponsor dari "${cameraName}"?`)) return;

        setPendingCameraId(cameraId);
        const result = await sponsorService.removeSponsorFromCamera(cameraId);
        setPendingCameraId(null);

        if (!result.success) {
            notifyError('Gagal melepas sponsor', result.message || 'Permintaan ditolak server.');
            return;
        }
        notifySuccess('Sponsor dilepas', `Kamera "${cameraName}" tidak lagi disponsori.`);
        loadData();
    };

    const recordingCameras = useMemo(
        () => cameras.filter((camera) => camera.enable_recording !== 0),
        [cameras],
    );

    const filteredCameras = useMemo(() => {
        const term = assignmentSearch.trim().toLowerCase();
        if (!term) return recordingCameras;
        return recordingCameras.filter((camera) => {
            const haystack = [
                camera.name,
                camera.location,
                camera.area_name,
                camera.group_name,
                camera.sponsor_name,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(term);
        });
    }, [assignmentSearch, recordingCameras]);

    const activeSponsorOptions = useMemo(
        () => sponsors.filter((sponsor) => sponsor.active === 1 || sponsor.active === true),
        [sponsors],
    );

    if (loading) {
        return (
            <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StatCardSkeleton />
                    <StatCardSkeleton />
                    <StatCardSkeleton />
                </div>
                <TableSkeleton rows={5} columns={5} />
            </div>
        );
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-white">Manajemen Sponsor</h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Kelola sponsor lokal & penugasannya ke kamera.
                        <span className="ml-1 text-gray-500">(Ads-network — AdSense dsb — diatur di halaman Ads, terpisah.)</span>
                    </p>
                </div>
                <button
                    onClick={() => {
                        resetForm();
                        setShowModal(true);
                    }}
                    className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                >
                    <span>+</span>
                    <span>Tambah Sponsor</span>
                </button>
            </div>

            {/* Statistics Cards */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <div className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Total Sponsor</p>
                        <p className="text-2xl font-bold text-white mt-1">{stats.total_sponsors}</p>
                    </div>
                    <div className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Sponsor Aktif</p>
                        <p className="text-2xl font-bold text-green-400 mt-1">{stats.active_sponsors}</p>
                    </div>
                    <div className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Pendapatan/Bulan</p>
                        <p className="text-2xl font-bold text-primary-400 mt-1">
                            Rp {(stats.monthly_revenue || 0).toLocaleString('id-ID')}
                        </p>
                    </div>
                    <div className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                        <p className="text-gray-400 text-sm">Akan Berakhir</p>
                        <p className="text-2xl font-bold text-yellow-400 mt-1">
                            {stats.expiring_soon?.length || 0}
                        </p>
                    </div>
                </div>
            )}

            {/* Package Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {SPONSOR_PACKAGE_KEYS.map((key) => {
                    const pkg = SPONSOR_PACKAGES[key];
                    return (
                        <div key={key} className="bg-dark-800/90 backdrop-blur-md rounded-xl p-4 border border-dark-700/50">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className={`text-lg font-semibold text-${pkg.color}-400`}>
                                    {pkg.name}
                                </h3>
                                <span className="text-white font-bold">
                                    Rp {pkg.price.toLocaleString('id-ID')}
                                </span>
                            </div>
                            <ul className="text-sm text-gray-400 space-y-1">
                                {pkg.features.map((feature, i) => (
                                    <li key={i} className="flex items-start gap-2">
                                        <span className="text-green-400 mt-0.5">✓</span>
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-3 pt-3 border-t border-dark-700/50">
                                <p className="text-xs text-gray-500">
                                    {stats?.[`${key}_count`] || 0} sponsor
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Sponsors List */}
            <div className="bg-dark-800/90 backdrop-blur-md rounded-xl border border-dark-700/50 overflow-hidden mb-6">
                <div className="p-4 border-b border-dark-700/50">
                    <h2 className="text-lg font-semibold text-white">Daftar Sponsor</h2>
                </div>

                {sponsors.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                        <p>Belum ada sponsor</p>
                        <button
                            onClick={() => setShowModal(true)}
                            className="mt-4 text-primary-400 hover:text-primary-300"
                        >
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
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Kontak</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Aktif di</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-700/50">
                                {sponsors.map((sponsor) => (
                                    <tr key={sponsor.id} className="hover:bg-dark-700/30 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                {sponsor.logo ? (
                                                    <img
                                                        src={sponsor.logo}
                                                        alt={sponsor.name}
                                                        className="w-12 h-12 object-contain bg-white rounded"
                                                    />
                                                ) : (
                                                    <div className="w-12 h-12 bg-dark-700 rounded flex items-center justify-center">
                                                        <span className="text-gray-500 text-xs">No Logo</span>
                                                    </div>
                                                )}
                                                <div>
                                                    <p className="text-white font-medium">{sponsor.name}</p>
                                                    {sponsor.url && (
                                                        <a
                                                            href={sponsor.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-xs text-primary-400 hover:text-primary-300"
                                                        >
                                                            {sponsor.url}
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${packageBadgeClasses(sponsor.package)}`}>
                                                {getPackageInfo(sponsor.package)?.name || sponsor.package}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-white">
                                            Rp {(sponsor.price || 0).toLocaleString('id-ID')}
                                        </td>
                                        <td className="px-4 py-3 text-gray-400 text-sm">
                                            {sponsor.start_date && (
                                                <div>
                                                    <p>{new Date(sponsor.start_date).toLocaleDateString('id-ID')}</p>
                                                    {sponsor.end_date && (
                                                        <p className="text-xs">s/d {new Date(sponsor.end_date).toLocaleDateString('id-ID')}</p>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-gray-400 text-sm">
                                            {sponsor.contact_name && <p>{sponsor.contact_name}</p>}
                                            {sponsor.contact_email && <p className="text-xs">{sponsor.contact_email}</p>}
                                            {sponsor.contact_phone && <p className="text-xs">{sponsor.contact_phone}</p>}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${sponsor.camera_count > 0
                                                ? 'bg-primary-500/15 text-primary-300'
                                                : 'bg-dark-700/40 text-gray-500'
                                                }`}>
                                                {sponsor.camera_count || 0} kamera
                                            </span>
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
                                                <button
                                                    onClick={() => handleEdit(sponsor)}
                                                    className="text-primary-400 hover:text-primary-300 text-sm"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(sponsor.id, sponsor.name)}
                                                    className="text-red-400 hover:text-red-300 text-sm"
                                                >
                                                    Hapus
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Penugasan Kamera */}
            <div className="bg-dark-800/90 backdrop-blur-md rounded-xl border border-dark-700/50 overflow-hidden">
                <div className="p-4 border-b border-dark-700/50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Penugasan Kamera</h2>
                        <p className="text-xs text-gray-400 mt-1">
                            Pilih sponsor mana yang muncul di kamera mana. Backend menyimpan link denormalisasi di tabel cameras, jadi penampilan publik bisa langsung baca dari row kamera.
                        </p>
                    </div>
                    <input
                        type="search"
                        value={assignmentSearch}
                        onChange={(e) => setAssignmentSearch(e.target.value)}
                        placeholder="Cari kamera / area / sponsor saat ini"
                        className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500 md:w-72"
                    />
                </div>

                {recordingCameras.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 text-sm">
                        Belum ada kamera ber-recording untuk ditautkan.
                    </div>
                ) : filteredCameras.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 text-sm">
                        Tidak ada kamera cocok dengan filter.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-dark-900/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Kamera</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Lokasi</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Sponsor Saat Ini</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Ganti Sponsor</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-700/50">
                                {filteredCameras.map((camera) => {
                                    const sponsorName = camera.sponsor_name || '';
                                    const sponsorPackage = camera.sponsor_package || '';
                                    const isBusy = pendingCameraId === camera.id;

                                    return (
                                        <tr key={camera.id} className="hover:bg-dark-700/30 transition-colors">
                                            <td className="px-4 py-3 text-white text-sm">
                                                <p className="font-medium">{camera.name || `Kamera ${camera.id}`}</p>
                                                <p className="text-xs text-gray-500">#{camera.id}</p>
                                            </td>
                                            <td className="px-4 py-3 text-gray-400 text-sm">
                                                {camera.location || camera.area_name || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-sm">
                                                {sponsorName ? (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-white">{sponsorName}</span>
                                                        {sponsorPackage && (
                                                            <span className={`px-2 py-0.5 rounded text-xs ${packageBadgeClasses(sponsorPackage)}`}>
                                                                {getPackageInfo(sponsorPackage)?.name || sponsorPackage}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-500">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <select
                                                    value={sponsorName}
                                                    disabled={isBusy || activeSponsorOptions.length === 0}
                                                    onChange={(e) => {
                                                        const target = e.target.value;
                                                        if (!target) {
                                                            handleUnassignSponsor(camera.id, camera.name || `#${camera.id}`);
                                                            return;
                                                        }
                                                        if (target === sponsorName) return;
                                                        handleAssignSponsor(camera.id, target);
                                                    }}
                                                    className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary-500 disabled:opacity-50"
                                                >
                                                    <option value="">— Tanpa sponsor —</option>
                                                    {activeSponsorOptions.map((sponsor) => (
                                                        <option key={sponsor.id} value={sponsor.name}>
                                                            {sponsor.name} ({getPackageInfo(sponsor.package)?.name || sponsor.package})
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {sponsorName && (
                                                    <button
                                                        onClick={() => handleUnassignSponsor(camera.id, camera.name || `#${camera.id}`)}
                                                        disabled={isBusy}
                                                        className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50"
                                                    >
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

            {/* Modal Form */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-dark-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-dark-700/50">
                            <h2 className="text-xl font-bold text-white">
                                {editingId ? 'Edit Sponsor' : 'Tambah Sponsor Baru'}
                            </h2>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Nama Sponsor *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        required
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">URL Logo</label>
                                    <input
                                        type="url"
                                        value={formData.logo}
                                        onChange={(e) => setFormData({ ...formData, logo: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        placeholder="https://example.com/logo.png"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Website URL</label>
                                    <input
                                        type="url"
                                        value={formData.url}
                                        onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        placeholder="https://example.com"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Paket *</label>
                                    <select
                                        value={formData.package}
                                        onChange={(e) => handlePackageChange(e.target.value)}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    >
                                        {SPONSOR_PACKAGE_KEYS.map((key) => {
                                            const pkg = SPONSOR_PACKAGES[key];
                                            return (
                                                <option key={key} value={key}>
                                                    {pkg.name} - Rp {pkg.price.toLocaleString('id-ID')}/bulan
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Harga (Rp) *</label>
                                    <input
                                        type="number"
                                        value={formData.price}
                                        onChange={(e) => setFormData({ ...formData, price: parseInt(e.target.value, 10) || 0 })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Tanggal Mulai</label>
                                    <input
                                        type="date"
                                        value={formData.start_date}
                                        onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Tanggal Berakhir</label>
                                    <input
                                        type="date"
                                        value={formData.end_date}
                                        onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Nama Kontak</label>
                                    <input
                                        type="text"
                                        value={formData.contact_name}
                                        onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Email Kontak</label>
                                    <input
                                        type="email"
                                        value={formData.contact_email}
                                        onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Telepon Kontak</label>
                                    <input
                                        type="tel"
                                        value={formData.contact_phone}
                                        onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Catatan</label>
                                    <textarea
                                        value={formData.notes}
                                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                        className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500"
                                        rows="3"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.active}
                                            onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                                            className="w-4 h-4 text-primary-600 bg-dark-700 border-dark-600 rounded focus:ring-primary-500"
                                        />
                                        <span className="text-sm text-gray-300">Sponsor Aktif</span>
                                    </label>
                                </div>
                            </div>

                            <div className="bg-dark-900/50 rounded-lg p-4">
                                <p className="text-sm text-gray-400 mb-2">Fitur paket {getPackageInfo(formData.package)?.name}:</p>
                                <ul className="text-sm text-gray-300 space-y-1">
                                    {(getPackageInfo(formData.package)?.features || []).map((feature, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                            <span className="text-green-400 mt-0.5">✓</span>
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowModal(false);
                                        resetForm();
                                    }}
                                    className="flex-1 bg-dark-700 hover:bg-dark-600 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors"
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
