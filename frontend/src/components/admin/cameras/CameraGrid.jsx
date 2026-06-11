/*
Purpose: Render the responsive Camera Management card grid with client-side pagination so
         large fleets (hundreds of cameras) don't mount every card at once.
Caller: CameraManagement page.
Deps: CameraCard.
MainFuncs: CameraGrid.
SideEffects: Emits card action callbacks only.
*/

import { useEffect, useState } from 'react';
import CameraCard from './CameraCard';

const PAGE_SIZE = 24;

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
    const [page, setPage] = useState(1);
    const totalPages = Math.max(1, Math.ceil(cameras.length / PAGE_SIZE));

    // Clamp when the filtered set shrinks below the current page (e.g. a filter
    // narrows results). Does NOT reset to page 1 on same-size updates like a toggle.
    useEffect(() => {
        if (page > totalPages) {
            setPage(1);
        }
    }, [page, totalPages]);

    const start = (page - 1) * PAGE_SIZE;
    const visibleCameras = cameras.slice(start, start + PAGE_SIZE);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {visibleCameras.map((camera) => (
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

            {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800/60">
                    <span className="text-gray-500 dark:text-gray-400">
                        Halaman {page} dari {totalPages} · {cameras.length} kamera
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            disabled={page <= 1}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/60"
                        >
                            ← Sebelumnya
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                            disabled={page >= totalPages}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/60"
                        >
                            Berikutnya →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
