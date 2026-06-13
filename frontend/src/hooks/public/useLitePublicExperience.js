/*
 * Purpose: Provide a reactive boolean for whether the public landing should run the lightweight ("lite")
 *          experience, recomputing when the user toggles their preference (same-tab event or storage).
 * Caller: LandingPage public controller (passes the resolved device tier in).
 * Deps: React hooks, deviceDetector signals, publicExperienceMode decision/preference helpers.
 * MainFuncs: useLitePreference, useLitePublicExperience.
 * SideEffects: Subscribes to the lite-preference change event and the storage event.
 */

import { useEffect, useMemo, useState } from 'react';
import { isMobileDevice, getConnectionType } from '../../utils/deviceDetector';
import {
    LITE_PREFERENCE_EVENT,
    getLitePreference,
    detectLiteExperience,
    readSaveDataFlag,
} from '../../utils/publicExperienceMode';

/**
 * Track the persisted lite preference reactively. Updates live when the toggle dispatches its event
 * (same tab) or when another tab writes localStorage.
 * @returns {boolean|null} true = force lite, false = force full, null = auto.
 */
export function useLitePreference() {
    const [preference, setPreference] = useState(() => getLitePreference());

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const syncPreference = () => setPreference(getLitePreference());

        window.addEventListener(LITE_PREFERENCE_EVENT, syncPreference);
        window.addEventListener('storage', syncPreference);

        // Pick up any change that happened between the initial render and effect attach.
        syncPreference();

        return () => {
            window.removeEventListener(LITE_PREFERENCE_EVENT, syncPreference);
            window.removeEventListener('storage', syncPreference);
        };
    }, []);

    return preference;
}

/**
 * Resolve the effective lite-experience flag for the public landing.
 * Device/network signals are sampled once per mount (they do not meaningfully change mid-session and
 * sampling once keeps the value stable for memoized children); the user preference stays reactive.
 *
 * @param {Object} [options]
 * @param {'low'|'medium'|'high'} [options.deviceTier] Device tier resolved by the caller (CameraContext).
 * @returns {boolean} True when the lite experience should be used.
 */
export function useLitePublicExperience({ deviceTier = 'medium' } = {}) {
    const preference = useLitePreference();

    const [signals] = useState(() => ({
        isMobile: isMobileDevice(),
        saveData: readSaveDataFlag(),
        effectiveType: getConnectionType(),
    }));

    return useMemo(() => detectLiteExperience({
        tier: deviceTier,
        isMobile: signals.isMobile,
        saveData: signals.saveData,
        effectiveType: signals.effectiveType,
        preference,
    }), [deviceTier, preference, signals]);
}

export default useLitePublicExperience;
