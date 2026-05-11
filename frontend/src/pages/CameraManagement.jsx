/*
Purpose: Camera Management route shell for admin camera CRUD, filters, forms, and stream recovery controls.
Caller: App protected admin route.
Deps: admin camera components and useCameraManagementPage hook.
MainFuncs: CameraManagement.
SideEffects: Delegates camera mutations and stream refresh actions through the page hook.
*/

import CameraFormModal from '../components/admin/cameras/CameraFormModal';
import CameraGrid from '../components/admin/cameras/CameraGrid';
import CameraManagementHeader from '../components/admin/cameras/CameraManagementHeader';
import {
    CameraManagementEmptyState,
    CameraManagementErrorState,
    CameraManagementLoadingState,
} from '../components/admin/cameras/CameraManagementStates';
import { useCameraManagementPage } from '../hooks/admin/useCameraManagementPage';

export default function CameraManagement() {
    const {
        cameras,
        filteredCameras,
        areas,
        filters,
        loading,
        loadError,
        showModal,
        editingCamera,
        deletingId,
        togglingId,
        togglingMaintenanceId,
        refreshingStreamId,
        modalError,
        formData,
        isSubmitting,
        loadCameras,
        openAddModal,
        openEditModal,
        closeModal,
        handleFormChange,
        handleBlur,
        submitCamera,
        deleteCamera,
        toggleEnabled,
        toggleMaintenance,
        refreshCameraStream,
        setFieldValue,
        getFieldError,
        setModalError,
        setFilters,
    } = useCameraManagementPage();

    return (
        <div className="space-y-8">
            <CameraManagementHeader onAddCamera={openAddModal} />

            {!loading && !loadError && cameras.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800/60">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                        <input
                            type="text"
                            value={filters.search}
                            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                            placeholder="Cari nama, area, mode health..."
                            className="xl:col-span-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                        <select
                            value={filters.areaId}
                            onChange={(event) => setFilters((current) => ({ ...current, areaId: event.target.value }))}
                            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="all">Semua Area</option>
                            {areas.map((area) => (
                                <option key={area.id} value={String(area.id)}>{area.name}</option>
                            ))}
                        </select>
                        <select
                            value={filters.deliveryType}
                            onChange={(event) => setFilters((current) => ({ ...current, deliveryType: event.target.value }))}
                            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="all">Semua Delivery</option>
                            <option value="internal_hls">Internal HLS</option>
                                    <option value="external_hls">External HLS</option>
                                    <option value="external_flv">External FLV</option>
                                    <option value="external_mjpeg">External MJPEG</option>
                            <option value="external_embed">External Embed</option>
                            <option value="external_jsmpeg">External JSMPEG</option>
                            <option value="external_custom_ws">External Custom WS</option>
                        </select>
                        <select
                            value={filters.healthMode}
                            onChange={(event) => setFilters((current) => ({ ...current, healthMode: event.target.value }))}
                            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="all">Semua Health Mode</option>
                            <option value="default">Default</option>
                            <option value="passive_first">Passive First</option>
                            <option value="hybrid_probe">Hybrid Probe</option>
                            <option value="probe_first">Probe First</option>
                            <option value="disabled">Disabled</option>
                        </select>
                        <select
                            value={filters.availabilityState}
                            onChange={(event) => setFilters((current) => ({ ...current, availabilityState: event.target.value }))}
                            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="all">Semua Availability</option>
                            <option value="online">Online</option>
                            <option value="degraded">Degraded</option>
                            <option value="offline">Offline</option>
                            <option value="maintenance">Maintenance</option>
                        </select>
                        <select
                            value={filters.monitoringState}
                            onChange={(event) => setFilters((current) => ({ ...current, monitoringState: event.target.value }))}
                            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="all">Semua Monitoring</option>
                            <option value="passive">Passive</option>
                            <option value="probe_failed">Probe Failed</option>
                            <option value="stale">Stale</option>
                            <option value="offline">Offline</option>
                            <option value="unresolved">Unresolved</option>
                            <option value="maintenance">Maintenance</option>
                        </select>
                    </div>
                    <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                        Menampilkan {filteredCameras.length} dari {cameras.length} kamera.
                    </div>
                </div>
            )}

            {loading ? (
                <CameraManagementLoadingState />
            ) : loadError ? (
                <CameraManagementErrorState error={loadError} onRetry={loadCameras} />
            ) : cameras.length === 0 ? (
                <CameraManagementEmptyState onAddCamera={openAddModal} />
            ) : filteredCameras.length === 0 ? (
                <CameraManagementEmptyState onAddCamera={openAddModal} />
            ) : (
                <CameraGrid
                    cameras={filteredCameras}
                    deletingId={deletingId}
                    togglingId={togglingId}
                    togglingMaintenanceId={togglingMaintenanceId}
                    refreshingStreamId={refreshingStreamId}
                    onEdit={openEditModal}
                    onDelete={deleteCamera}
                    onToggleEnabled={toggleEnabled}
                    onToggleMaintenance={toggleMaintenance}
                    onRefreshStream={refreshCameraStream}
                />
            )}

            <CameraFormModal
                show={showModal}
                editingCamera={editingCamera}
                areas={areas}
                formData={formData}
                modalError={modalError}
                isSubmitting={isSubmitting}
                getFieldError={getFieldError}
                onClose={closeModal}
                onSubmit={submitCamera}
                onChange={handleFormChange}
                onBlur={handleBlur}
                setFieldValue={setFieldValue}
                setModalError={setModalError}
            />
        </div>
    );
}
