/*
 * Purpose: Render public quick access lists for favorite and recently viewed cameras.
 * Caller: LandingPage and LandingPageSimple public landing surfaces.
 * Deps: React props and public camera click handlers.
 * MainFuncs: LandingQuickAccessStrip.
 * SideEffects: Invokes caller-provided camera click handler.
 */

function QuickCameraButton({ camera, label, onCameraClick }) {
    return (
        <button
            type="button"
            onClick={() => onCameraClick(camera)}
            className="flex min-h-[64px] w-[min(16rem,calc(100vw-4rem))] shrink-0 items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-primary/60 hover:bg-primary/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-primary/10 sm:w-[230px]"
        >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[10px] font-bold text-primary dark:bg-primary/10 dark:text-primary-300">
                {label}
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
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
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">{cameras.length} kamera</span>
            </div>
            <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
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
        <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Belum ada kamera favorit. Tekan tombol bintang pada kartu CCTV untuk menyimpan akses cepat.
        </div>
    );
}

export default function LandingQuickAccessStrip({
    recentCameras = [],
    favoriteCameras = [],
    onCameraClick,
    forceVisible = false,
}) {
    if (!forceVisible && !recentCameras.length && !favoriteCameras.length) {
        return null;
    }

    return (
        <section id="public-quick-access" data-testid="landing-quick-access" className="mx-auto w-full max-w-full overflow-hidden px-3 py-3 sm:max-w-7xl sm:px-6 lg:px-8">
            <div className="space-y-4 rounded-2xl border border-gray-200 bg-white/85 p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900/85">
                <QuickGroup
                    title="Favorit"
                    label="FAV"
                    cameras={favoriteCameras}
                    onCameraClick={onCameraClick}
                />
                {forceVisible && favoriteCameras.length === 0 && <EmptyFavoriteTarget />}
                <QuickGroup
                    title="Terakhir Dilihat"
                    label="REC"
                    cameras={recentCameras}
                    onCameraClick={onCameraClick}
                />
            </div>
        </section>
    );
}
