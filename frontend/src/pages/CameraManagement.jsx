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
        areas,
        loading,
        loadError,
        showModal,
        editingCamera,
        deletingId,
        togglingId,
        togglingMaintenanceId,
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
        setFieldValue,
        getFieldError,
        setModalError,
    } = useCameraManagementPage();

    return (
        <div className="space-y-8">
            <CameraManagementHeader onAddCamera={openAddModal} />

            {loading ? (
                <CameraManagementLoadingState />
            ) : loadError ? (
                <CameraManagementErrorState error={loadError} onRetry={loadCameras} />
            ) : cameras.length === 0 ? (
                <CameraManagementEmptyState onAddCamera={openAddModal} />
            ) : (
                <CameraGrid
                    cameras={cameras}
                    deletingId={deletingId}
                    togglingId={togglingId}
                    togglingMaintenanceId={togglingMaintenanceId}
                    onEdit={openEditModal}
                    onDelete={deleteCamera}
                    onToggleEnabled={toggleEnabled}
                    onToggleMaintenance={toggleMaintenance}
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
