import LandingAnnouncementBar from './LandingAnnouncementBar';
import LandingEventBanner from './LandingEventBanner';

export default function LandingPublicTopStack({
    layoutMode = 'full',
    loading = false,
    eventBanner,
    announcement,
}) {
    /*
     * No skeleton while loading: both slots render nothing when their banners are inactive —
     * the common state — so a ~200px placeholder that collapses a second later was a guaranteed
     * layout shift on EVERY visit (the page's largest CLS source, 0.18–0.41 measured). An
     * ACTIVE banner still inserts late, but the index.html inline prefetch usually lands the
     * settings before first paint; paying the shift only when content truly exists beats paying
     * it always.
     */
    if (loading) {
        return null;
    }

    return (
        <>
            <LandingEventBanner banner={eventBanner} layoutMode={layoutMode} />
            <LandingAnnouncementBar announcement={announcement} layoutMode={layoutMode} />
        </>
    );
}
