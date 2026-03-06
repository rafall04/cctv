import CameraCard from './CameraCard';

export default function CameraGrid({
    cameras,
    deletingId,
    togglingId,
    togglingMaintenanceId,
    onEdit,
    onDelete,
    onToggleEnabled,
    onToggleMaintenance,
}) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cameras.map((camera) => (
                <CameraCard
                    key={camera.id}
                    camera={camera}
                    deletingId={deletingId}
                    togglingId={togglingId}
                    togglingMaintenanceId={togglingMaintenanceId}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onToggleEnabled={onToggleEnabled}
                    onToggleMaintenance={onToggleMaintenance}
                />
            ))}
        </div>
    );
}
