/*
Purpose: Admin Area Management page for area CRUD, display settings, and area-level camera bulk actions.
Caller: React router admin pages.
Deps: area/camera/settings services, notification context, UI components, location picker.
MainFuncs: AreaManagement(), bulk preview/apply handlers, area form handlers.
SideEffects: Calls backend APIs, updates area/camera settings, shows notifications.
*/

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { areaService } from '../services/areaService';
import { cameraService } from '../services/cameraService';
import { settingsService } from '../services/settingsService';
import { useNotification } from '../contexts/NotificationContext';
import { StatCardSkeleton, CameraCardSkeleton, NoAreasEmptyState, Alert } from '../components/ui';
import lazyWithRetry from '../utils/lazyWithRetry';
import { AREA_COVERAGE_OPTIONS, getAreaCoverageLabel, resolveAreaFocusZoom } from '../utils/areaCoverage';

// Lazy load LocationPicker to avoid conflicts with CameraManagement
const LocationPicker = lazyWithRetry(() => import('../components/LocationPicker'), 'location-picker');

const defaultBulkConfig = {
    targetFilter: 'all',
    operation: 'policy_update',
    delivery_type: 'ignore',
    external_health_mode: 'ignore',
    external_use_proxy: 'ignore',
    enable_recording: 'ignore',
    enabled: 'ignore',
    external_tls_mode: 'ignore',
    external_origin_mode: 'ignore',
    video_codec: 'ignore',
    clear_internal_rtsp: false,
};

const AREA_HEALTH_MODE_OPTIONS = [
    { value: 'default', label: 'Ikuti Global Default' },
    { value: 'passive_first', label: 'Passive First' },
    { value: 'hybrid_probe', label: 'Hybrid Probe' },
    { value: 'probe_first', label: 'Probe First' },
    { value: 'disabled', label: 'Disabled' },
];

const GRID_DEFAULT_LIMIT_OPTIONS = [
    { value: '6', label: '6 kamera' },
    { value: '10', label: '10 kamera' },
    { value: '12', label: '12 kamera' },
    { value: '15', label: '15 kamera' },
    { value: '20', label: '20 kamera' },
    { value: '30', label: '30 kamera' },
    { value: '', label: 'Tanpa batas' },
];

const INTERNAL_INGEST_POLICY_OPTIONS = [
    { value: 'default', label: 'Ikuti Default Sistem' },
    { value: 'always_on', label: 'Always On' },
    { value: 'on_demand', label: 'On-Demand' },
];

function requiresExternalHlsTarget(config) {
    if (config.operation !== 'policy_update' && config.operation !== 'maintenance') {
        return false;
    }

    return config.external_use_proxy !== 'ignore'
        || config.external_tls_mode !== 'ignore'
        || config.external_origin_mode !== 'ignore';
}

function requiresExternalStreamsTarget(config) {
    if (config.operation !== 'policy_update' && config.operation !== 'maintenance') {
        return false;
    }

    return config.external_health_mode !== 'ignore';
}

function getEffectiveTargetFilter(config) {
    if (requiresExternalHlsTarget(config)) {
        return 'external_hls_only';
    }
    if (requiresExternalStreamsTarget(config)) {
        return 'external_streams_only';
    }
    return config.targetFilter || 'all';
}

function getBulkFilterLabel(targetFilter) {
    switch (targetFilter) {
        case 'internal_only':
            return 'Hanya Internal';
        case 'external_only':
            return 'Hanya External';
        case 'external_streams_only':
            return 'Hanya External Valid';
        case 'external_hls_only':
            return 'Hanya External HLS';
        case 'external_mjpeg_only':
            return 'Hanya External MJPEG';
        case 'external_probeable_only':
            return 'Hanya External Probeable';
        case 'external_passive_only':
            return 'Hanya External Passive';
        case 'external_unresolved_only':
            return 'Hanya External Unresolved';
        case 'online_only':
            return 'Hanya Online';
        case 'offline_only':
            return 'Hanya Offline';
        case 'recording_enabled_only':
            return 'Hanya Recording Enabled';
        default:
            return 'Semua Kamera Area';
    }
}

export default function AreaManagement() {
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingArea, setEditingArea] = useState(null);
    const [formData, setFormData] = useState({ 
        name: '', description: '', rt: '', rw: '', kelurahan: '', kecamatan: '', latitude: '', longitude: '', external_health_mode_override: 'default', coverage_scope: 'default', viewport_zoom_override: '', show_on_grid_default: true, grid_default_camera_limit: '12', internal_ingest_policy_default: 'default', internal_on_demand_close_after_seconds: ''
    });
    const [formErrors, setFormErrors] = useState({});
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [filterKecamatan, setFilterKecamatan] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [togglingGridAreaId, setTogglingGridAreaId] = useState(null);
    
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
    const loadRequestRef = useRef(0);
    const hasLoadedAreasRef = useRef(false);

    const loadAreas = useCallback(async () => {
        const requestId = ++loadRequestRef.current;
        try {
            if (!hasLoadedAreasRef.current) {
                setLoading(true);
                setLoadError(null);
            }
            const overviewResponse = await areaService.getAdminOverview();
            if (requestId !== loadRequestRef.current) {
                return;
            }
            if (overviewResponse.success) {
                setAreas(overviewResponse.data);
                hasLoadedAreasRef.current = true;
                setLoadError(null);
            }
        } catch (err) {
            console.error('Load areas error:', err);
            if (!hasLoadedAreasRef.current) {
                setLoadError('Gagal memuat data area.');
            } else if (requestId === loadRequestRef.current) {
                showError('Sinkronisasi Area Gagal', 'Menampilkan data area terakhir yang berhasil dimuat.');
            }
        } finally {
            if (requestId === loadRequestRef.current) {
                setLoading(false);
            }
        }
    }, [showError]);

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
        setFormData({ name: '', description: '', rt: '', rw: '', kelurahan: '', kecamatan: '', latitude: '', longitude: '', external_health_mode_override: 'default', coverage_scope: 'default', viewport_zoom_override: '', show_on_grid_default: true, grid_default_camera_limit: '12', internal_ingest_policy_default: 'default', internal_on_demand_close_after_seconds: '' });
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
            external_health_mode_override: area.external_health_mode_override || 'default',
            coverage_scope: area.coverage_scope || 'default',
            viewport_zoom_override: area.viewport_zoom_override || '',
            show_on_grid_default: area.show_on_grid_default === 1 || area.show_on_grid_default === true,
            grid_default_camera_limit: area.grid_default_camera_limit === null || area.grid_default_camera_limit === undefined ? '' : String(area.grid_default_camera_limit),
            internal_ingest_policy_default: area.internal_ingest_policy_default || 'default',
            internal_on_demand_close_after_seconds: area.internal_on_demand_close_after_seconds === null || area.internal_on_demand_close_after_seconds === undefined ? '' : String(area.internal_on_demand_close_after_seconds),
        });
        setFormErrors({});
        setError('');
        setShowModal(true);
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
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

    const handleToggleGridDefault = async (area) => {
        const nextValue = !(area.show_on_grid_default === 1 || area.show_on_grid_default === true);
        setTogglingGridAreaId(area.id);
        try {
            const payload = {
                name: area.name,
                description: area.description || '',
                rt: area.rt || '',
                rw: area.rw || '',
                kelurahan: area.kelurahan || '',
                kecamatan: area.kecamatan || '',
                latitude: area.latitude || '',
                longitude: area.longitude || '',
                external_health_mode_override: area.external_health_mode_override || 'default',
                coverage_scope: area.coverage_scope || 'default',
                viewport_zoom_override: area.viewport_zoom_override || '',
                show_on_grid_default: nextValue,
                grid_default_camera_limit: area.grid_default_camera_limit === null || area.grid_default_camera_limit === undefined ? '' : area.grid_default_camera_limit,
                internal_ingest_policy_default: area.internal_ingest_policy_default || 'default',
                internal_on_demand_close_after_seconds: area.internal_on_demand_close_after_seconds === null || area.internal_on_demand_close_after_seconds === undefined ? '' : area.internal_on_demand_close_after_seconds,
            };
            const result = await areaService.updateArea(area.id, payload);
            if (result.success) {
                setAreas((currentAreas) => currentAreas.map((currentArea) => (
                    currentArea.id === area.id
                        ? { ...currentArea, show_on_grid_default: nextValue ? 1 : 0 }
                        : currentArea
                )));
                success(
                    'Grid Default Diperbarui',
                    `Area "${area.name}" sekarang ${nextValue ? 'ditampilkan' : 'disembunyikan'} pada Grid View default.`
                );
                loadAreas();
            } else {
                showError('Gagal Memperbarui Grid Default', result.message);
            }
        } catch (err) {
            showError('Gagal Memperbarui Grid Default', err.response?.data?.message || 'Terjadi kesalahan saat menyimpan area.');
        } finally {
            setTogglingGridAreaId(null);
        }
    };

    const handleMapCenterChange = (lat, lng) => {
        setMapCenter({ ...mapCenter, latitude: parseFloat(lat), longitude: parseFloat(lng) });
    };

    const openBulkConfigModal = (area) => {
        setBulkConfigArea(area);
        setBulkConfig({
            ...defaultBulkConfig,
            targetFilter: area.externalUnresolvedCount > 0 ? 'external_unresolved_only' : 'all',
            operation: area.externalUnresolvedCount > 0 ? 'normalization' : 'policy_update',
        });
        setBulkPreview(null);
    };

    const buildBulkPayload = useCallback(() => {
        const payload = {};

        if (bulkConfig.operation === 'policy_update' || bulkConfig.operation === 'maintenance') {
            if (bulkConfig.delivery_type !== 'ignore') payload.delivery_type = bulkConfig.delivery_type;
            if (bulkConfig.external_health_mode !== 'ignore') payload.external_health_mode = bulkConfig.external_health_mode;
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
                targetFilter: getEffectiveTargetFilter(bulkConfig),
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
    }, [buildBulkPayload, bulkConfig, bulkConfigArea, showError]);

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
                targetFilter: getEffectiveTargetFilter(bulkConfig),
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
    const effectiveBulkTargetFilter = useMemo(() => getEffectiveTargetFilter(bulkConfig), [bulkConfig]);
    const gridDefaultEnabledAreaCount = useMemo(
        () => areas.filter((area) => area.show_on_grid_default === 1 || area.show_on_grid_default === true).length,
        [areas]
    );
    const gridDefaultCameraCount = useMemo(
        () => areas.reduce((sum, area) => ((area.show_on_grid_default === 1 || area.show_on_grid_default === true) ? sum + (area.cameraCount || 0) : sum), 0),
        [areas]
    );

    const handleGridDefaultLimitChange = async (area, nextLimit) => {
        setTogglingGridAreaId(area.id);
        try {
            const payload = {
                name: area.name,
                description: area.description || '',
                rt: area.rt || '',
                rw: area.rw || '',
                kelurahan: area.kelurahan || '',
                kecamatan: area.kecamatan || '',
                latitude: area.latitude || '',
                longitude: area.longitude || '',
                external_health_mode_override: area.external_health_mode_override || 'default',
                coverage_scope: area.coverage_scope || 'default',
                viewport_zoom_override: area.viewport_zoom_override || '',
                show_on_grid_default: area.show_on_grid_default === 1 || area.show_on_grid_default === true,
                grid_default_camera_limit: nextLimit,
                internal_ingest_policy_default: area.internal_ingest_policy_default || 'default',
                internal_on_demand_close_after_seconds: area.internal_on_demand_close_after_seconds === null || area.internal_on_demand_close_after_seconds === undefined ? '' : area.internal_on_demand_close_after_seconds,
            };
            const result = await areaService.updateArea(area.id, payload);
            if (result.success) {
                setAreas((currentAreas) => currentAreas.map((currentArea) => (
                    currentArea.id === area.id
                        ? { ...currentArea, grid_default_camera_limit: nextLimit === '' ? null : parseInt(nextLimit, 10) }
                        : currentArea
                )));
                success(
                    'Limit Grid Default Diperbarui',
                    `Area "${area.name}" sekarang memakai limit ${nextLimit === '' ? 'tanpa batas' : `${nextLimit} kamera`} pada Grid View default.`
                );
                loadAreas();
            } else {
                showError('Gagal Memperbarui Limit Grid Default', result.message);
            }
        } catch (err) {
            showError('Gagal Memperbarui Limit Grid Default', err.response?.data?.message || 'Terjadi kesalahan saat menyimpan limit area.');
        } finally {
            setTogglingGridAreaId(null);
        }
    };

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
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-4 shadow-sm">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{areas.length}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Area</p>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-4 shadow-sm">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{kecamatans.length}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Kecamatan</p>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-4 shadow-sm">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {[...new Set(areas.map(a => a.kelurahan).filter(Boolean))].length}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Kelurahan</p>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-4 shadow-sm">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {areas.reduce((sum, a) => sum + (a.cameraCount || 0), 0)}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Kamera</p>
                </div>
            </div>

            <div className="rounded-[26px] border border-sky-200/70 dark:border-sky-500/20 bg-[linear-gradient(135deg,rgba(14,165,233,0.09),rgba(59,130,246,0.03))] px-5 py-4 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-sm font-semibold text-sky-800 dark:text-sky-200">Grid View Default</p>
                        <p className="text-sm text-sky-700/90 dark:text-sky-100/80">
                            Saat filter masih di semua area, grid hanya memuat area yang ditandai aktif di sini. Jika user memilih area tertentu, area itu tetap tampil penuh.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm md:min-w-[240px]">
                        <div className="rounded-2xl border border-sky-200/60 bg-white/70 px-4 py-3 text-center dark:border-sky-500/10 dark:bg-slate-900/40">
                            <div className="font-bold text-sky-900 dark:text-white">{gridDefaultEnabledAreaCount}</div>
                            <div className="text-sky-700/80 dark:text-sky-100/70">Area aktif</div>
                        </div>
                        <div className="rounded-2xl border border-sky-200/60 bg-white/70 px-4 py-3 text-center dark:border-sky-500/10 dark:bg-slate-900/40">
                            <div className="font-bold text-sky-900 dark:text-white">{gridDefaultCameraCount}</div>
                            <div className="text-sky-700/80 dark:text-sky-100/70">Kamera default</div>
                        </div>
                    </div>
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
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredAreas.map((area) => (
                        <div key={area.id} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-[26px] p-5 hover:shadow-xl hover:border-primary/30 transition-all group shadow-sm">
                            <div className="flex justify-between items-start mb-4">
                                <div className="w-12 h-12 bg-gradient-to-br from-primary-400 to-primary-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-primary/30 group-hover:scale-110 transition-transform">
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                        <circle cx="12" cy="11" r="3" />
                                    </svg>
                                </div>
                                <div className="flex flex-wrap justify-end gap-1.5">
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
                            <h3 className="text-[1.7rem] leading-tight font-bold text-gray-900 dark:text-white mb-2">{area.name}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 mb-3">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                </svg>
                                {getLocationString(area)}
                            </p>
                            {area.latitude && area.longitude && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-3">Koordinat tersedia</p>
                            )}
                            <div className="flex flex-wrap gap-2 mb-4">
                                {area.kecamatan && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-blue-100 dark:bg-primary/20 text-primary-600 dark:text-blue-400">{area.kecamatan}</span>}
                                {area.kelurahan && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">{area.kelurahan}</span>}
                                <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-200">
                                    {getAreaCoverageLabel(area.coverage_scope)}
                                </span>
                                {(area.show_on_grid_default === 1 || area.show_on_grid_default === true) ? (
                                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300">
                                        Grid Default On
                                    </span>
                                ) : (
                                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300">
                                        Grid Default Off
                                    </span>
                                )}
                                {area.externalUnresolvedCount > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">{area.externalUnresolvedCount} unresolved</span>}
                                {area.degradedCount > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300">{area.degradedCount} degraded</span>}
                                {area.offlineCount > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">{area.offlineCount} offline</span>}
                                {area.maintenanceCount > 0 && <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-200 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200">{area.maintenanceCount} maintenance</span>}
                            </div>
                            <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                                <div className="rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                                    <div className="text-gray-500 dark:text-gray-400">Kamera</div>
                                    <div className="font-semibold text-gray-900 dark:text-white">{area.cameraCount || 0}</div>
                                </div>
                                <div className="rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                                    <div className="text-gray-500 dark:text-gray-400">Online</div>
                                    <div className="font-semibold text-emerald-700 dark:text-emerald-300">{area.onlineCount || 0}</div>
                                </div>
                                <div className="rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                                    <div className="text-gray-500 dark:text-gray-400">Offline</div>
                                    <div className="font-semibold text-red-700 dark:text-red-300">{area.offlineCount || 0}</div>
                                </div>
                            </div>
                            <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-gray-50/80 dark:bg-gray-900/40 px-4 py-3 mb-4">
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                                    <div className="text-gray-500 dark:text-gray-400">Health Default Area</div>
                                    <div className="text-right font-semibold text-gray-900 dark:text-white">{area.external_health_mode_override || 'default'}</div>
                                    <div className="text-gray-500 dark:text-gray-400">Dominant External Mode</div>
                                    <div className="text-right font-semibold text-sky-700 dark:text-sky-300">{area.dominantExternalHealthMode || 'default'}</div>
                                    <div className="text-gray-500 dark:text-gray-400">Passive Monitored</div>
                                    <div className="text-right font-semibold text-emerald-700 dark:text-emerald-300">{area.passiveMonitoredCount || 0}</div>
                                    <div className="text-gray-500 dark:text-gray-400">Coverage Area</div>
                                    <div className="text-right font-semibold text-gray-900 dark:text-white">{getAreaCoverageLabel(area.coverage_scope)}</div>
                                    <div className="text-gray-500 dark:text-gray-400">Focus Zoom</div>
                                    <div className="text-right font-semibold text-indigo-700 dark:text-indigo-300">{resolveAreaFocusZoom(area.coverage_scope, area.viewport_zoom_override, 15)}</div>
                                    <div className="text-gray-500 dark:text-gray-400">Grid Default</div>
                                    <div className="text-right font-semibold text-gray-900 dark:text-white">{(area.show_on_grid_default === 1 || area.show_on_grid_default === true) ? 'Enabled' : 'Hidden'}</div>
                                    <div className="text-gray-500 dark:text-gray-400">Limit Grid</div>
                                    <div className="text-right font-semibold text-gray-900 dark:text-white">{area.grid_default_camera_limit ? `${area.grid_default_camera_limit} kamera` : 'Tanpa batas'}</div>
                                    <div className="text-gray-500 dark:text-gray-400">Internal RTSP Policy</div>
                                    <div className="text-right font-semibold text-gray-900 dark:text-white">{INTERNAL_INGEST_POLICY_OPTIONS.find((option) => option.value === (area.internal_ingest_policy_default || 'default'))?.label || 'Ikuti Default Sistem'}</div>
                                    <div className="text-gray-500 dark:text-gray-400">Idle Close</div>
                                    <div className="text-right font-semibold text-gray-900 dark:text-white">{area.internal_on_demand_close_after_seconds ? `${area.internal_on_demand_close_after_seconds} detik` : 'Ikuti default'}</div>
                                </div>
                            </div>
                            <div className="mb-4 grid gap-3">
                                <button
                                    type="button"
                                    onClick={() => handleToggleGridDefault(area)}
                                    disabled={togglingGridAreaId === area.id}
                                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                                    (area.show_on_grid_default === 1 || area.show_on_grid_default === true)
                                        ? 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100 dark:hover:bg-sky-500/20'
                                        : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100 dark:border-gray-700/60 dark:bg-gray-900/40 dark:text-gray-100 dark:hover:bg-gray-800/70'
                                    } ${togglingGridAreaId === area.id ? 'cursor-wait opacity-70' : ''}`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <div className="text-sm font-semibold">
                                                {togglingGridAreaId === area.id
                                                    ? 'Menyimpan...'
                                                    : ((area.show_on_grid_default === 1 || area.show_on_grid_default === true)
                                                        ? 'Grid Default Aktif'
                                                        : 'Grid Default Nonaktif')}
                                            </div>
                                            <div className="mt-1 text-xs opacity-80">
                                                Toggle cepat untuk menentukan apakah area ini ikut dimuat saat Grid View masih di semua area.
                                            </div>
                                        </div>
                                        <span className={`inline-flex h-7 w-12 items-center rounded-full px-1 transition-colors ${
                                            (area.show_on_grid_default === 1 || area.show_on_grid_default === true)
                                                ? 'bg-sky-500'
                                                : 'bg-gray-300 dark:bg-gray-600'
                                        }`}>
                                            <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                                (area.show_on_grid_default === 1 || area.show_on_grid_default === true) ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                        </span>
                                    </div>
                                </button>
                                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700/50 dark:bg-gray-900/40">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <div className="text-sm font-semibold text-gray-900 dark:text-white">Limit Kamera Grid Default</div>
                                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                Berlaku hanya saat Grid View masih di semua area. Saat area dipilih manual, semua kamera area tetap tampil.
                                            </div>
                                        </div>
                                        <select
                                            aria-label={`Limit Grid ${area.name}`}
                                            value={area.grid_default_camera_limit === null || area.grid_default_camera_limit === undefined ? '' : String(area.grid_default_camera_limit)}
                                            onChange={(event) => handleGridDefaultLimitChange(area, event.target.value)}
                                            disabled={togglingGridAreaId === area.id}
                                            className="min-w-[140px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                                        >
                                            {GRID_DEFAULT_LIMIT_OPTIONS.map((option) => (
                                                <option key={option.value || 'unlimited'} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700/50">
                                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{area.internalValidCount || 0} Internal • {area.externalValidCount || 0} External</span>
                                <div className="flex items-center gap-3">
                                    <Link to={`/admin/import-export?area=${encodeURIComponent(area.name)}`} className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
                                        Import
                                    </Link>
                                    <Link to="/admin/cameras" className="text-sm font-semibold text-primary hover:text-primary-600 flex items-center gap-1">
                                        Lihat <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                    </Link>
                                </div>
                            </div>
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

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Default Health Monitoring External</label>
                                <select
                                    name="external_health_mode_override"
                                    value={formData.external_health_mode_override}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                >
                                    {AREA_HEALTH_MODE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                    Override ini menjadi default steady-state untuk kamera external di area ini. Kamera dengan override sendiri tetap menang.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Coverage Area</label>
                                    <select
                                        name="coverage_scope"
                                        value={formData.coverage_scope}
                                        onChange={handleChange}
                                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                    >
                                        {AREA_COVERAGE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        Menjelaskan skala area ini, misalnya titik kecil, kelurahan, kecamatan, atau kabupaten/kota.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Override Focus Zoom</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="20"
                                        name="viewport_zoom_override"
                                        value={formData.viewport_zoom_override}
                                        onChange={handleChange}
                                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder="Kosongkan untuk auto"
                                    />
                                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        Jika diisi, zoom ini akan dipakai saat area difokuskan di map view.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 dark:border-sky-500/20 dark:bg-sky-500/10">
                                <label className="flex items-start gap-3">
                                    <input
                                        type="checkbox"
                                        name="show_on_grid_default"
                                        checked={Boolean(formData.show_on_grid_default)}
                                        onChange={handleChange}
                                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <span>
                                        <span className="block text-sm font-medium text-gray-900 dark:text-white">Tampilkan di Grid Default</span>
                                        <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                                            Saat Grid View masih di &quot;Semua Lokasi&quot;, hanya area yang dicentang di sini yang dimuat default. Jika user memilih area tertentu, area itu tetap tampil walau opsi ini dimatikan.
                                        </span>
                                    </span>
                                </label>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Limit Kamera di Grid Default</label>
                                <select
                                    name="grid_default_camera_limit"
                                    value={formData.grid_default_camera_limit}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                >
                                    {GRID_DEFAULT_LIMIT_OPTIONS.map((option) => (
                                        <option key={`form-${option.value || 'unlimited'}`} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                    Untuk area padat, batasi jumlah kamera default seperti 10 atau 15 agar Grid View tetap ringan. Saat user memilih area tertentu, limit ini diabaikan.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                                <div className="mb-3">
                                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Internal RTSP / MediaMTX Policy</h4>
                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                        Default area ini hanya dipakai oleh kamera internal yang tidak punya override sendiri di form kamera.
                                    </p>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Default Ingest Mode</label>
                                        <select
                                            name="internal_ingest_policy_default"
                                            value={formData.internal_ingest_policy_default}
                                            onChange={handleChange}
                                            className="w-full px-4 py-2.5 bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        >
                                            {INTERNAL_INGEST_POLICY_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Idle Close Timeout (detik)</label>
                                        <input
                                            type="number"
                                            min="5"
                                            max="300"
                                            name="internal_on_demand_close_after_seconds"
                                            value={formData.internal_on_demand_close_after_seconds}
                                            onChange={handleChange}
                                            className="w-full px-4 py-2.5 bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                            placeholder="Kosong = ikuti default"
                                        />
                                    </div>
                                </div>
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
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, operation: e.target.value }))}
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
                                            value={effectiveBulkTargetFilter}
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, targetFilter: e.target.value }))}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="all">Semua Kamera Area</option>
                                            <option value="internal_only">Hanya Internal</option>
                                            <option value="external_only">Hanya External</option>
                                            <option value="external_streams_only">Hanya External Valid</option>
                                            <option value="external_hls_only">Hanya External HLS</option>
                                            <option value="external_mjpeg_only">Hanya External MJPEG</option>
                                            <option value="external_probeable_only">Hanya External Probeable</option>
                                            <option value="external_passive_only">Hanya External Passive</option>
                                            <option value="external_unresolved_only">Hanya External Unresolved</option>
                                            <option value="online_only">Hanya Online</option>
                                            <option value="offline_only">Hanya Offline</option>
                                            <option value="recording_enabled_only">Hanya Recording Enabled</option>
                                        </select>
                                        {requiresExternalHlsTarget(bulkConfig) && (
                                            <p className="text-xs text-amber-700 dark:text-amber-300">
                                                Proxy, TLS, dan origin policy otomatis dikunci ke target External HLS.
                                            </p>
                                        )}
                                        {requiresExternalStreamsTarget(bulkConfig) && !requiresExternalHlsTarget(bulkConfig) && (
                                            <p className="text-xs text-sky-700 dark:text-sky-300">
                                                Health monitoring policy otomatis dikunci ke target External Valid.
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Health Monitoring</label>
                                        <select
                                            aria-label="Health Monitoring"
                                            value={bulkConfig.external_health_mode}
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, external_health_mode: e.target.value }))}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="default">Ikuti Default Area/Global</option>
                                            <option value="passive_first">Passive First</option>
                                            <option value="hybrid_probe">Hybrid Probe</option>
                                            <option value="probe_first">Probe First</option>
                                            <option value="disabled">Disabled</option>
                                        </select>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Berlaku untuk kamera external valid; kamera internal atau metadata belum lengkap akan dilewati oleh preview.
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <label className="text-sm font-semibold text-gray-900 dark:text-white">Delivery Type</label>
                                        <select
                                            value={bulkConfig.delivery_type}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, delivery_type: e.target.value })}
                                            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                            <option value="external_hls">External HLS</option>
                            <option value="external_flv">External FLV</option>
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
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, external_origin_mode: e.target.value }))}
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
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, external_use_proxy: e.target.value }))}
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
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, external_tls_mode: e.target.value }))}
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
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Matikan aman untuk semua tipe kamera; aktifkan recording tetap diproteksi untuk kamera internal.
                                        </p>
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
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Matikan menyembunyikan semua kamera terpilih dari publik tanpa bergantung pada tipe delivery.
                                        </p>
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
                                            <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-3 border border-gray-200 dark:border-gray-700">
                                                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Target Aktif</div>
                                                <div className="font-semibold text-gray-900 dark:text-white">{getBulkFilterLabel(bulkPreview.targetFilter || effectiveBulkTargetFilter)}</div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">Total Area</div>
                                                    <div className="font-semibold text-gray-900 dark:text-white">{bulkPreview.summary?.totalInArea || 0}</div>
                                                </div>
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">Matched Filter</div>
                                                    <div className="font-semibold text-gray-900 dark:text-white">{bulkPreview.summary?.matchedCount || 0}</div>
                                                </div>
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">Eligible</div>
                                                    <div className="font-semibold text-emerald-600 dark:text-emerald-300">{bulkPreview.summary?.eligibleCount || 0}</div>
                                                </div>
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">Blocked</div>
                                                    <div className="font-semibold text-red-600 dark:text-red-300">{bulkPreview.summary?.blockedCount || 0}</div>
                                                </div>
                                            </div>
                                    <div className="grid grid-cols-2 gap-3">
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">Unresolved</div>
                                                    <div className="font-semibold text-amber-600 dark:text-amber-300">{bulkPreview.summary?.unresolvedCount || 0}</div>
                                                </div>
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-2 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-gray-500 dark:text-gray-400 text-xs">Recording Enabled</div>
                                                    <div className="font-semibold text-gray-900 dark:text-white">{bulkPreview.summary?.recordingEnabledCount || 0}</div>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-3 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Delivery Mix</div>
                                                    <div className="space-y-2">
                                                        {(bulkPreview.summary?.deliveryTypeBreakdown || []).slice(0, 5).map((item) => (
                                                            <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
                                                                <span className="text-gray-700 dark:text-gray-300">{item.key}</span>
                                                                <span className="px-2 py-1 rounded-full bg-sky-100 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300">{item.count}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-3 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Current Health Modes</div>
                                                    <div className="space-y-2">
                                                        {(bulkPreview.summary?.externalHealthModeBreakdown || []).slice(0, 5).map((item) => (
                                                            <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
                                                                <span className="text-gray-700 dark:text-gray-300">{item.key}</span>
                                                                <span className="px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{item.count}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            {(bulkPreview.summary?.blockedReasons || []).length > 0 && (
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-3 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Blocked Reasons</div>
                                                    <div className="space-y-2">
                                                        {bulkPreview.summary.blockedReasons.map((item) => (
                                                            <div key={item.reason} className="flex items-center justify-between gap-3 text-xs">
                                                                <span className="text-gray-700 dark:text-gray-300">{item.reason}</span>
                                                                <span className="px-2 py-1 rounded-full bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300 shrink-0">{item.count}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
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
                                            {(bulkPreview.summary?.blockedExamples || []).length > 0 && (
                                                <div className="rounded-xl bg-white dark:bg-gray-800 px-3 py-3 border border-gray-200 dark:border-gray-700">
                                                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Contoh Kamera Tidak Eligible</div>
                                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                                        {(bulkPreview.summary?.blockedExamples || []).map((camera) => (
                                                            <div key={camera.id} className="flex items-center justify-between gap-3 text-xs">
                                                                <div className="min-w-0">
                                                                    <div className="text-gray-900 dark:text-white truncate">{camera.name}</div>
                                                                    <div className="text-gray-500 dark:text-gray-400 truncate">{camera.reason}</div>
                                                                </div>
                                                                <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 shrink-0">
                                                                    {camera.delivery_classification}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
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
                                Anda akan menghapus <span className="font-bold text-red-500 border-b border-red-500">{bulkDeleteAreaConfirm.cameraCount || 0} kamera</span> dari area <span className="font-bold text-gray-900 dark:text-white">&quot;{bulkDeleteAreaConfirm.name}&quot;</span>.
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
                            {deleteConfirm.cameraCount > 0 && (
                                <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl mb-4">
                                    <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <p className="text-amber-800 dark:text-amber-400 text-sm">Area ini memiliki {deleteConfirm.cameraCount} kamera. Menghapus area akan melepas kamera dari area ini.</p>
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
