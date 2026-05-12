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
    delayMs = 1200,
} = {}) {
    const [shouldRender, setShouldRender] = useState(() => enabled && deviceTier !== 'low');

    useEffect(() => {
        if (!enabled) {
            setShouldRender(false);
            return undefined;
        }

        if (deviceTier !== 'low') {
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
    }, [delayMs, deviceTier, enabled]);

    return shouldRender;
}

export default useDeferredPublicFloatingWidgets;
