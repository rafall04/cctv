/*
 * Purpose: Delay optional public floating widgets on low-end devices until idle or timeout fallback.
 * Caller: LandingPage and LandingPageSimple public shells.
 * Deps: React effects/state and browser idle callback when available.
 * MainFuncs: useDeferredPublicFloatingWidgets.
 * SideEffects: Schedules and cleans idle callback or timeout for low-end widget mounting.
 */

import { useEffect, useState } from 'react';

export function useDeferredPublicFloatingWidgets({
    enabled = true,
    deviceTier = 'medium',
    lite = false,
    delayMs = 1200,
} = {}) {
    // Constrained = low tier OR the broader lite experience (mobile / save-data / slow net / opt-in).
    const constrained = lite === true || deviceTier === 'low';
    const [shouldRender, setShouldRender] = useState(() => enabled && !constrained);

    useEffect(() => {
        if (!enabled) {
            setShouldRender(false);
            return undefined;
        }

        if (!constrained) {
            setShouldRender(true);
            return undefined;
        }

        setShouldRender(false);

        if (typeof window.requestIdleCallback === 'function') {
            const idleId = window.requestIdleCallback(() => {
                setShouldRender(true);
            }, { timeout: delayMs });

            return () => {
                window.cancelIdleCallback?.(idleId);
            };
        }

        const timeoutId = window.setTimeout(() => {
            setShouldRender(true);
        }, delayMs);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [delayMs, constrained, enabled]);

    return shouldRender;
}

export default useDeferredPublicFloatingWidgets;
