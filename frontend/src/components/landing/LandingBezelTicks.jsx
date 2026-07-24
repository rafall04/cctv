/*
 * Purpose: The "instrument bezel" — four corner registration ticks, the recurring
 *          monitor/command-deck motif for prominent public-landing panels (hero
 *          spotlight, status board). Shared so the motif has a single source and
 *          Full + Simple modes stay visually identical.
 * Caller: LandingHeroSpotlight (full deck) and LandingPageSimple status board.
 * Deps: None (pure presentational overlay; parent must be `position: relative`).
 * MainFuncs: LandingBezelTicks.
 * SideEffects: None.
 */

export default function LandingBezelTicks() {
    return (
        <span className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
            <span className="absolute left-0 top-0 h-2 w-2 border-l border-t border-edge-strong"></span>
            <span className="absolute right-0 top-0 h-2 w-2 border-r border-t border-edge-strong"></span>
            <span className="absolute bottom-0 left-0 h-2 w-2 border-b border-l border-edge-strong"></span>
            <span className="absolute bottom-0 right-0 h-2 w-2 border-b border-r border-edge-strong"></span>
        </span>
    );
}
