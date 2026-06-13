// @vitest-environment jsdom

/*
 * Purpose: Verify useDeferredMount mounts synchronously when disabled and defers one frame when enabled.
 * Caller: Frontend Vitest suite.
 * Deps: React, Testing Library, Vitest, useDeferredMount hook.
 * MainFuncs: useDeferredMount tests via a Probe component.
 * SideEffects: None.
 */

import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDeferredMount } from './useDeferredMount';

function Probe({ enabled }) {
    const ready = useDeferredMount({ enabled });
    return createElement('div', null, ready ? 'ready' : 'deferred');
}

describe('useDeferredMount', () => {
    it('mounts synchronously when deferral is disabled (capable devices)', () => {
        render(createElement(Probe, { enabled: false }));
        expect(screen.getByText('ready')).toBeTruthy();
    });

    it('defers on the first render then mounts after a frame when enabled', async () => {
        render(createElement(Probe, { enabled: true }));

        // Heavy subtree is NOT mounted on the first paint...
        expect(screen.getByText('deferred')).toBeTruthy();

        // ...and is mounted shortly after (next animation frame / timeout fallback).
        await waitFor(() => expect(screen.getByText('ready')).toBeTruthy());
    });
});
