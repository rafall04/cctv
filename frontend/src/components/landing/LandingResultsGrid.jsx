/*
 * Purpose: Render public landing camera result cards progressively for the active grid filter.
 * Caller: LandingCamerasSection.
 * Deps: React memo/callback hooks, LandingCameraCard, device detector, and caller-provided camera action callbacks.
 * MainFuncs: getAdaptiveGridWindow, LandingResultsGrid, LandingGridCameraCard.
 * SideEffects: Invokes camera open, favorite, and multiview callbacks through child cards.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import CameraCard from './LandingCameraCard';
import { getAdaptiveGridWindow } from '../../utils/publicLandingSections';

export { getAdaptiveGridWindow } from '../../utils/publicLandingSections';

const LandingGridCameraCard = memo(function LandingGridCameraCard({
    camera,
    onCameraClick,
    onAddMulti,
    isInMulti,
    isFavorite,
    onToggleFavorite,
    thumbnailPriority,
}) {
    const handleCameraClick = useCallback(() => {
        onCameraClick(camera);
    }, [camera, onCameraClick]);

    const handleAddMulti = useCallback(() => {
        onAddMulti(camera);
    }, [camera, onAddMulti]);

    return (
        <CameraCard
            camera={camera}
            onClick={handleCameraClick}
            onAddMulti={handleAddMulti}
            inMulti={isInMulti}
            isFavorite={isFavorite}
            onToggleFavorite={onToggleFavorite}
            thumbnailPriority={thumbnailPriority}
        />
    );
});

export default function LandingResultsGrid({
    cameras,
    onCameraClick,
    onAddMulti,
    multiCameras,
    isFavorite,
    onToggleFavorite,
    initialVisibleCount,
    loadMoreCount,
    priorityThumbnailCount,
}) {
    const adaptiveGridWindow = useMemo(() => getAdaptiveGridWindow(), []);
    const resolvedInitialVisibleCount = initialVisibleCount ?? adaptiveGridWindow.initialVisibleCount;
    const resolvedLoadMoreCount = loadMoreCount ?? adaptiveGridWindow.loadMoreCount;
    const resolvedPriorityThumbnailCount = priorityThumbnailCount ?? adaptiveGridWindow.priorityThumbnailCount;
    const [visibleCount, setVisibleCount] = useState(resolvedInitialVisibleCount);
    const multiCameraIds = useMemo(() => new Set(multiCameras.map((camera) => camera.id)), [multiCameras]);
    const visibleCameras = useMemo(() => cameras.slice(0, visibleCount), [cameras, visibleCount]);
    const hiddenCount = Math.max(cameras.length - visibleCameras.length, 0);
    const nextLoadCount = Math.min(resolvedLoadMoreCount, hiddenCount);

    useEffect(() => {
        setVisibleCount(resolvedInitialVisibleCount);
    }, [cameras, resolvedInitialVisibleCount]);

    return (
        <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
                {visibleCameras.map((camera, index) => (
                    <LandingGridCameraCard
                        key={camera.id ?? `grid-${index}`}
                        camera={camera}
                        onCameraClick={onCameraClick}
                        onAddMulti={onAddMulti}
                        isInMulti={multiCameraIds.has(camera.id)}
                        isFavorite={isFavorite}
                        onToggleFavorite={onToggleFavorite}
                        thumbnailPriority={index < resolvedPriorityThumbnailCount}
                    />
                ))}
            </div>

            {hiddenCount > 0 && (
                <div className="mt-6 flex flex-col items-center gap-3 text-center">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Menampilkan {visibleCameras.length} dari {cameras.length} kamera
                    </p>
                    <button
                        type="button"
                        onClick={() => setVisibleCount((current) => Math.min(current + resolvedLoadMoreCount, cameras.length))}
                        className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:border-primary/50 hover:text-primary dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-primary/50 dark:hover:text-primary"
                    >
                        Tampilkan {nextLoadCount} kamera lagi
                    </button>
                </div>
            )}
        </>
    );
}
