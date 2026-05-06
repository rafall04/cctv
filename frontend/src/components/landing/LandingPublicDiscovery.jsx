/*
 * Purpose: Render lively public discovery sections for live ranking, top cameras, popular areas, and new cameras.
 * Caller: LandingPage full mode.
 * Deps: React Router Link and sanitized public growth discovery payloads.
 * MainFuncs: LandingPublicDiscovery, DiscoveryCameraCard, PopularAreaCard.
 * SideEffects: Invokes caller-provided camera click handlers.
 */

import { Link } from 'react-router-dom';

function formatCount(value) {
    return Number(value || 0).toLocaleString('id-ID');
}

function getSectionItems(discovery, key) {
    return Array.isArray(discovery?.[key]) ? discovery[key] : [];
}

function DiscoveryCameraCard({ camera, metricLabel, metricValue, onCameraClick }) {
    return (
        <button
            type="button"
            onClick={() => onCameraClick?.(camera)}
            className="group min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                    <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{camera.area_name || camera.location || 'Area publik'}</div>
                </div>
                <span className="shrink-0 rounded-lg bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-600 dark:text-red-300">
                    LIVE
                </span>
            </div>
            <div className="mt-3 text-xs font-semibold text-primary">
                {formatCount(metricValue)} {metricLabel}
            </div>
        </button>
    );
}

function PopularAreaCard({ area }) {
    return (
        <Link
            to={`/area/${area.slug}`}
            className="group rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{area.name}</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatCount(area.camera_count)} kamera publik</div>
                </div>
                <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    {formatCount(area.live_viewers)} live
                </span>
            </div>
            <div className="mt-3 text-xs font-semibold text-primary">
                {formatCount(area.total_views)}x ditonton
            </div>
        </Link>
    );
}

function DiscoverySection({ title, items, children }) {
    if (!items.length) {
        return null;
    }

    return (
        <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">{items.length} item</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {children}
            </div>
        </section>
    );
}

export default function LandingPublicDiscovery({ discovery = {}, loading = false, onCameraClick }) {
    const liveNow = getSectionItems(discovery, 'live_now');
    const topCameras = getSectionItems(discovery, 'top_cameras');
    const newCameras = getSectionItems(discovery, 'new_cameras');
    const popularAreas = getSectionItems(discovery, 'popular_areas');

    if (loading) {
        return (
            <section data-testid="public-discovery-loading" className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
                <div className="grid gap-3 lg:grid-cols-2">
                    {[0, 1].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />)}
                </div>
            </section>
        );
    }

    if (!liveNow.length && !topCameras.length && !newCameras.length && !popularAreas.length) {
        return null;
    }

    return (
        <div data-testid="public-discovery" className="mx-auto grid max-w-7xl gap-6 px-4 py-5 sm:px-6 lg:px-8">
            <DiscoverySection title="Sedang Ramai" items={liveNow}>
                {liveNow.map((camera) => (
                    <DiscoveryCameraCard
                        key={`live-${camera.id}`}
                        camera={camera}
                        metricLabel="penonton"
                        metricValue={camera.live_viewers}
                        onCameraClick={onCameraClick}
                    />
                ))}
            </DiscoverySection>

            <DiscoverySection title="CCTV Paling Banyak Ditonton" items={topCameras}>
                {topCameras.map((camera) => (
                    <DiscoveryCameraCard
                        key={`top-${camera.id}`}
                        camera={camera}
                        metricLabel="views"
                        metricValue={camera.total_views}
                        onCameraClick={onCameraClick}
                    />
                ))}
            </DiscoverySection>

            <DiscoverySection title="Area Populer" items={popularAreas}>
                {popularAreas.map((area) => (
                    <PopularAreaCard key={`area-${area.id}`} area={area} />
                ))}
            </DiscoverySection>

            <DiscoverySection title="Kamera Terbaru" items={newCameras}>
                {newCameras.map((camera) => (
                    <DiscoveryCameraCard
                        key={`new-${camera.id}`}
                        camera={camera}
                        metricLabel="views"
                        metricValue={camera.total_views}
                        onCameraClick={onCameraClick}
                    />
                ))}
            </DiscoverySection>
        </div>
    );
}
