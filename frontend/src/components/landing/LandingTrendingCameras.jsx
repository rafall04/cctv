/*
 * Purpose: Render a compact public top-viewed CCTV strip for landing and area pages.
 * Caller: LandingPage and AreaPublicPage.
 * Deps: LandingCameraCard-style camera data and public share helpers.
 * MainFuncs: LandingTrendingCameras.
 * SideEffects: Invokes caller-provided camera click/share handlers.
 */

export default function LandingTrendingCameras({
    cameras = [],
    title = 'CCTV Paling Banyak Ditonton',
    loading = false,
    onCameraClick,
}) {
    if (loading) {
        return <section data-testid="trending-loading" className="mx-auto max-w-7xl px-4 py-4" />;
    }

    if (!cameras.length) {
        return null;
    }

    return (
        <section data-testid="trending-cameras" className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">{cameras.length} kamera</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {cameras.map((camera) => (
                    <button
                        key={camera.id}
                        type="button"
                        onClick={() => onCameraClick?.(camera)}
                        className="rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-primary/60 dark:border-gray-800 dark:bg-gray-900"
                    >
                        <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                        <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{camera.area_name || camera.location || 'Area publik'}</div>
                        <div className="mt-2 text-xs font-medium text-primary">{Number(camera.total_views || 0).toLocaleString('id-ID')}x ditonton</div>
                    </button>
                ))}
            </div>
        </section>
    );
}
