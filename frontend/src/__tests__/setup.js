/*
 * Purpose: Provide shared Vitest browser API shims that jsdom does not implement, and unmount
 *   rendered trees between tests.
 * Caller: Vitest setupFiles before frontend test suites run.
 * Deps: Vitest vi/afterEach globals, jsdom DOM prototypes, @testing-library/react cleanup.
 * MainFuncs: HTMLMediaElement play/pause/load shims, per-test DOM cleanup.
 * SideEffects: Replaces jsdom media methods and unmounts React trees, test environment only.
 */

import { afterEach, vi } from 'vitest';

/*
 * Unmount between tests. Without this, every render in a file stacks into the same document, so a
 * second render makes getByRole ambiguous ("found multiple elements") and any component that
 * mutates global state on mount — a dialog locking body scroll, say — never gets to undo it. It
 * only stayed invisible because the default runner gives each FILE a fresh worker; the moment
 * files share a process (a low-memory single-fork run) the leak becomes failures that have nothing
 * to do with the code under test.
 *
 * Guarded on `document` because backend-style specs run in the node environment, where importing
 * the DOM testing library would throw.
 */
if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    afterEach(() => {
        cleanup();
    });
}

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
