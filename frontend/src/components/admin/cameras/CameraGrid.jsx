/*
Purpose: Render the responsive Camera Management card grid and pass camera actions to each card.
Caller: CameraManagement page.
Deps: CameraCard.
MainFuncs: CameraGrid.
SideEffects: Emits card action callbacks only.
*/

import CameraCard from './CameraCard';

export default function CameraGrid({
    cameras,
    deletingId,
    togglingId,
    togglingMaintenanceId,
    refreshingStreamId,
    onEdit,
    onDelete,
    onToggleEnabled,
    onToggleMaintenance,
    onRefreshStream,
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
                    refreshingStreamId={refreshingStreamId}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onToggleEnabled={onToggleEnabled}
                    onToggleMaintenance={onToggleMaintenance}
                    onRefreshStream={onRefreshStream}
                />
            ))}
        </div>
    );
}
