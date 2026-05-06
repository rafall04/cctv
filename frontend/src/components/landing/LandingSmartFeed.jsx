/*
 * Purpose: Render compact public discovery feed sections derived from live camera quality and viewer activity.
 * Caller: LandingPage and LandingPageSimple public surfaces.
 * Deps: landingCameraInsights utility and caller-provided camera click handler.
 * MainFuncs: LandingSmartFeed.
 * SideEffects: Invokes caller-provided camera click handler.
 */

import { buildPublicSmartFeedSections, getPublicCameraQuality } from '../../utils/landingCameraInsights';

function SmartFeedCameraButton({ camera, onCameraClick, now }) {
    const quality = getPublicCameraQuality(camera, now);
    const areaLabel = camera.area_name || camera.location || 'Area publik';

    return (
        <button
            type="button"
            onClick={() => onCameraClick?.(camera)}
            className="flex min-h-[72px] w-[min(17rem,calc(100vw-3rem))] shrink-0 flex-col justify-between rounded-2xl border border-gray-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-primary/50 hover:bg-primary/5 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-primary/10 sm:w-[250px]"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{camera.name}</div>
                    <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{areaLabel}</div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${quality.className}`}>
                    {quality.label}
                </span>
            </div>
            <div className="mt-3 flex items-center gap-3 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                <span>{Number(camera.live_viewers || camera.viewer_stats?.live_viewers || 0)} live</span>
                <span>{Number(camera.total_views || camera.viewer_stats?.total_views || 0)} views</span>
            </div>
        </button>
    );
}

export default function LandingSmartFeed({
    cameras = [],
    onCameraClick,
    now = new Date(),
}) {
    const sections = buildPublicSmartFeedSections(cameras, now);

    if (sections.length === 0) {
        return null;
    }

    return (
        <section data-testid="landing-smart-feed" className="mx-auto w-full max-w-full overflow-hidden px-3 py-3 sm:max-w-7xl sm:px-6 lg:px-8">
            <div className="space-y-4 rounded-2xl border border-gray-200 bg-white/85 p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900/85">
                {sections.map((section) => (
                    <div key={section.key} className="min-w-0">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{section.title}</h2>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{section.cameras.length} kamera</span>
                        </div>
                        <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                            {section.cameras.map((camera) => (
                                <SmartFeedCameraButton
                                    key={`${section.key}-${camera.id}`}
                                    camera={camera}
                                    onCameraClick={onCameraClick}
                                    now={now}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
