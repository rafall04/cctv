/*
 * Purpose: Render public landing camera result cards for the active grid filter.
 * Caller: LandingCamerasSection.
 * Deps: LandingCameraCard and caller-provided camera action callbacks.
 * MainFuncs: LandingResultsGrid.
 * SideEffects: Invokes camera open, favorite, and multiview callbacks through child cards.
 */

import CameraCard from './LandingCameraCard';

export default function LandingResultsGrid({
    cameras,
    onCameraClick,
    onAddMulti,
    multiCameras,
    isFavorite,
    onToggleFavorite,
}) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {cameras.map((camera, index) => (
                <CameraCard
                    key={camera.id ?? `grid-${index}`}
                    camera={camera}
                    onClick={() => onCameraClick(camera)}
                    onAddMulti={() => onAddMulti(camera)}
                    inMulti={multiCameras.some((item) => item.id === camera.id)}
                    isFavorite={isFavorite}
                    onToggleFavorite={onToggleFavorite}
                />
            ))}
        </div>
    );
}
