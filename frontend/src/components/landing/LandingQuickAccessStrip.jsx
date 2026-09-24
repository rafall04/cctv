/*
 * Purpose: Render public quick access lists for favorite and recently viewed cameras.
 * Caller: LandingPage and LandingPageSimple public landing surfaces.
 * Deps: React props and public camera click handlers.
 * MainFuncs: LandingQuickAccessStrip.
 * SideEffects: Invokes caller-provided camera click handler.
 */

import { sliceLandingQuickAccessCameras } from '../../utils/publicLandingSections';

function QuickCameraButton({ camera, label, onCameraClick }) {
    return (
        <button
            type="button"
            onClick={() => onCameraClick(camera)}
            className="flex min-h-[64px] w-[min(16rem,calc(100vw-4rem))] shrink-0 items-center gap-3 rounded-card border border-edge bg-surface px-3 py-2 text-left transition-colors hover:border-edge-strong hover:bg-primary/5 sm:w-[230px]"
        >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-[10px] font-semibold text-primary">
                {label}
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-content">{camera.name}</div>
                <div className="mt-0.5 truncate text-xs text-content-muted">
                    {camera.area_name || camera.location || 'Area publik'}
                </div>
            </div>
        </button>
    );
}

function QuickGroup({ title, label, cameras, onCameraClick }) {
    if (!cameras.length) {
        return null;
    }

    return (
        <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-content">{title}</h2>
                <span className="text-xs tabular-nums text-content-muted">{cameras.length} kamera</span>
            </div>
            {/* [contain:paint] — see LandingDiscoveryStrip for the incident. A horizontal strip's
                overflow reaches the document's scrollable rect even through clipping ancestors,
                and mobile browsers zoom the whole page out to fit it. */}
            <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1 [contain:paint] [-webkit-overflow-scrolling:touch]">
                {cameras.slice(0, 5).map((camera) => (
                    <QuickCameraButton
                        key={`${title}-${camera.id}`}
                        camera={camera}
                        label={label}
                        onCameraClick={onCameraClick}
                    />
                ))}
            </div>
        </div>
    );
}

function EmptyFavoriteTarget() {
    return (
        <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-edge bg-surface-sunken px-4 py-5 text-center">
            {/* ui/Icons has no Star glyph — inline the same outline star the camera cards
                draw for their favorite button, which the copy below names. */}
            <svg className="h-5 w-5 text-content-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            <p className="text-sm text-content-subtle">
                Belum ada kamera favorit. Tekan tombol bintang pada kartu CCTV untuk menyimpan akses cepat.
            </p>
        </div>
    );
}

export default function LandingQuickAccessStrip({
    recentCameras = [],
    favoriteCameras = [],
    onCameraClick,
    forceVisible = false,
}) {
    const capped = sliceLandingQuickAccessCameras({ favoriteCameras, recentCameras });

    if (!forceVisible && !capped.recentCameras.length && !capped.favoriteCameras.length) {
        return null;
    }

    return (
        <section id="public-quick-access" data-testid="landing-quick-access" className="mx-auto w-full max-w-full overflow-hidden px-3 py-3 sm:max-w-7xl sm:px-6 lg:px-8">
            <div className="space-y-4 rounded-card border border-edge bg-surface p-3">
                <QuickGroup
                    title="Favorit"
                    label="FAV"
                    cameras={capped.favoriteCameras}
                    onCameraClick={onCameraClick}
                />
                {forceVisible && capped.favoriteCameras.length === 0 && <EmptyFavoriteTarget />}
                <QuickGroup
                    title="Terakhir Dilihat"
                    label="REC"
                    cameras={capped.recentCameras}
                    onCameraClick={onCameraClick}
                />
            </div>
        </section>
    );
}
