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
import DeadSourcePanel from '../components/admin/cameras/DeadSourcePanel';
import CameraFeedbackPanel from '../components/admin/cameras/CameraFeedbackPanel';
import {
    CameraManagementEmptyState,
    CameraManagementErrorState,
    CameraManagementLoadingState,
    CameraManagementNoMatchState,
} from '../components/admin/cameras/CameraManagementStates';

const EMPTY_CAMERA_FILTERS = {
    search: '',
    areaId: 'all',
    cameraClass: 'all',
    deliveryType: 'all',
    healthMode: 'all',
    availabilityState: 'all',
    monitoringState: 'all',
};
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
        loadingDetail,
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

            {/* Both render nothing while there is nothing wrong — see their component headers. */}
            <DeadSourcePanel />
            <CameraFeedbackPanel />

            {!loading && !loadError && cameras.length > 0 && (
                <div className="rounded-2xl border border-edge bg-white p-4 shadow-sm dark:bg-gray-800/60">
                    {/*
                      * Was `xl:grid-cols-6` with the search box spanning 2 — eight slots in six
                      * columns, so every select was ~1/6 of the row and narrower than its own
                      * longest option: "Semua Health Mode" rendered as "Semua Health Mo" with the
                      * native chevron sitting on the clipped text. Four columns fits the same
                      * eight slots in two clean rows with room for the labels.
                      */}
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <input
                            type="text"
                            value={filters.search}
                            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                            placeholder="Cari nama, area, mode health..."
                            aria-label="Cari kamera"
                            className="xl:col-span-2 rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        />
                        <select
                            value={filters.areaId}
                            aria-label="Filter area"
                            onChange={(event) => setFilters((current) => ({ ...current, areaId: event.target.value }))}
                            className="rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        >
                            <option value="all">Semua Area</option>
                            {areas.map((area) => (
                                <option key={area.id} value={String(area.id)}>{area.name}</option>
                            ))}
                        </select>
                        <select
                            value={filters.cameraClass}
                            aria-label="Filter kelas kamera"
                            onChange={(event) => setFilters((current) => ({ ...current, cameraClass: event.target.value }))}
                            className="rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        >
                            <option value="all">Semua Kelas</option>
                            <option value="community">Community (Publik)</option>
                            <option value="subscriber">Subscriber (Sewa)</option>
                            <option value="owner_private">Owner Private</option>
                        </select>
                        <select
                            value={filters.deliveryType}
                            aria-label="Filter tipe delivery"
                            onChange={(event) => setFilters((current) => ({ ...current, deliveryType: event.target.value }))}
                            className="rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        >
                            <option value="all">Semua Delivery</option>
                            <option value="internal_hls">HLS internal</option>
                            <option value="external_hls">HLS eksternal</option>
                            <option value="external_flv">FLV</option>
                            <option value="external_mjpeg">MJPEG</option>
                            <option value="external_embed">Embed</option>
                            <option value="external_jsmpeg">JSMpeg</option>
                            <option value="external_custom_ws">WebSocket</option>
                        </select>
                        <select
                            value={filters.healthMode}
                            aria-label="Filter health mode"
                            onChange={(event) => setFilters((current) => ({ ...current, healthMode: event.target.value }))}
                            className="rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        >
                            <option value="all">Semua Health Mode</option>
                            <option value="default">Bawaan</option>
                            <option value="passive_first">Pasif dulu</option>
                            <option value="hybrid_probe">Hibrida</option>
                            <option value="probe_first">Probe dulu</option>
                            <option value="disabled">Nonaktif</option>
                        </select>
                        <select
                            value={filters.availabilityState}
                            aria-label="Filter availability"
                            onChange={(event) => setFilters((current) => ({ ...current, availabilityState: event.target.value }))}
                            className="rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        >
                            <option value="all">Semua Availability</option>
                            <option value="online">Online</option>
                            <option value="degraded">Menurun</option>
                            <option value="offline">Offline</option>
                            <option value="maintenance">Perbaikan</option>
                        </select>
                        <select
                            value={filters.monitoringState}
                            aria-label="Filter monitoring"
                            onChange={(event) => setFilters((current) => ({ ...current, monitoringState: event.target.value }))}
                            className="rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        >
                            {/* Same vocabulary as MONITORING_LABEL in CameraCard, so the filter
                                and the badge it filters on read as the same word. */}
                            <option value="all">Semua Monitoring</option>
                            <option value="passive">Pasif</option>
                            <option value="probe_failed">Probe gagal</option>
                            <option value="stale">Basi</option>
                            <option value="offline">Offline</option>
                            <option value="unresolved">Belum terpetakan</option>
                            <option value="maintenance">Perbaikan</option>
                        </select>
                    </div>
                    <div className="mt-3 text-xs text-content-muted">
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
                <CameraManagementNoMatchState onResetFilters={() => setFilters(EMPTY_CAMERA_FILTERS)} />
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
                loadingDetail={loadingDetail}
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
