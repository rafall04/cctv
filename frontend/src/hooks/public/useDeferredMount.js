/*
 * Purpose: Delay mounting an expensive subtree until AFTER the cheap shell has painted, so first paint
 *          is not blocked by heavy synchronous mount work (building indexes, rendering many cards).
 * Caller: LandingPageSimple (defers the camera workspace under the lite experience).
 * Deps: React state/ref/effect hooks and the browser animation-frame timer (with a timeout fallback).
 * MainFuncs: useDeferredMount.
 * SideEffects: Schedules and cancels an animation frame / timeout.
 *
 * Unlike DeferUntilVisible (which waits for scroll/IntersectionObserver), this fires as soon as the
 * first frame has painted — right for above-the-fold content that should appear immediately but whose
 * heavy mount can wait one frame so the shell is visible first.
 */

import { useEffect, useRef, useState } from 'react';

export function useDeferredMount({ enabled = true } = {}) {
    // When deferral is disabled (capable devices), mount synchronously — no skeleton flash, no change.
    const [ready, setReady] = useState(() => !enabled);
    // Once mounted, stay mounted: never re-defer if `enabled` flips later (e.g. user toggles "Hemat").
    const settledRef = useRef(!enabled);

    useEffect(() => {
        if (settledRef.current) {
            return undefined;
        }
        if (!enabled) {
            settledRef.current = true;
            setReady(true);
            return undefined;
        }

        const settle = () => {
            settledRef.current = true;
            setReady(true);
        };

        let raf1 = 0;
        let raf2 = 0;
        let timer = 0;

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            // Double rAF: let the cheap shell commit AND paint before we mount the heavy subtree.
            raf1 = window.requestAnimationFrame(() => {
                raf2 = window.requestAnimationFrame(settle);
            });
        } else {
            timer = setTimeout(settle, 16);
        }

        return () => {
            if (raf1 && typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(raf1);
            }
            if (raf2 && typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(raf2);
            }
            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [enabled]);

    return ready;
}

export default useDeferredMount;
