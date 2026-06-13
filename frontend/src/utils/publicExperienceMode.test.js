// @vitest-environment jsdom

/*
 * Purpose: Verify the lite-experience decision precedence and the persisted preference round-trip/event.
 * Caller: Frontend Vitest suite.
 * Deps: Vitest, jsdom window/localStorage, publicExperienceMode util.
 * MainFuncs: detectLiteExperience and preference storage tests.
 * SideEffects: Writes/clears localStorage in jsdom only.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    detectLiteExperience,
    getLitePreference,
    setLitePreference,
    LITE_PREFERENCE_STORAGE_KEY,
    LITE_PREFERENCE_EVENT,
} from './publicExperienceMode';

describe('detectLiteExperience', () => {
    it('lets an explicit user preference win in both directions', () => {
        expect(detectLiteExperience({ preference: true, tier: 'high', isMobile: false })).toBe(true);
        // Explicit opt-out beats every auto signal.
        expect(detectLiteExperience({
            preference: false,
            isMobile: true,
            saveData: true,
            tier: 'low',
            effectiveType: '2g',
        })).toBe(false);
    });

    it('forces lite for save-data, low tier, slow networks, and mobile', () => {
        expect(detectLiteExperience({ saveData: true })).toBe(true);
        expect(detectLiteExperience({ tier: 'low' })).toBe(true);
        expect(detectLiteExperience({ effectiveType: 'slow-2g' })).toBe(true);
        expect(detectLiteExperience({ effectiveType: '3g' })).toBe(true);
        expect(detectLiteExperience({ isMobile: true })).toBe(true);
    });

    it('stays full for a medium desktop on a fast network', () => {
        expect(detectLiteExperience({ tier: 'medium', isMobile: false, effectiveType: '4g' })).toBe(false);
        expect(detectLiteExperience({})).toBe(false);
    });
});

describe('lite preference storage', () => {
    beforeEach(() => {
        try {
            window.localStorage.clear();
        } catch {
            /* ignore */
        }
    });

    it('round-trips on/off/clear through localStorage', () => {
        expect(getLitePreference()).toBeNull();

        setLitePreference(true);
        expect(window.localStorage.getItem(LITE_PREFERENCE_STORAGE_KEY)).toBe('on');
        expect(getLitePreference()).toBe(true);

        setLitePreference(false);
        expect(getLitePreference()).toBe(false);

        setLitePreference(null);
        expect(window.localStorage.getItem(LITE_PREFERENCE_STORAGE_KEY)).toBeNull();
        expect(getLitePreference()).toBeNull();
    });

    it('dispatches a same-tab preference-change event', () => {
        const handler = vi.fn();
        window.addEventListener(LITE_PREFERENCE_EVENT, handler);

        setLitePreference(true);

        expect(handler).toHaveBeenCalledTimes(1);
        window.removeEventListener(LITE_PREFERENCE_EVENT, handler);
    });
});
