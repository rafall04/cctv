/*
 * Purpose: Render compact public discovery feed sections derived from live camera quality and viewer activity, with a tighter simple-mode variant.
 * Caller: LandingPage and LandingPageSimple public surfaces.
 * Deps: landingCameraInsights utility and caller-provided camera click handler.
 * MainFuncs: LandingSmartFeed.
 * SideEffects: Invokes caller-provided camera click handler.
 */

import { buildPublicSmartFeedSections, getPublicCameraQuality } from '../../utils/landingCameraInsights';

function SmartFeedCameraButton({ camera, onCameraClick, now, variant = 'default' }) {
    const quality = getPublicCameraQuality(camera, now);
    const areaLabel = camera.area_name || camera.location || 'Area publik';
    const liveViewers = Number(camera.live_viewers || camera.viewer_stats?.live_viewers || 0);
    const totalViews = Number(camera.total_views || camera.viewer_stats?.total_views || 0);
    const isSimple = variant === 'simple';

    return (
        <button
            type="button"
            onClick={() => onCameraClick?.(camera)}
            className={`${isSimple ? 'min-h-[56px] w-[min(13rem,calc(100vw-3rem))] rounded-xl px-3 py-2 sm:w-48' : 'min-h-[72px] w-[min(17rem,calc(100vw-3rem))] rounded-2xl px-3 py-3 sm:w-[250px]'} flex shrink-0 flex-col justify-between border border-gray-200 bg-white text-left shadow-sm transition hover:border-primary/50 hover:bg-primary/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-primary/10`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                    <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{areaLabel}</div>
                </div>
                {!isSimple && (
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${quality.className}`}>
                        {quality.label}
                    </span>
                )}
            </div>
            <div className={`${isSimple ? 'mt-2' : 'mt-3'} flex items-center gap-3 text-[11px] font-medium text-gray-500 dark:text-gray-400`}>
                {liveViewers > 0 ? <span>{liveViewers} live</span> : <span>{totalViews} views</span>}
                {!isSimple && <span>{totalViews} views</span>}
            </div>
        </button>
    );
}

export default function LandingSmartFeed({
    cameras = [],
    onCameraClick,
    now = new Date(),
    variant = 'default',
}) {
    const isSimple = variant === 'simple';
    const baseSections = buildPublicSmartFeedSections(cameras, now, isSimple ? 3 : 6);
    const simpleSections = ['busy', 'top', 'recommended']
        .map((key) => {
            const existingSection = baseSections.find((section) => section.key === key);
            if (existingSection) {
                return existingSection;
            }

            if (key === 'recommended') {
                const fallbackSection = baseSections.find((section) => section.key === 'top' || section.key === 'busy');
                return fallbackSection
                    ? { key: 'recommended', title: 'Rekomendasi Hari Ini', cameras: fallbackSection.cameras.slice(0, 3) }
                    : null;
            }

            return null;
        })
        .filter(Boolean);
    const sections = isSimple ? simpleSections : baseSections;

    if (sections.length === 0) {
        return null;
    }

    return (
        <section
            data-testid="landing-smart-feed"
            data-variant={variant}
            className={`mx-auto w-full max-w-full overflow-hidden px-3 sm:max-w-7xl sm:px-6 lg:px-8 ${isSimple ? 'py-2' : 'py-3'}`}
        >
            <div className={`${isSimple ? 'space-y-3 rounded-xl p-2' : 'space-y-4 rounded-2xl p-3'} border border-gray-200 bg-white/85 shadow-sm dark:border-gray-800 dark:bg-gray-900/85`}>
                {sections.map((section) => (
                    <div key={section.key} className="min-w-0">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{section.title}</h2>
                            {!isSimple && <span className="text-xs text-gray-500 dark:text-gray-400">{section.cameras.length} kamera</span>}
                        </div>
                        <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                            {section.cameras.map((camera) => (
                                <SmartFeedCameraButton
                                    key={`${section.key}-${camera.id}`}
                                    camera={camera}
                                    onCameraClick={onCameraClick}
                                    now={now}
                                    variant={variant}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
