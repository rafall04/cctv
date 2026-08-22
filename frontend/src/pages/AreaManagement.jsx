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
import { StatCardSkeleton, CameraCardSkeleton, NoAreasEmptyState, Alert, Button, Field, Modal } from '../components/ui';
import { useFocusTrap } from '../hooks/useFocusTrap';
import AreaCard from '../components/admin/areas/AreaCard';
import AreaFormModal from '../components/admin/areas/AreaFormModal';
import BulkPolicyPreview from '../components/admin/areas/BulkPolicyPreview';
import lazyWithRetry from '../utils/lazyWithRetry';
import { useAreaFormState } from '../hooks/admin/useAreaFormState';
import { buildBulkPayload, defaultBulkConfig, getEffectiveTargetFilter, requiresExternalHlsTarget, requiresExternalStreamsTarget } from '../utils/admin/areaBulkPolicy';

// Lazy load LocationPicker to avoid conflicts with CameraManagement
const LocationPicker = lazyWithRetry(() => import('../components/LocationPicker'), 'location-picker');

export default function AreaManagement() {
    const bulkDialogRef = useRef(null);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
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
    // Declared here, not at the top: the trap reads bulkConfigArea, so it must come after it.
    useFocusTrap(bulkDialogRef, { active: Boolean(bulkConfigArea), onEscape: () => setBulkConfigArea(null) });
    const [bulkConfig, setBulkConfig] = useState(defaultBulkConfig);
    const [bulkPreview, setBulkPreview] = useState(null);
    const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
    const [applyingBulk, setApplyingBulk] = useState(false);

    const [bulkDeleteAreaConfirm, setBulkDeleteAreaConfirm] = useState(null);
    const [applyingBulkDelete, setApplyingBulkDelete] = useState(false);

    const { success, error: showError } = useNotification();
    const loadRequestRef = useRef(0);
    const hasLoadedAreasRef = useRef(false);
    const {
        showModal,
        setShowModal,
        editingArea,
        formData,
        formErrors,
        error,
        setError,
        submitting,
        setSubmitting,
        validateForm,
        openAddModal,
        openEditModal,
        handleChange,
        handleLocationChange,
    } = useAreaFormState({ areas });

    const loadAreas = useCallback(async () => {
        const requestId = ++loadRequestRef.current;
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
        } else if (!hasLoadedAreasRef.current) {
            // First load failed — show the blocking error state.
            setLoadError(overviewResponse.message || 'Gagal memuat data area.');
        } else {
            // Background refresh failed — keep the last good data, just warn.
            showError('Sinkronisasi Area Gagal', 'Menampilkan data area terakhir yang berhasil dimuat.');
        }
        setLoading(false);
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

    const loadBulkPreview = useCallback(async () => {
        if (!bulkConfigArea) return;

        setBulkPreviewLoading(true);
        try {
            const payload = buildBulkPayload(bulkConfig);
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
    }, [bulkConfig, bulkConfigArea, showError]);

    const handleBulkUpdate = async () => {
        if (!bulkConfigArea) return;
        setApplyingBulk(true);
        try {
            const payload = buildBulkPayload(bulkConfig);

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
        const result = await settingsService.updateMapCenter(
            mapCenter.latitude, mapCenter.longitude, mapCenter.zoom, mapCenter.name
        );
        setSavingMapCenter(false);
        if (!result.success) {
            showError('Gagal', result.message || 'Gagal menyimpan lokasi default');
            return;
        }
        success('Berhasil', 'Lokasi default peta berhasil disimpan');
        setShowMapCenterModal(false);
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
            <div className="text-center py-20 bg-surface border border-edge rounded-2xl">
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
                    <h1 className="text-2xl font-bold text-content">Area</h1>
                    <p className="text-content-muted mt-1">Kelompokkan kamera berdasarkan RT, RW, Kelurahan, Kecamatan</p>
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
                            className="px-4 py-2.5 bg-white dark:bg-gray-800/80 border border-edge rounded-xl text-content text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary">
                            <option value="">Semua Kecamatan</option>
                            {kecamatans.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                    )}
                    <button onClick={() => setShowMapCenterModal(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-surface-sunken text-content-muted font-medium rounded-xl hover:bg-surface-sunken transition-colors">
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
                <div className="bg-surface border border-edge rounded-2xl p-4 shadow-sm">
                    <p className="text-2xl font-bold text-content">{areas.length}</p>
                    <p className="text-sm text-content-muted">Total Area</p>
                </div>
                <div className="bg-surface border border-edge rounded-2xl p-4 shadow-sm">
                    <p className="text-2xl font-bold text-content">{kecamatans.length}</p>
                    <p className="text-sm text-content-muted">Kecamatan</p>
                </div>
                <div className="bg-surface border border-edge rounded-2xl p-4 shadow-sm">
                    <p className="text-2xl font-bold text-content">
                        {[...new Set(areas.map(a => a.kelurahan).filter(Boolean))].length}
                    </p>
                    <p className="text-sm text-content-muted">Kelurahan</p>
                </div>
                <div className="bg-surface border border-edge rounded-2xl p-4 shadow-sm">
                    <p className="text-2xl font-bold text-content">
                        {areas.reduce((sum, a) => sum + (a.cameraCount || 0), 0)}
                    </p>
                    <p className="text-sm text-content-muted">Total Kamera</p>
                </div>
            </div>

            <div className="rounded-[26px] border border-sky-200/70 border-primary-300 bg-[linear-gradient(135deg,rgba(14,165,233,0.09),rgba(59,130,246,0.03))] px-5 py-4 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-sm font-semibold text-primary text-primary">Grid View Default</p>
                        <p className="text-sm text-sky-700/90 dark:text-sky-100/80">
                            Saat filter masih di semua area, grid hanya memuat area yang ditandai aktif di sini. Jika user memilih area tertentu, area itu tetap tampil penuh.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm md:min-w-[240px]">
                        <div className="rounded-2xl border border-sky-200/60 bg-white/70 px-4 py-3 text-center dark:border-sky-500/10 dark:bg-slate-900/40">
                            <div className="font-bold text-primary dark:text-white">{gridDefaultEnabledAreaCount}</div>
                            <div className="text-sky-700/80 dark:text-sky-100/70">Area aktif</div>
                        </div>
                        <div className="rounded-2xl border border-sky-200/60 bg-white/70 px-4 py-3 text-center dark:border-sky-500/10 dark:bg-slate-900/40">
                            <div className="font-bold text-primary dark:text-white">{gridDefaultCameraCount}</div>
                            <div className="text-sky-700/80 dark:text-sky-100/70">Kamera default</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Areas Grid */}
            {filteredAreas.length === 0 ? (
                filterKecamatan ? (
                    <div className="text-center py-20 bg-surface border border-edge rounded-2xl">
                        <p className="text-content-muted mb-4">Tidak ada area di kecamatan ini</p>
                        <button onClick={() => setFilterKecamatan('')} className="text-primary font-semibold hover:text-primary-600">
                            Hapus Filter &rarr;
                        </button>
                    </div>
                ) : (
                    <div className="bg-surface border border-edge rounded-2xl">
                        <NoAreasEmptyState onAddArea={openAddModal} />
                    </div>
                )
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredAreas.map((area) => (
                        <AreaCard
                            key={area.id}
                            area={area}
                            togglingGridAreaId={togglingGridAreaId}
                            onOpenBulkConfig={openBulkConfigModal}
                            onBulkDelete={setBulkDeleteAreaConfirm}
                            onEdit={openEditModal}
                            onDelete={setDeleteConfirm}
                            onToggleGridDefault={handleToggleGridDefault}
                            onGridDefaultLimitChange={handleGridDefaultLimitChange}
                        />
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <AreaFormModal
                    editingArea={editingArea}
                    formData={formData}
                    formErrors={formErrors}
                    error={error}
                    submitting={submitting}
                    LocationPickerComponent={LocationPicker}
                    onChange={handleChange}
                    onSubmit={handleSubmit}
                    onClose={() => setShowModal(false)}
                    onErrorDismiss={() => setError('')}
                    onLocationChange={handleLocationChange}
                />
            )}

            {/* Bulk Config Modal */}
            {bulkConfigArea && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-modal p-4">
                    <div
                        ref={bulkDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Bulk Policy Center"
                        className="bg-surface w-full max-w-3xl rounded-card shadow-e2 border border-edge max-h-[90vh] flex flex-col"
                    >
                        <div className="p-6 border-b border-edge flex justify-between items-center bg-amber-50 dark:bg-amber-900/20 rounded-t-2xl shrink-0">
                            <div>
                                <h3 className="text-lg font-bold text-content">Bulk Policy Center</h3>
                                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">Area: {bulkConfigArea.name}</p>
                            </div>
                            <button onClick={() => setBulkConfigArea(null)} className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-800/30 text-content-muted">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                        </div>
                        <div className="p-6 grid lg:grid-cols-[1.1fr_0.9fr] gap-6 overflow-y-auto">
                            <div className="space-y-4">
                                <p className="text-sm text-content-muted">Gunakan bulk tools untuk policy massal, normalisasi unresolved, dan maintenance per area.</p>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Mode Operasi</label>
                                        <select aria-label="Mode Operasi"
                                            value={bulkConfig.operation}
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, operation: e.target.value }))}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                        >
                                            <option value="policy_update">Bulk Policy Update</option>
                                            <option value="normalization">Bulk Normalization</option>
                                            <option value="maintenance">Bulk Maintenance</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Target Kamera</label>
                                        <select aria-label="Target Kamera"
                                            value={effectiveBulkTargetFilter}
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, targetFilter: e.target.value }))}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
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
                                            <p className="text-xs text-primary text-primary">
                                                Health monitoring policy otomatis dikunci ke target External Valid.
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Health Monitoring</label>
                                        <select
                                            aria-label="Health Monitoring"
                                            value={bulkConfig.external_health_mode}
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, external_health_mode: e.target.value }))}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="default">Ikuti Default Area/Global</option>
                                            <option value="passive_first">Passive First</option>
                                            <option value="hybrid_probe">Hybrid Probe</option>
                                            <option value="probe_first">Probe First</option>
                                            <option value="disabled">Disabled</option>
                                        </select>
                                        <p className="text-xs text-content-muted">
                                            Berlaku untuk kamera external valid; kamera internal atau metadata belum lengkap akan dilewati oleh preview.
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Delivery Type</label>
                                        <select aria-label="Delivery Type"
                                            value={bulkConfig.delivery_type}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, delivery_type: e.target.value })}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
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
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Origin Mode</label>
                                        <select aria-label="Origin Mode"
                                            value={bulkConfig.external_origin_mode}
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, external_origin_mode: e.target.value }))}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="direct">Direct</option>
                                            <option value="embed">Embed</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Gunakan Proxy Server</label>
                                        <select aria-label="Gunakan Proxy Server"
                                            value={bulkConfig.external_use_proxy}
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, external_use_proxy: e.target.value }))}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="1">Aktifkan</option>
                                            <option value="0">Matikan</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Mode TLS</label>
                                        <select aria-label="Mode TLS"
                                            value={bulkConfig.external_tls_mode}
                                            onChange={(e) => setBulkConfig((current) => ({ ...current, external_tls_mode: e.target.value }))}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="strict">Strict</option>
                                            <option value="insecure">Insecure</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Recording</label>
                                        <select aria-label="Recording"
                                            value={bulkConfig.enable_recording}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, enable_recording: e.target.value })}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="1">Aktifkan</option>
                                            <option value="0">Matikan</option>
                                        </select>
                                        <p className="text-xs text-content-muted">
                                            Matikan aman untuk semua tipe kamera; aktifkan recording tetap diproteksi untuk kamera internal.
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Status Publik</label>
                                        <select aria-label="Status Publik"
                                            value={bulkConfig.enabled}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, enabled: e.target.value })}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="1">Aktifkan</option>
                                            <option value="0">Matikan</option>
                                        </select>
                                        <p className="text-xs text-content-muted">
                                            Matikan menyembunyikan semua kamera terpilih dari publik tanpa bergantung pada tipe delivery.
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-1.5 p-3 bg-surface-sunken rounded-xl border border-edge">
                                        <label className="text-sm font-semibold text-content">Video Codec</label>
                                        <select aria-label="Video Codec"
                                            value={bulkConfig.video_codec}
                                            onChange={(e) => setBulkConfig({ ...bulkConfig, video_codec: e.target.value })}
                                            className="w-full bg-surface border border-edge-strong text-content text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                        >
                                            <option value="ignore">Biarkan Seperti Semula</option>
                                            <option value="h264">H.264</option>
                                            <option value="h265">H.265</option>
                                        </select>
                                    </div>
                                </div>

                                <label className="flex items-center gap-3 p-3 rounded-xl border border-edge bg-surface-sunken">
                                    <input
                                        type="checkbox"
                                        checked={bulkConfig.clear_internal_rtsp}
                                        onChange={(e) => setBulkConfig({ ...bulkConfig, clear_internal_rtsp: e.target.checked })}
                                        className="h-4 w-4 rounded border-edge-strong text-primary focus:ring-primary"
                                    />
                                    <div>
                                        <div className="text-sm font-semibold text-content">Clear internal RTSP saat normalisasi</div>
                                        <div className="text-xs text-content-muted">Dipakai untuk merapikan legacy row external yang masih menyimpan jejak konfigurasi internal.</div>
                                    </div>
                                </label>
                            </div>

                            <BulkPolicyPreview
                                bulkPreview={bulkPreview}
                                bulkPreviewLoading={bulkPreviewLoading}
                                effectiveBulkTargetFilter={effectiveBulkTargetFilter}
                                onPreview={loadBulkPreview}
                            />
                        </div>
                        <div className="flex gap-3 p-6 shrink-0 border-t border-edge bg-surface rounded-b-2xl">
                            <button onClick={() => setBulkConfigArea(null)} className="flex-1 px-4 py-2.5 bg-surface-sunken text-content-muted font-medium rounded-xl hover:bg-surface-sunken" disabled={applyingBulk}>Batal</button>
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
                <Modal
                    title="Lokasi Default Peta"
                    description={'Titik tengah saat "Semua Lokasi" dipilih'}
                    size="md"
                    onClose={() => setShowMapCenterModal(false)}
                    footer={(
                        <>
                            <Button onClick={() => setShowMapCenterModal(false)} disabled={savingMapCenter}>Batal</Button>
                            <Button
                                variant="primary"
                                onClick={saveMapCenter}
                                loading={savingMapCenter}
                                disabled={!mapCenter.latitude || !mapCenter.longitude}
                            >
                                Simpan
                            </Button>
                        </>
                    )}
                >
                    <div className="space-y-4">
                        <Field
                            label="Nama Lokasi"
                            value={mapCenter.name}
                            onChange={(e) => setMapCenter({ ...mapCenter, name: e.target.value })}
                            placeholder="Contoh: Kabupaten Bojonegoro"
                            hint={'Nama ini akan ditampilkan di filter "Semua Lokasi"'}
                        />
                        <Field
                            as="select"
                            label="Zoom Level"
                            value={mapCenter.zoom}
                            onChange={(e) => setMapCenter({ ...mapCenter, zoom: parseInt(e.target.value) })}
                        >
                            <option value={10}>10 - Kabupaten/Kota</option>
                            <option value={11}>11 - Kecamatan Luas</option>
                            <option value={12}>12 - Kecamatan</option>
                            <option value={13}>13 - Kelurahan/Desa</option>
                            <option value={14}>14 - Detail Desa</option>
                            <option value={15}>15 - Jalan</option>
                        </Field>
                        <div>
                            <p className="mb-2 text-xs font-semibold text-content-muted">Pilih Titik Tengah</p>
                            <Suspense fallback={<div className="text-sm text-content-muted">Loading map...</div>}>
                                <LocationPicker
                                    latitude={mapCenter.latitude}
                                    longitude={mapCenter.longitude}
                                    onLocationChange={handleMapCenterChange}
                                />
                            </Suspense>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Bulk Delete Area Cameras Modal */}
            {bulkDeleteAreaConfirm && (
                <Modal
                    title="Hapus Semua Kamera?"
                    size="sm"
                    onClose={() => setBulkDeleteAreaConfirm(null)}
                    footer={(
                        <>
                            <Button onClick={() => setBulkDeleteAreaConfirm(null)} disabled={applyingBulkDelete}>Batalkan</Button>
                            <Button variant="danger" onClick={handleBulkDelete} loading={applyingBulkDelete}>
                                Ya, hapus permanen
                            </Button>
                        </>
                    )}
                >
                    <p className="text-sm text-content-muted">
                        Anda akan menghapus <span className="font-semibold text-status-fault">{bulkDeleteAreaConfirm.cameraCount || 0} kamera</span> dari
                        area <span className="font-semibold text-content">&quot;{bulkDeleteAreaConfirm.name}&quot;</span>.
                    </p>
                    <div className="mt-4 rounded-card border border-status-fault/30 bg-status-fault/10 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-status-fault">Tidak bisa dibatalkan</p>
                        <p className="mt-1 text-sm text-content-muted">
                            Semua data streaming, proxy, rekaman, dan riwayat kamera ikut terhapus permanen.
                        </p>
                    </div>
                </Modal>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <Modal
                    title="Hapus Area"
                    size="sm"
                    onClose={() => setDeleteConfirm(null)}
                    footer={(
                        <>
                            <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                            <Button variant="danger" onClick={handleDelete} loading={deleting}>Hapus</Button>
                        </>
                    )}
                >
                    <p className="text-sm text-content-muted">
                        Yakin ingin menghapus <span className="font-semibold text-content">&quot;{deleteConfirm.name}&quot;</span>?
                    </p>
                    {deleteConfirm.cameraCount > 0 && (
                        <div className="mt-4 rounded-card border border-status-warn/30 bg-status-warn/10 p-3">
                            <p className="text-sm text-content-muted">
                                Area ini memiliki {deleteConfirm.cameraCount} kamera. Menghapus area akan melepas kamera dari area ini.
                            </p>
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
}
