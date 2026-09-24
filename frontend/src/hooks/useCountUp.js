/*
 * Purpose: Ease an integer from its previously displayed value to a new target over a
 *   short window (default 650 ms), so a refreshing metric reads as motion instead of an
 *   instant numeral swap. The '…' "belum diketahui" placeholder — and any other
 *   non-finite input — passes through untouched: a placeholder is not a number and must
 *   never be animated toward.
 * Caller: LandingStatsBar metric cells (any numeral that updates in place).
 * Deps: shouldDisableAnimations (low-end device + prefers-reduced-motion gate).
 * MainFuncs: useCountUp.
 * SideEffects: Runs a requestAnimationFrame loop while animating; cancelled on unmount
 *   or when the target changes mid-flight.
 */

import { useEffect, useRef, useState } from 'react';
import { shouldDisableAnimations } from '../utils/animationControl.js';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export function useCountUp(target, { duration = 650, disabled = false } = {}) {
    const [display, setDisplay] = useState(target);
    // Mirrors `display` so a retarget mid-animation starts from whatever is on
    // screen, not from a stale closure.
    const displayRef = useRef(target);

    useEffect(() => {
        // A placeholder like '…' (or any non-numeric leftover) counts from 0.
        const from = Number.isFinite(displayRef.current) ? displayRef.current : 0;

        if (
            disabled
            || !Number.isFinite(target)
            || !Number.isFinite(duration)
            || duration <= 0
            || shouldDisableAnimations()
            || from === target
        ) {
            displayRef.current = target;
            setDisplay(target);
            return undefined;
        }

        let rafId;
        let startTime = null;
        const step = (timestamp) => {
            if (startTime === null) {
                startTime = timestamp;
            }
            const progress = Math.min((timestamp - startTime) / duration, 1);
            const next = progress >= 1
                ? target
                : Math.round(from + (target - from) * easeOutCubic(progress));
            displayRef.current = next;
            setDisplay(next);
            if (progress < 1) {
                rafId = requestAnimationFrame(step);
            }
        };

        rafId = requestAnimationFrame(step);
        return () => cancelAnimationFrame(rafId);
    }, [target, duration, disabled]);

    return display;
}
