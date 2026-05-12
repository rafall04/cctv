/*
 * Purpose: Verify low-end public floating widget deferral without mounting the full landing shell.
 * Caller: Vitest focused low-end public UI optimization suite.
 * Deps: React, Testing Library, Vitest, and useDeferredPublicFloatingWidgets.
 * MainFuncs: useDeferredPublicFloatingWidgets tests.
 * SideEffects: Uses fake timers in jsdom only.
 */

import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDeferredPublicFloatingWidgets } from './useDeferredPublicFloatingWidgets';

function Probe(props) {
    const shouldRender = useDeferredPublicFloatingWidgets(props);
    return createElement('div', null, shouldRender ? 'ready' : 'deferred');
}

describe('useDeferredPublicFloatingWidgets', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders immediately for non-low-end devices', () => {
        render(createElement(Probe, { deviceTier: 'medium' }));

        expect(screen.getByText('ready')).toBeTruthy();
    });

    it('defers rendering on low-end devices until the timeout fallback', () => {
        vi.useFakeTimers();

        render(createElement(Probe, { deviceTier: 'low', delayMs: 1000 }));

        expect(screen.getByText('deferred')).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(screen.getByText('ready')).toBeTruthy();
    });

    it('keeps widgets hidden when disabled', () => {
        render(createElement(Probe, { enabled: false, deviceTier: 'medium' }));

        expect(screen.getByText('deferred')).toBeTruthy();
    });
});
