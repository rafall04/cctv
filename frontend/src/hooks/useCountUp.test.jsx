// @vitest-environment jsdom

/*
 * Purpose: Lock the count-up contract — real numbers animate with an ease-out and land
 *   exactly on the target, while the '…' placeholder, a `disabled` flag, and the
 *   reduced-motion/low-end gate all pass the target through untouched.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library renderHook, useCountUp hook, stubbed RAF + animation gate.
 * MainFuncs: useCountUp render tests.
 * SideEffects: Stubs requestAnimationFrame/cancelAnimationFrame during each test.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountUp } from './useCountUp.js';

let animationsDisabled = false;

vi.mock('../utils/animationControl', () => ({
    shouldDisableAnimations: () => animationsDisabled,
}));

// Deterministic RAF: callbacks queue here and are fired manually with explicit
// timestamps, so a 600 ms animation can be stepped frame by frame.
let pendingFrames = [];

const nextFrame = (timestamp) => {
    const callback = pendingFrames.shift();
    if (callback) {
        act(() => callback(timestamp));
    }
};

beforeEach(() => {
    animationsDisabled = false;
    pendingFrames = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        pendingFrames.push(callback);
        return pendingFrames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('useCountUp', () => {
    it('animates from the previous value and lands exactly on the target', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useCountUp(value, { duration: 600 }),
            { initialProps: { value: 0 } },
        );

        // Nothing to animate while the displayed value already equals the target.
        expect(result.current).toBe(0);
        expect(requestAnimationFrame).not.toHaveBeenCalled();

        rerender({ value: 100 });
        expect(pendingFrames).toHaveLength(1);

        nextFrame(0); // animation start — easeOutCubic(0) = 0
        expect(result.current).toBe(0);

        nextFrame(300); // halfway in time, 87.5% in value (ease-out)
        expect(result.current).toBe(88);

        nextFrame(600); // t = 1 — must land exactly, not on a rounded in-between
        expect(result.current).toBe(100);
        expect(pendingFrames).toHaveLength(0);
    });

    it('returns the target untouched when disabled', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useCountUp(value, { disabled: true }),
            { initialProps: { value: 10 } },
        );

        rerender({ value: 40 });
        expect(result.current).toBe(40);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('passes the … placeholder through, then counts from 0 once a number arrives', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useCountUp(value, { duration: 600 }),
            { initialProps: { value: '…' } },
        );

        expect(result.current).toBe('…');
        expect(requestAnimationFrame).not.toHaveBeenCalled();

        rerender({ value: 40 });
        nextFrame(0);
        expect(result.current).toBe(0);
        nextFrame(600);
        expect(result.current).toBe(40);
    });

    it('skips the animation entirely when motion is gated off', () => {
        animationsDisabled = true;
        const { result, rerender } = renderHook(
            ({ value }) => useCountUp(value),
            { initialProps: { value: 5 } },
        );

        rerender({ value: 80 });
        expect(result.current).toBe(80);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('cancels the pending frame on unmount', () => {
        const { rerender, unmount } = renderHook(
            ({ value }) => useCountUp(value, { duration: 600 }),
            { initialProps: { value: 0 } },
        );

        rerender({ value: 100 });
        unmount();
        expect(cancelAnimationFrame).toHaveBeenCalled();
    });
});
