import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { areaService } from '../services/areaService';
import { cameraService } from '../services/cameraService';
import { settingsService } from '../services/settingsService';
import { useNotification } from '../contexts/NotificationContext';
import { StatCardSkeleton, CameraCardSkeleton, NoAreasEmptyState, Alert } from '../components/ui';

// Lazy load LocationPicker to avoid conflicts with CameraManagement
const LocationPicker = lazy(() => import('../components/LocationPicker'));

const defaultBulkConfig = {
    targetFilter: 'all',
    operation: 'policy_update',
    delivery_type: 'ignore',
    external_use_proxy: 'ignore',
    enable_recording: 'ignore',
    enabled: 'ignore',
    external_tls_mode: 'ignore',
    external_origin_mode: 'ignore',
    video_codec: 'ignore',
    clear_internal_rtsp: false,
};

export default function AreaManagement() {
    const [areas, setAreas] = useState([]);
    const [areaSummaries, setAreaSummaries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingArea, setEditingArea] = useState(null);
    const [formData, setFormData] = useState({ 
        name: '', description: '', rt: '', rw: '', kelurahan: '', kecamatan: '', latitude: '', longitude: ''
    });
    const [formErrors, setFormErrors] = useState({});
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [filterKecamatan, setFilterKecamatan] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [deleting, setDeleting] = useState(false);
    
    // Map center settings
    const [showMapCenterModal, setShowMapCenterModal] = useState(false);
    const [mapCenter, setMapCenter] = useState({ latitude: '', longitude: '', zoom: 13, name: 'Bojonegoro' });
    const [savingMapCenter, setSavingMapCenter] = useState(false);
    
    // Bulk Config Modal
    const [bulkConfigArea, setBulkConfigArea] = useState(null);
    const [bulkConfig, setBulkConfig] = useState(defaultBulkConfig);
    const [bulkPreview, setBulkPreview] = useState(null);
    const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
    const [applyingBulk, setApplyingBulk] = useState(false);

    const [bulkDeleteAreaConfirm, setBulkDeleteAreaConfirm] = useState(null);
    const [applyingBulkDelete, setApplyingBulkDelete] = useState(false);

    const { success, error: showError } = useNotification();

    const loadAreas = useCallback(async () => {
        try {
            setLoading(true);
            setLoadError(null);
            const [areasResponse, summaryResponse] = await Promise.all([
                areaService.getAllAreas(),
                areaService.getAreaSummary(),
            ]);
            if (areasResponse.success) setAreas(areasResponse.data);
            if (summaryResponse.success) setAreaSummaries(summaryResponse.data);
        } catch (err) {
            console.error('Load areas error:', err);
            setLoadError('Gagal memuat data area.');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadMapCenter = useCallback(async () => {
        try {
            const response = await settingsService.getMapCenter();
            if (response.success && response.data) {
                setMapCenter(response.data);
            }
        } catch (err) {
            console.error('Load map center error:', err);
        }
    }, []);

    useEffect(() => {
        loadAreas();
        loadMapCenter();
    }, [loadAreas, loadMapCenter]);

    const validateForm = useCallback(() => {
        const errors = {};
        if (!formData.name.trim()) {
            errors.name = 'Nama area wajib diisi';
        } else if (formData.name.trim().length < 2) {
            errors.name = 'Nama area minimal 2 karakter';
        }
        const duplicateName = areas.find(
            a => a.name.toLowerCase() === formData.name.trim().toLowerCase() && 
                 (!editingArea || a.id !== editingArea.id)
        );
        if (duplicateName) errors.name = 'Nama area sudah ada';
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formData.name, areas, editingArea]);

    const openAddModal = () => {
        setEditingArea(null);
        setFormData({ name: '', description: '', rt: '', rw: '', kelurahan: '', kecamatan: '', latitude: '', longitude: '' });
        setFormErrors({});
        setError('');
        setShowModal(true);
    };

    const openEditModal = (area) => {
        setEditingArea(area);
        setFormData({ 
            name: area.name, description: area.description || '', rt: area.rt || '', rw: area.rw || '',
            kelurahan: area.kelurahan || '', kecamatan: area.kecamatan || '',
            latitude: area.latitude || '', longitude: area.longitude || '',
        });
        setFormErrors({});
        setError('');
        setShowModal(true);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
        if (formErrors[name]) setFormErrors({ ...formErrors, [name]: '' });
    };

    const handleLocationChange = (lat, lng) => {
        setFormData({ ...formData, latitude: lat, longitude: lng });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!validateForm()) return;
        setSubmitting(true);
        try {
            const result = editingArea
                ? await areaService.updateArea(editingArea.id, formData)
                : await areaService.createArea(formData);
            if (result.success) {
                setShowModal(false);
                loadAreas();
                success(editingArea ? 'Area Diperbarui' : 'Area Dibuat', `"${formData.name}" berhasil ${editingArea ? 'diperbarui' : 'dibuat'}.`);
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Terjadi kesalahan');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteConfirm) return;
        setDeleting(true);
        try {
            const result = await areaService.deleteArea(deleteConfirm.id);
            if (result.success) {
                setDeleteConfirm(null);
                loadAreas();
                success('Area Dihapus', `"${deleteConfirm.name}" berhasil dihapus.`);
            } else {
                showError('Gagal Menghapus', result.message);
            }
        } catch (err) {
            showError('Gagal Menghapus', err.response?.data?.message || 'Gagal menghapus area');
        } finally {
            setDeleting(false);
        }
    };

    const handleMapCenterChange = (lat, lng) => {
        setMapCenter({ ...mapCenter, latitude: parseFloat(lat), longitude: parseFloat(lng) });
    };

    const openBulkConfigModal = (area) => {
        const summary = areaSummaries.find((item) => item.areaId === area.id);
        setBulkConfigArea(area);
        setBulkConfig({
            ...defaultBulkConfig,
            targetFilter: summary?.externalUnresolved ? 'external_unresolved_only' : 'all',
            operation: summary?.externalUnresolved ? 'normalization' : 'policy_update',
        });
        setBulkPreview(null);
    };

    const buildBulkPayload = useCallback(() => {
        const payload = {};

        if (bulkConfig.operation === 'policy_update' || bulkConfig.operation === 'maintenance') {
            if (bulkConfig.delivery_type !== 'ignore') payload.delivery_type = bulkConfig.delivery_type;
            if (bulkConfig.external_use_proxy !== 'ignore') payload.external_use_proxy = parseInt(bulkConfig.external_use_proxy, 10);
            if (bulkConfig.enable_recording !== 'ignore') payload.enable_recording = parseInt(bulkConfig.enable_recording, 10);
            if (bulkConfig.enabled !== 'ignore') payload.enabled = parseInt(bulkConfig.enabled, 10);
            if (bulkConfig.external_tls_mode !== 'ignore') payload.external_tls_mode = bulkConfig.external_tls_mode;
            if (bulkConfig.external_origin_mode !== 'ignore') payload.external_origin_mode = bulkConfig.external_origin_mode;
            if (bulkConfig.video_codec !== 'ignore') payload.video_codec = bulkConfig.video_codec;
        }

        if (bulkConfig.operation === 'normalization') {
            if (bulkConfig.delivery_type !== 'ignore') payload.delivery_type = bulkConfig.delivery_type;
            if (bulkConfig.clear_internal_rtsp) payload.clear_internal_rtsp = true;
        }

        return payload;
    }, [bulkConfig]);

    const loadBulkPreview = useCallback(async () => {
        if (!bulkConfigArea) return;

        setBulkPreviewLoading(true);
        try {
            const payload = buildBulkPayload();
            const result = await cameraService.bulkUpdateByArea(bulkConfigArea.id, {
                targetFilter: bulkConfig.targetFilter,
                operation: bulkConfig.operation,
                payload,
                preview: true,
            });

            if (result.success) {
                setBulkPreview(result.data);
            } else {
                setBulkPreview(null);
                showError('Preview Gagal', result.message);
            }
        } catch (err) {
            setBulkPreview(null);
            showError('Preview Gagal', err.response?.data?.message || err.message);
        } finally {
            setBulkPreviewLoading(false);
        }
    }, [buildBulkPayload, bulkConfig.operation, bulkConfig.targetFilter, bulkConfigArea, showError]);

    const handleBulkUpdate = async () => {
        if (!bulkConfigArea) return;
        setApplyingBulk(true);
        try {
            const payload = buildBulkPayload();

            if (Object.keys(payload).length === 0) {
                setApplyingBulk(false);
                success('Info', 'Tidak ada perubahan yang dipilih.');
                return;
            }
            const result = await cameraService.bulkUpdateByArea(bulkConfigArea.id, {
                targetFilter: bulkConfig.targetFilter,
                operation: bulkConfig.operation,
                payload,
            });
            if (result.success) {
                setBulkConfigArea(null);
                setBulkPreview(null);
                loadAreas(); // refresh counts potentially
                const guidance = result.data?.guidance ? ` ${result.data.guidance}` : '';
                success('Pembaruan Massal Berhasil', `Berhasil memperbarui ${result.data?.changes || 0} kamera di area ${bulkConfigArea.name}.${guidance}`);
            } else {
                showError('Gagal', result.message);
            }
        } catch (err) {
            showError('Gagal Memperbarui Massal', err.response?.data?.message || err.message);
        } finally {
            setApplyingBulk(false);
        }
    };

    const handleBulkDelete = async () => {
        if (!bulkDeleteAreaConfirm) return;
        setApplyingBulkDelete(true);
        try {
            const result = await cameraService.bulkDeleteByArea(bulkDeleteAreaConfirm.id);
            if (result.success) {
                setBulkDeleteAreaConfirm(null);
                loadAreas();
                success('Berhasil', `Pemusnahan masal berhasil. Sebanyak ${result.data?.deletedCount || 0} kamera telah dihapus dari area ${bulkDeleteAreaConfirm.name}.`);
            } else {
                showError('Gagal', result.message);
            }
        } catch (err) {
            showError('Gagal Menghapus Kamera Massal', err.response?.data?.message || err.message);
        } finally {
            setApplyingBulkDelete(false);
        }
    };

    const saveMapCenter = async () => {
        setSavingMapCenter(true);
        try {
            await settingsService.updateMapCenter(mapCenter.latitude, mapCenter.longitude, mapCenter.zoom, mapCenter.name);
            success('Berhasil', 'Lokasi default peta berhasil disimpan');
            setShowMapCenterModal(false);
        } catch (err) {
            showError('Gagal', 'Gagal menyimpan lokasi default');
        } finally {
            setSavingMapCenter(false);
        }
    };

    const kecamatans = [...new Set(areas.map(a => a.kecamatan).filter(Boolean))].sort();
    const filteredAreas = filterKecamatan ? areas.filter(a => a.kecamatan === filterKecamatan) : areas;
    const areaSummaryMap = new Map(areaSummaries.map((item) => [item.areaId, item]));

    const getLocationString = (area) => {
        const parts = [];
        if (area.rt) parts.push(`RT ${area.rt}`);
        if (area.rw) parts.push(`RW ${area.rw}`);
        if (area.kelurahan) parts.push(area.kelurahan);
        if (area.kecamatan) parts.push(area.kecamatan);
        return parts.join(', ') || 'Belum ada detail lokasi';
    };

    if (loading) {
        return (
            <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, i) => <CameraCardSkeleton key={i} />)}
                </div>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="text-center py-20 bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
                <Alert type="error" title="Error" message={loadError} className="max-w-md mx-auto mb-6" />
                <button onClick={loadAreas} className="px-6 py-2.5 bg-primary hover:bg-primary-600 text-white font-medium rounded-xl">
                    Coba Lagi
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-primary mb-1">Manajemen Lokasi</p>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Area</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">Kelompokkan kamera berdasarkan RT, RW, Kelurahan, Kecamatan</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    <Link
                        to="/admin/backup-restore?scope=unresolved_only"
                        className="flex items-center gap-2 px-4 py-2.5 bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium rounded-xl hover:bg-amber-200 dark:hover:bg-amber-500/20 transition-colors"
                    >
                        Backup Restore
                    </Link>
                    {kecamatans.length > 0 && (
                        <select value={filterKecamatan} onChange={(e) => setFilterKecamatan(e.target.value)}
                            className="px-4 py-2.5 bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                            <option value="">Semua Kecamatan</option>
                            {kecamatans.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                    )}
                    <button onClick={() => setShowMapCenterModal(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
                        </svg>
                        Lokasi Default
                    </button>
                    <button onClick={openAddModal}
                        className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary to-primary-600 hover:from-primary-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-primary/25 transition-all">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        Tambah Area
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{areas.length}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Area</p>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{kecamatans.length}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Kecamatan</p>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {[...new Set(areas.map(a => a.kelurahan).filter(Boolean))].length}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Kelurahan</p>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {areas.reduce((sum, a) => sum + (a.camera_count || 0), 0)}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Kamera</p>
                </div>
            </div>

            {/* Areas Grid */}
            {filteredAreas.length === 0 ? (
                filterKecamatan ? (
                    <div className="text-center py-20 bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
                        <p className="text-gray-500 dark:text-gray-400 mb-4">Tidak ada area di kecamatan ini</p>
                        <button onClick={() => setFilterKecamatan('')} className="text-primary font-semibold hover:text-primary-600">
                            Hapus Filter →
                        </button>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
                        <NoAreasEmptyState onCreateArea={openAddModal} />
                    </div>
                )
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredAreas.map((area) => (
                        <div key={area.id} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-xl hover:border-primary/30 transition-all group">
                            {(() => {
                                const areaSummary = areaSummaryMap.get(area.id);
                                return (
                                    <>
                            <div className="flex justify-between items-start mb-4">
                                <div className="w-12 h-12 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/30 group-hover:scale-110 transition-transform">
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                        <circle cx="12" cy="11" r="3" />
                                    </svg>
                                </div>
                                <div className="flex gap-1">
                                    <button title="Pengaturan Massal Kamera" onClick={() => openBulkConfigModal(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-all">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </button>
                                    <Link
                                        title="Restore metadata kamera area ini"
                                        to={`/admin/backup-restore?areaId=${area.id}`}
                                        className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-primary hover:bg-sky-50 dark:hover:bg-primary/10 transition-all"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582M20 11A8 8 0 005.582 9M20 20v-5h-.581M4 13a8 8 0 0014.581 2" />
                                        </svg>
                                    </Link>
                                    <button title="Hapus Semua Kamera" onClick={() => setBulkDeleteAreaConfirm(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            <line x1="3" y1="3" x2="21" y2="21" strokeWidth={2} strokeLinecap="round" />
                                        </svg>
                                    </button>
                                    <button onClick={() => openEditModal(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-primary hover:bg-sky-50 dark:hover:bg-primary/10 transition-all">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                    <button onClick={() => setDeleteConfirm(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{area.name}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 mb-3">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                </svg>
                                {getLocationString(area)}
                            </p>
                            {area.latitude && area.longitude && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-3">✓ Koordinat tersedia</p>
                            )}
                            <div className="flex flex-wrap gap-2 mb-4">
                                {area.kecamatan && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-blue-100 dark:bg-primary/20 text-primary-600 dark:text-blue-400">{area.kecamatan}</span>}
                                {area.kelurahan && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">{area.kelurahan}</span>}
                                {areaSummary?.externalUnresolved > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">{areaSummary.externalUnresolved} unresolved</span>}
                                {areaSummary?.offline > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">{areaSummary.offline} offline</span>}
                            </div>
                            {areaSummary && (
                                <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
                                    <div className="rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                                        <div className="text-gray-500 dark:text-gray-400">Internal</div>
                                        <div className="font-semibold text-gray-900 dark:text-white">{areaSummary.internalValid}</div>
                                    </div>
                                    <div className="rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                                        <div className="text-gray-500 dark:text-gray-400">External</div>
                                        <div className="font-semibold text-gray-900 dark:text-white">{areaSummary.externalValid}</div>
                                    </div>
                                </div>
                            )}
                            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700/50">
                                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{area.camera_count || 0} Kamera</span>
                                <Link to="/admin/cameras" className="text-sm font-semibold text-primary hover:text-primary-600 flex items-center gap-1">
                                    Lihat <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </Link>
                            </div>
                                    </>
                                );
                            })()}
                        </div>
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700/50 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{editingArea ? 'Edit Area' : 'Tambah Area'}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Isi detail lokasi</p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-300">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            {error && <Alert type="error" message={error} dismissible onDismiss={() => setError('')} />}
                            
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nama Area *</label>
                                <input type="text" name="name" value={formData.name} onChange={handleChange}
                                    className={`w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary ${formErrors.name ? 'border-red-500' : 'border-gray-200 dark:border-gray-700/50'}`}
                                    placeholder="Contoh: Pos Kamling RT 01" />
                                {formErrors.name && <p className="mt-1.5 text-sm text-red-500">{formErrors.name}</p>}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">RT</label>
                                    <input type="text" name="rt" value={formData.rt} onChange={handleChange}
                                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="01" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">RW</label>
                                    <input type="text" name="rw" value={formData.rw} onChange={handleChange}
                                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="05" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Kelurahan</label>
                                    <input type="text" name="kelurahan" value={formData.kelurahan} onChange={handleChange}
                                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Nama kelurahan" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Kecamatan</label>
                                    <input type="text" name="kecamatan" value={formData.kecamatan} onChange={handleChange}
                                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Nama kecamatan" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Deskripsi</label>
                                <textarea name="description" value={formData.description} onChange={handleChange} rows="2"
                                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none" placeholder="Catatan opsional..." />
                            </div>

                            {/* Koordinat dengan LocationPicker */}
                            <div className="pt-4 border-t border-gray-200 dark:border-gray-700/50">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Koordinat Area (untuk Map View)</label>
                                <Suspense fallback={<div className="text-sm text-gray-600 dark:text-gray-300">Loading map...</div>}>
                                    <LocationPicker latitude={formData.latitude} longitude={formData.longitude} onLocationChange={handleLocationChange} />
                                </Suspense>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Koordinat digunakan untuk memindahkan peta saat filter area dipilih</p>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700" disabled={submitting}>Batal</button>
                                <button type="submit" className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-primary to-primary-600 text-white font-medium rounded-xl shadow-lg shadow-primary/30 hover:from-primary-600 hover:to-blue-700 disabled:opacity-50 flex items-center justify-center gap-2" disabled={submitting}>
                                    {submitting && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                                    {submitting ? 'Menyimpan...' : (editingArea ? 'Perbarui' : 'Simpan')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Bulk Config Modal */}
            {bulkConfigArea && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-3xl rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700/50 flex justify-between items-center bg-amber-50 dark:bg-amber-900/20 rounded-t-2xl shrink-0">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Bulk Policy Center</h3>
                                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">Area: {bulkConfigArea.name}</p>
                            </div>
                            <button onClick={() => setBulkConfigArea(null)} className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-800/30 text-gray-600 dark:text-gray-300">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                        </div>
                        <div className="p-6 grid lg:grid-cols-[1.1fr_0.9fr] gap-6 overflow-y-auto">
                            <div className="space-y-4">
                                <p className="text-sm text-gray-500 dark:text-gray-400">Gunakan bulk tools untuk policy massal, normalisasi unresolved, dan maintenance per area.</p>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Mode Operasi</label>
                                        <select
                                            value={bulkConfig.operation}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, operation: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="policy_update">Bulk Policy Update</option>
                                            <option value="normalization">Bulk Normalization</option>
                                            <option value="maintenance">Bulk Maintenance</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Target Kamera</label>
                                        <select
                                            value={bulkConfig.targetFilter}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, targetFilter: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="all">Semua Kamera Area</option>
                                            <option value="internal_only">Hanya Internal</option>
                                            <option value="external_only">Hanya External</option>
                                            <option value="external_unresolved_only">Hanya External Unresolved</option>
                                            <option value="online_only">Hanya Online</option>
                                            <option value="offline_only">Hanya Offline</option>
                                            <option value="recording_enabled_only">Hanya Recording Enabled</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Delivery Type</label>
                                        <select
                                            value={bulkConfig.delivery_type}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, delivery_type: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="external_hls">External HLS</option>
                                            <option value="external_mjpeg">External MJPEG</option>
                                            <option value="external_embed">External Embed</option>
                                            <option value="external_jsmpeg">External JSMpeg</option>
                                            <option value="external_custom_ws">Custom WebSocket</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Origin Mode</label>
                                        <select
                                            value={bulkConfig.external_origin_mode}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, external_origin_mode: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="direct">Direct</option>
                                            <option value="embed">Embed</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Gunakan Proxy Server</label>
                                        <select
                                            value={bulkConfig.external_use_proxy}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, external_use_proxy: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="1">Aktifkan</option>
                                            <option value="0">Matikan</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Mode TLS</label>
                                        <select
                                            value={bulkConfig.external_tls_mode}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, external_tls_mode: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="strict">Strict</option>
                                            <option value="insecure">Insecure</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Recording</label>
                                        <select
                                            value={bulkConfig.enable_recording}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, enable_recording: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="1">Aktifkan</option>
                                            <option value="0">Matikan</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Status Publik</label>
                                        <select
                                            value={bulkConfig.enabled}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, enabled: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="1">Aktifkan</option>
                                            <option value="0">Matikan</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Video Codec</label>
                                        <select
                                            value={bulkConfig.video_codec}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, video_codec: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="h264">H.264</option>
                                            <option value="h265">H.265</option>
                                        </select>
                                    </div>
                                </div>

                                <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                                    <input
                                        type="checkbox"
                                        checked={bulkConfig.clear_internal_rtsp}
                                        onChange={(e) => setBulkConfig({ ...bulkConfig, clear_internal_rtsp: e.target.checked })}
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <div>
                                        <div className="text-sm font-semibold text-gray-900 dark:text-white">Clear internal RTSP saat normalisasi</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">Dipakai untuk merapikan legacy row external yang masih menyimpan jejak konfigurasi internal.</div>
                                    </div>
                                </label>
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 p-4">
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                        <div>
                                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Preview Dampak</h4>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Lihat target kamera dan breakdown sebelum apply.</p>
                                        </div>
                                        <button
                                            onClick={loadBulkPreview}
                                            className="px-3 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50"
                                            disabled={bulkPreviewLoading}
                                        >
                                            {bulkPreviewLoading ? 'Memuat...' : 'Preview'}
                                        </button>
                                    </div>

                                    {bulkPreview ? (
                                        <div className="space-y-3 text-sm">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">Target</div>
                                                    <div className="font-semibold text-gray-900 dark:text-white">{bulkPreview.summary?.total || 0}</div>
                                                </div>
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">Unresolved</div>
                                                    <div className="font-semibold text-amber-600 dark:text-amber-300">{bulkPreview.summary?.unresolvedCount || 0}</div>
                                                </div>
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">Internal</div>
                                                    <div className="font-semibold text-gray-900 dark:text-white">{bulkPreview.summary?.internalCount || 0}</div>
                                                </div>
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">External</div>
                                                    <div className="font-semibold text-gray-900 dark:text-white">{bulkPreview.summary?.externalCount || 0}</div>
                                                </div>
                                            </div>
                                            <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-3 border border-gray-200 dark:border-gray-700">
                                                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Contoh Kamera Terdampak</div>
                                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                                    {(bulkPreview.summary?.examples || []).map((camera) => (
                                                        <div key={camera.id} className="flex items-center justify-between gap-3 text-xs">
                                                            <span className="text-gray-900 dark:text-white truncate">{camera.name}</span>
                                                            <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 shrink-0">
                                                                {camera.delivery_classification}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {bulkPreview.guidance && (
                                                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 px-3 py-3 text-amber-800 dark:text-amber-300">
                                                    {bulkPreview.guidance}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Belum ada preview. Klik Preview untuk melihat dampak target filter dan operasi.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3 p-6 shrink-0 border-t border-gray-200 dark:border-gray-700/50 bg-white dark:bg-gray-800 rounded-b-2xl">
                            <button onClick={() => setBulkConfigArea(null)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700" disabled={applyingBulk}>Batal</button>
                            <button onClick={handleBulkUpdate} className="flex-[2] px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/30" disabled={applyingBulk}>
                                {applyingBulk && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                                {applyingBulk ? 'Memproses...' : 'Terapkan Segera'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Map Center Settings Modal */}
            {showMapCenterModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700/50 flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Lokasi Default Peta</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Titik tengah saat &quot;Semua Lokasi&quot; dipilih</p>
                            </div>
                            <button onClick={() => setShowMapCenterModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-300">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nama Lokasi</label>
                                <input type="text" value={mapCenter.name} onChange={(e) => setMapCenter({...mapCenter, name: e.target.value})}
                                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="Contoh: Kabupaten Bojonegoro" />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Nama ini akan ditampilkan di filter &quot;Semua Lokasi&quot;</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Zoom Level</label>
                                <select value={mapCenter.zoom} onChange={(e) => setMapCenter({...mapCenter, zoom: parseInt(e.target.value)})}
                                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary">
                                    <option value={10}>10 - Kabupaten/Kota</option>
                                    <option value={11}>11 - Kecamatan Luas</option>
                                    <option value={12}>12 - Kecamatan</option>
                                    <option value={13}>13 - Kelurahan/Desa</option>
                                    <option value={14}>14 - Detail Desa</option>
                                    <option value={15}>15 - Jalan</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Pilih Titik Tengah</label>
                                <Suspense fallback={<div className="text-sm text-gray-600 dark:text-gray-300">Loading map...</div>}>
                                    <LocationPicker 
                                        latitude={mapCenter.latitude} 
                                        longitude={mapCenter.longitude} 
                                        onLocationChange={handleMapCenterChange}
                                    />
                                </Suspense>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowMapCenterModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700" disabled={savingMapCenter}>Batal</button>
                                <button onClick={saveMapCenter} className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-primary to-primary-600 text-white font-medium rounded-xl shadow-lg shadow-primary/30 hover:from-primary-600 hover:to-blue-700 disabled:opacity-50 flex items-center justify-center gap-2" disabled={savingMapCenter || !mapCenter.latitude || !mapCenter.longitude}>
                                    {savingMapCenter && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                                    {savingMapCenter ? 'Menyimpan...' : 'Simpan'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Delete Area Cameras Modal */}
            {bulkDeleteAreaConfirm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl border border-red-500/50">
                        <div className="p-6">
                            <div className="w-16 h-16 bg-red-100 dark:bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white dark:border-gray-800 -mt-12 shadow-lg">
                                <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">Hapus Semua Kamera?</h3>
                            <p className="text-gray-500 dark:text-gray-400 text-center mb-4">
                                Anda akan menghapus <span className="font-bold text-red-500 border-b border-red-500">{bulkDeleteAreaConfirm.camera_count || 0} kamera</span> dari area <span className="font-bold text-gray-900 dark:text-white">&quot;{bulkDeleteAreaConfirm.name}&quot;</span>.
                            </p>
                            <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl mb-2">
                                <p className="text-red-800 dark:text-red-400 text-xs font-semibold uppercase tracking-wider mb-1">PERINGATAN BAHAYA</p>
                                <p className="text-red-700 dark:text-red-300 text-sm">Tindakan ini permanen. Semua data streaming, proxy, rekaman, dan riwayat kamera akan musnah terbawa angin dan tidak bisa dikembalikan.</p>
                            </div>
                        </div>
                        <div className="flex gap-3 p-6 pt-0">
                            <button onClick={() => setBulkDeleteAreaConfirm(null)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" disabled={applyingBulkDelete}>BATALKAN</button>
                            <button onClick={handleBulkDelete} className="flex-[2] px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-red-500/30 transition-colors" disabled={applyingBulkDelete}>
                                {applyingBulkDelete && <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                                {applyingBulkDelete ? 'MENGHAPUS...' : 'YA, MUSNAHKAN'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50">
                        <div className="p-6">
                            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white text-center mb-2">Hapus Area</h3>
                            <p className="text-gray-500 dark:text-gray-400 text-center mb-4">
                                Yakin ingin menghapus <span className="font-semibold text-gray-900 dark:text-white">&quot;{deleteConfirm.name}&quot;</span>?
                            </p>
                            {deleteConfirm.camera_count > 0 && (
                                <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl mb-4">
                                    <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <p className="text-amber-800 dark:text-amber-400 text-sm">Area ini memiliki {deleteConfirm.camera_count} kamera. Menghapus area akan melepas kamera dari area ini.</p>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3 p-6 pt-0">
                            <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700" disabled={deleting}>Batal</button>
                            <button onClick={handleDelete} className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl flex items-center justify-center gap-2" disabled={deleting}>
                                {deleting && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                                {deleting ? 'Menghapus...' : 'Hapus'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
