import LandingAnnouncementBar from './LandingAnnouncementBar';
import LandingEventBanner from './LandingEventBanner';

function BannerSkeleton({ className }) {
    return (
        <div
            className={`overflow-hidden rounded-card border border-edge bg-surface ${className}`}
            aria-hidden="true"
        >
            <div className="animate-pulse px-4 py-3 sm:px-6 sm:py-4">
                <div className="h-3 w-24 rounded-full bg-surface-sunken" />
                <div className="mt-3 h-4 w-full rounded-full bg-surface-sunken" />
                <div className="mt-2 h-4 w-3/4 rounded-full bg-surface-sunken" />
            </div>
        </div>
    );
}

export default function LandingPublicTopStack({
    layoutMode = 'full',
    loading = false,
    eventBanner,
    announcement,
}) {
    if (loading) {
        return (
            <div
                data-testid={`landing-top-stack-shell-${layoutMode}`}
                className={layoutMode === 'simple' ? 'border-b border-edge' : ''}
            >
                <div className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${layoutMode === 'simple' ? 'py-3 space-y-3' : 'pt-3 pb-2 space-y-3'}`}>
                    <BannerSkeleton className={layoutMode === 'simple' ? 'min-h-[84px]' : 'min-h-[110px]'} />
                    <BannerSkeleton className={layoutMode === 'simple' ? 'min-h-[72px]' : 'min-h-[88px]'} />
                </div>
            </div>
        );
    }

    return (
        <>
            <LandingEventBanner banner={eventBanner} layoutMode={layoutMode} />
            <LandingAnnouncementBar announcement={announcement} layoutMode={layoutMode} />
        </>
    );
}
