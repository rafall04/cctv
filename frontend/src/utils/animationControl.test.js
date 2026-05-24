// @vitest-environment jsdom

/*
Purpose: Lock the device-tier + reduce-motion gating semantics for decorative animations.
Caller: Vitest frontend utility suite.
Deps: vitest, React Testing Library, animationControl module.
MainFuncs: prefersReducedMotion, shouldDisableAnimations, useReducedMotion, useAnimationGate tests.
SideEffects: Stubs window.matchMedia and the deviceDetector module.
*/

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted device tier mock so we can flip it between tests without
// touching the actual deviceDetector implementation.
const { detectDeviceTierMock } = vi.hoisted(() => ({
    detectDeviceTierMock: vi.fn(() => 'medium'),
}));

vi.mock('../utils/deviceDetector', () => ({
    detectDeviceTier: detectDeviceTierMock,
}));

// Minimal MediaQueryList stub. Each created list keeps its own change
// listeners so a test can flip `matches` and fire `change` to verify the
// hook reacts.
function createMediaQueryStub(initialMatches) {
    const listeners = new Set();
    const stub = {
        matches: initialMatches,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: (type, listener) => {
            if (type === 'change') listeners.add(listener);
        },
        removeEventListener: (type, listener) => {
            if (type === 'change') listeners.delete(listener);
        },
        // Legacy Safari API kept for parity with the production hook.
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
        dispatchEvent: () => true,
        _set(matches) {
            stub.matches = matches;
            for (const listener of listeners) listener({ matches });
        },
    };
    return stub;
}

let currentMediaQueryStub;

beforeEach(() => {
    detectDeviceTierMock.mockReset();
    detectDeviceTierMock.mockReturnValue('medium');
    currentMediaQueryStub = createMediaQueryStub(false);
    window.matchMedia = vi.fn(() => currentMediaQueryStub);
});

afterEach(() => {
    delete window.matchMedia;
});

describe('prefersReducedMotion', () => {
    it('returns false when the matchMedia query reports no preference', async () => {
        const { prefersReducedMotion } = await import('./animationControl.js');
        expect(prefersReducedMotion()).toBe(false);
    });

    it('returns true when the matchMedia query reports reduce-motion', async () => {
        currentMediaQueryStub._set(true);
        const { prefersReducedMotion } = await import('./animationControl.js');
        expect(prefersReducedMotion()).toBe(true);
    });

    it('returns false when matchMedia is unavailable (older browsers / SSR snapshot)', async () => {
        delete window.matchMedia;
        const { prefersReducedMotion } = await import('./animationControl.js');
        expect(prefersReducedMotion()).toBe(false);
    });

    it('returns false when matchMedia throws synchronously', async () => {
        window.matchMedia = vi.fn(() => { throw new Error('blocked by feature policy'); });
        const { prefersReducedMotion } = await import('./animationControl.js');
        expect(prefersReducedMotion()).toBe(false);
    });
});

describe('shouldDisableAnimations', () => {
    it('disables on a low-end device regardless of motion preference', async () => {
        detectDeviceTierMock.mockReturnValue('low');
        currentMediaQueryStub._set(false);
        const { shouldDisableAnimations } = await import('./animationControl.js');
        expect(shouldDisableAnimations()).toBe(true);
    });

    it('disables when reduce-motion is requested even on a high-end device', async () => {
        detectDeviceTierMock.mockReturnValue('high');
        currentMediaQueryStub._set(true);
        const { shouldDisableAnimations } = await import('./animationControl.js');
        expect(shouldDisableAnimations()).toBe(true);
    });

    it('keeps animations on for medium-tier devices with no reduce-motion preference', async () => {
        detectDeviceTierMock.mockReturnValue('medium');
        currentMediaQueryStub._set(false);
        const { shouldDisableAnimations } = await import('./animationControl.js');
        expect(shouldDisableAnimations()).toBe(false);
    });

    it('honors explicit option overrides over the live environment', async () => {
        detectDeviceTierMock.mockReturnValue('high');
        currentMediaQueryStub._set(false);
        const { shouldDisableAnimations } = await import('./animationControl.js');
        expect(shouldDisableAnimations({ reducedMotion: true })).toBe(true);
        expect(shouldDisableAnimations({ tier: 'low', reducedMotion: false })).toBe(true);
    });
});

describe('getAdaptiveAnimationClass', () => {
    it('returns the static fallback under reduce-motion', async () => {
        currentMediaQueryStub._set(true);
        const { getAdaptiveAnimationClass } = await import('./animationControl.js');
        // Pulse must keep the element visible (opacity-75), spinning
        // indicators reduce to nothing — see ANIMATION_MAPPINGS rationale.
        expect(getAdaptiveAnimationClass('pulse')).toBe('opacity-75');
        expect(getAdaptiveAnimationClass('spin')).toBe('');
    });

    it('returns the animated class when neither gate fires', async () => {
        detectDeviceTierMock.mockReturnValue('medium');
        currentMediaQueryStub._set(false);
        const { getAdaptiveAnimationClass } = await import('./animationControl.js');
        expect(getAdaptiveAnimationClass('pulse')).toBe('animate-pulse');
        expect(getAdaptiveAnimationClass('spin')).toBe('animate-spin');
    });
});

describe('useReducedMotion / useAnimationGate', () => {
    it('flips reactively when the OS-level preference changes mid-session', async () => {
        currentMediaQueryStub._set(false);
        const { useReducedMotion } = await import('./animationControl.js');

        const { result } = renderHook(() => useReducedMotion());
        expect(result.current).toBe(false);

        act(() => {
            currentMediaQueryStub._set(true);
        });
        expect(result.current).toBe(true);

        act(() => {
            currentMediaQueryStub._set(false);
        });
        expect(result.current).toBe(false);
    });

    it('removes the change listener on unmount so it doesn\'t leak', async () => {
        currentMediaQueryStub._set(false);
        const { useReducedMotion } = await import('./animationControl.js');

        const { unmount } = renderHook(() => useReducedMotion());
        unmount();

        // After unmount, dispatching a change must not throw (no stale
        // listeners reaching into a torn-down component).
        expect(() => currentMediaQueryStub._set(true)).not.toThrow();
    });

    it('combines device tier with the live motion preference', async () => {
        detectDeviceTierMock.mockReturnValue('low');
        currentMediaQueryStub._set(false);
        const { useAnimationGate } = await import('./animationControl.js');

        const { result } = renderHook(() => useAnimationGate());
        // Tier=low → gate fires regardless of motion preference.
        expect(result.current).toBe(true);
    });

    it('falls back to legacy addListener / removeListener on Safari < 14', async () => {
        // Hide the modern addEventListener so the hook falls back to the
        // deprecated API. Should still subscribe + unsubscribe cleanly.
        const stub = createMediaQueryStub(false);
        delete stub.addEventListener;
        delete stub.removeEventListener;
        stub.addListener = vi.fn();
        stub.removeListener = vi.fn();
        window.matchMedia = vi.fn(() => stub);

        const { useReducedMotion } = await import('./animationControl.js');
        const { unmount } = renderHook(() => useReducedMotion());

        expect(stub.addListener).toHaveBeenCalled();
        unmount();
        expect(stub.removeListener).toHaveBeenCalled();
    });
});
