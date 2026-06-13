// @vitest-environment jsdom

/*
 * Purpose: Verify DeferUntilVisible renders immediately without IntersectionObserver and otherwise defers
 *          behind a placeholder until the content intersects the viewport.
 * Caller: Frontend Vitest suite.
 * Deps: React, Testing Library, Vitest, DeferUntilVisible component.
 * MainFuncs: DeferUntilVisible tests.
 * SideEffects: Stubs the global IntersectionObserver in jsdom only.
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeferUntilVisible from './DeferUntilVisible';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('DeferUntilVisible', () => {
    it('renders children immediately when IntersectionObserver is unavailable', () => {
        vi.stubGlobal('IntersectionObserver', undefined);

        render(
            <DeferUntilVisible>
                <div data-testid="deferred-child">content</div>
            </DeferUntilVisible>
        );

        expect(screen.getByTestId('deferred-child')).toBeTruthy();
    });

    it('shows a placeholder until the content intersects, then reveals and disconnects', () => {
        let intersectionCallback;
        const observe = vi.fn();
        const disconnect = vi.fn();
        vi.stubGlobal('IntersectionObserver', vi.fn(function FakeObserver(callback) {
            intersectionCallback = callback;
            this.observe = observe;
            this.disconnect = disconnect;
        }));

        render(
            <DeferUntilVisible minHeight={120}>
                <div data-testid="deferred-child">content</div>
            </DeferUntilVisible>
        );

        expect(screen.queryByTestId('deferred-child')).toBeNull();
        expect(screen.getByTestId('defer-until-visible-placeholder')).toBeTruthy();
        expect(observe).toHaveBeenCalledTimes(1);

        act(() => {
            intersectionCallback([{ isIntersecting: true }]);
        });

        expect(screen.getByTestId('deferred-child')).toBeTruthy();
        expect(disconnect).toHaveBeenCalled();
    });
});
