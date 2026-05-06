/*
 * Purpose: Provide shared Vitest browser API shims that jsdom does not implement.
 * Caller: Vitest setupFiles before frontend test suites run.
 * Deps: Vitest vi globals and jsdom DOM prototypes.
 * MainFuncs: HTMLMediaElement play/pause/load shims.
 * SideEffects: Replaces jsdom media methods in the test environment only.
 */

import { vi } from 'vitest';

if (typeof HTMLMediaElement !== 'undefined') {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
        configurable: true,
        writable: true,
        value: vi.fn(() => Promise.resolve()),
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
        configurable: true,
        writable: true,
        value: vi.fn(),
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'load', {
        configurable: true,
        writable: true,
        value: vi.fn(),
    });
}
