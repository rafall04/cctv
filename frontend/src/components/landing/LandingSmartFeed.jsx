/*
 * Purpose: Render compact public discovery feed sections derived from live camera quality and viewer activity, with a tighter simple-mode variant.
 * Caller: LandingPage and LandingPageSimple public surfaces.
 * Deps: React memo hooks, landingCameraInsights utility, and caller-provided camera click handler.
 * MainFuncs: LandingSmartFeed.
 * SideEffects: Invokes caller-provided camera click handler.
 */

import { memo, useMemo } from 'react';
import { buildPublicSmartFeedSections, getPublicCameraQuality } from '../../utils/landingCameraInsights';

const SmartFeedCameraButton = memo(function SmartFeedCameraButton({ camera, onCameraClick, now, variant = 'default' }) {
    const quality = getPublicCameraQuality(camera, now);
    const areaLabel = camera.area_name || camera.location || 'Area publik';
    const liveViewers = Number(camera.live_viewers || camera.viewer_stats?.live_viewers || 0);
    const totalViews = Number(camera.total_views || camera.viewer_stats?.total_views || 0);
    const isSimple = variant === 'simple';
    // Same rule as the landing card: a chip that lands on every item is decoration.
    // Only `busy`/`new` actually single a camera out; the default bucket does not.
    const showQuality = !isSimple && (quality?.key === 'busy' || quality?.key === 'new');

    return (
        <button
            type="button"
            onClick={() => onCameraClick?.(camera)}
            className={`${isSimple ? 'min-h-[56px] w-[min(13rem,calc(100vw-3rem))] rounded-control px-3 py-2 sm:w-48' : 'min-h-[72px] w-[min(17rem,calc(100vw-3rem))] rounded-card px-3 py-3 sm:w-[250px]'} flex shrink-0 flex-col justify-between border border-edge bg-surface text-left transition-colors hover:border-edge-strong hover:bg-primary/5`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-content">{camera.name}</div>
                    <div className="mt-0.5 truncate text-xs text-content-muted">{areaLabel}</div>
                </div>
                {showQuality && (
                    <span className="shrink-0 text-[11px] font-medium text-primary">
                        {quality.label}
                    </span>
                )}
            </div>
            {/*
             * The old markup rendered `{totalViews} views` twice whenever a camera had
             * no live viewers in full mode — the ternary fell back to total views and
             * the next line printed it again ("1303 views 1303 views" was live on prod).
             * Live is now purely additive, and total views renders exactly once.
             */}
            <div className={`${isSimple ? 'mt-2' : 'mt-3'} flex items-center gap-3 text-[11px] font-medium tabular-nums text-content-muted`}>
                {liveViewers > 0 && <span>{liveViewers} live</span>}
                {(!isSimple || liveViewers === 0) && <span>{totalViews} views</span>}
            </div>
        </button>
    );
});

export default function LandingSmartFeed({
    cameras = [],
    onCameraClick,
    now: nowProp,
    variant = 'default',
}) {
    const isSimple = variant === 'simple';
    // Sample "now" once per mount when the caller does not pass it. A default param of `new Date()`
    // created a fresh object every render, busting this memo (re-sorting/filtering all cameras each
    // render) and the memoized camera buttons below. Day-granularity drift over a session is harmless.
    const fallbackNow = useMemo(() => new Date(), []);
    const now = nowProp ?? fallbackNow;
    const sections = useMemo(() => {
        const baseSections = buildPublicSmartFeedSections(cameras, now, isSimple ? 3 : 6);

        if (!isSimple) {
            return baseSections;
        }

        return ['busy', 'top', 'recommended']
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
    }, [cameras, isSimple, now]);

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
