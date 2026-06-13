/*
 * Purpose: Decide whether the public landing should run its lightweight ("lite") experience, combining
 *          device tier, mobile/network signals, and a persisted user preference into one robust gate.
 * Caller: useLitePublicExperience hook, CameraContext refresh cadence, and public landing surfaces.
 * Deps: Browser localStorage/navigator (all access guarded for SSR/jsdom safety).
 * MainFuncs: detectLiteExperience, shouldUseLiteExperience, getLitePreference, setLitePreference, readSaveDataFlag.
 * SideEffects: setLitePreference writes localStorage and dispatches a same-tab preference-change event.
 *
 * Why this exists: device-tier detection (navigator.deviceMemory / hardwareConcurrency) frequently
 * reports real low-end phones as "medium" (deviceMemory is absent on iOS/Firefox and quantized on
 * Android), so keying expensive effects off `tier === 'low'` alone leaves most weak devices unprotected.
 * The reliable signal for "treat as constrained" is `isMobile` plus opt-in Save-Data / slow network,
 * with an explicit user override on top.
 */

import { detectDeviceTier, isMobileDevice, getConnectionType } from './deviceDetector';

export const LITE_PREFERENCE_STORAGE_KEY = 'public_lite_mode';
export const LITE_PREFERENCE_EVENT = 'public-lite-preference-change';

// Effective connection types that should force the lite experience regardless of hardware tier.
const SLOW_EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g']);

/**
 * Read the persisted user preference for the lite experience.
 * @returns {boolean|null} true = force lite, false = force full, null = no explicit choice (auto).
 */
export function getLitePreference() {
    try {
        if (typeof window === 'undefined' || !window.localStorage) {
            return null;
        }
        const value = window.localStorage.getItem(LITE_PREFERENCE_STORAGE_KEY);
        if (value === 'on') {
            return true;
        }
        if (value === 'off') {
            return false;
        }
    } catch {
        // Private mode / disabled storage — fall back to auto.
    }
    return null;
}

/**
 * Persist (or clear) the user's lite-experience preference and notify same-tab listeners.
 * @param {boolean|null} value true = force lite, false = force full, null/undefined = clear (auto).
 */
export function setLitePreference(value) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            if (value === null || value === undefined) {
                window.localStorage.removeItem(LITE_PREFERENCE_STORAGE_KEY);
            } else {
                window.localStorage.setItem(LITE_PREFERENCE_STORAGE_KEY, value ? 'on' : 'off');
            }
        }
    } catch {
        // Ignore storage write failures — the dispatched event still updates the live session.
    }

    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent(LITE_PREFERENCE_EVENT, { detail: value ?? null }));
        }
    } catch {
        // CustomEvent unsupported — listeners simply pick up the change on next mount.
    }
}

/**
 * Read the network Save-Data flag if the browser exposes it.
 * @returns {boolean} True when the user opted into reduced data usage.
 */
export function readSaveDataFlag() {
    if (typeof navigator === 'undefined') {
        return false;
    }
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return Boolean(connection && connection.saveData === true);
}

/**
 * Pure decision: should the lite experience be used given the supplied signals?
 * Precedence (highest first): explicit user preference, Save-Data, low tier, slow network, mobile.
 *
 * @param {Object} options
 * @param {'low'|'medium'|'high'} [options.tier] Device tier.
 * @param {boolean} [options.isMobile] Whether the device is a phone/tablet.
 * @param {boolean} [options.saveData] Whether Save-Data is requested.
 * @param {string} [options.effectiveType] Network effectiveType (e.g. '3g', '4g').
 * @param {boolean|null} [options.preference] Explicit user preference (true/false) or null for auto.
 * @returns {boolean} True when the lite experience should be used.
 */
export function detectLiteExperience({
    tier,
    isMobile = false,
    saveData = false,
    effectiveType,
    preference = null,
} = {}) {
    // An explicit user choice always wins, in either direction.
    if (preference === true) {
        return true;
    }
    if (preference === false) {
        return false;
    }

    if (saveData === true) {
        return true;
    }
    if (tier === 'low') {
        return true;
    }
    if (effectiveType && SLOW_EFFECTIVE_TYPES.has(effectiveType)) {
        return true;
    }
    if (isMobile) {
        return true;
    }
    return false;
}

/**
 * Synchronous, non-reactive lite check for non-React call sites (e.g. CameraContext refresh cadence).
 * Reads every signal fresh from the environment.
 * @returns {boolean} True when the lite experience should be used.
 */
export function shouldUseLiteExperience() {
    return detectLiteExperience({
        tier: detectDeviceTier(),
        isMobile: isMobileDevice(),
        saveData: readSaveDataFlag(),
        effectiveType: getConnectionType(),
        preference: getLitePreference(),
    });
}

export default {
    LITE_PREFERENCE_STORAGE_KEY,
    LITE_PREFERENCE_EVENT,
    getLitePreference,
    setLitePreference,
    readSaveDataFlag,
    detectLiteExperience,
    shouldUseLiteExperience,
};
