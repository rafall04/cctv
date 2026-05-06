/*
 * Purpose: Render public landing camera result cards progressively for the active grid filter.
 * Caller: LandingCamerasSection.
 * Deps: React hooks, LandingCameraCard, and caller-provided camera action callbacks.
 * MainFuncs: LandingResultsGrid.
 * SideEffects: Invokes camera open, favorite, and multiview callbacks through child cards.
 */

import { useEffect, useMemo, useState } from 'react';
import CameraCard from './LandingCameraCard';

export default function LandingResultsGrid({
    cameras,
    onCameraClick,
    onAddMulti,
    multiCameras,
    isFavorite,
    onToggleFavorite,
    initialVisibleCount = 24,
    loadMoreCount = 24,
    priorityThumbnailCount = 6,
}) {
    const [visibleCount, setVisibleCount] = useState(initialVisibleCount);
    const multiCameraIds = useMemo(() => new Set(multiCameras.map((camera) => camera.id)), [multiCameras]);
    const visibleCameras = cameras.slice(0, visibleCount);
    const hiddenCount = Math.max(cameras.length - visibleCameras.length, 0);
    const nextLoadCount = Math.min(loadMoreCount, hiddenCount);

    useEffect(() => {
        setVisibleCount(initialVisibleCount);
    }, [cameras, initialVisibleCount]);

    return (
        <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
                {visibleCameras.map((camera, index) => (
                    <CameraCard
                        key={camera.id ?? `grid-${index}`}
                        camera={camera}
                        onClick={() => onCameraClick(camera)}
                        onAddMulti={() => onAddMulti(camera)}
                        inMulti={multiCameraIds.has(camera.id)}
                        isFavorite={isFavorite}
                        onToggleFavorite={onToggleFavorite}
                        thumbnailPriority={index < priorityThumbnailCount}
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
                        onClick={() => setVisibleCount((current) => Math.min(current + loadMoreCount, cameras.length))}
                        className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:border-primary/50 hover:text-primary dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-primary/50 dark:hover:text-primary"
                    >
                        Tampilkan {nextLoadCount} kamera lagi
                    </button>
                </div>
            )}
        </>
    );
}
