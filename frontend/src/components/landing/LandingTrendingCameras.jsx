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
                <h2 className="text-base font-semibold text-content">{title}</h2>
                <span className="font-mono text-xs tabular-nums text-content-subtle">{cameras.length} kamera</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {cameras.map((camera, index) => (
                    <button
                        key={camera.id}
                        type="button"
                        onClick={() => onCameraClick?.(camera)}
                        className="rounded-card border border-edge bg-surface p-3 text-left transition-colors hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        {/* Same rank chip as LandingDiscoveryStrip — this list is ordered
                            by views, so the position is real information, not decoration. */}
                        <div className="flex min-w-0 items-center gap-2">
                            <span
                                className="grid h-5 min-w-5 shrink-0 place-items-center rounded-control border border-edge bg-surface-overlay px-0.5 font-mono text-[10px] font-bold leading-none text-content"
                                aria-hidden="true"
                            >
                                #{index + 1}
                            </span>
                            <span className="sr-only">Peringkat {index + 1}</span>
                            <div className="min-w-0 truncate text-sm font-semibold text-content">{camera.name}</div>
                        </div>
                        <div className="mt-1 truncate text-xs text-content-muted">{camera.area_name || camera.location || 'Area publik'}</div>
                        <div className="mt-2 font-mono text-xs font-semibold tabular-nums text-data">{Number(camera.total_views || 0).toLocaleString('id-ID')}x ditonton</div>
                    </button>
                ))}
            </div>
        </section>
    );
}
