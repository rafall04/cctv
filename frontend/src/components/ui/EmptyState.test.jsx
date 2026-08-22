// @vitest-environment jsdom

/*
 * Purpose: Prove the EmptyState presets render the call-to-action their callers wire up.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * NoStreamsEmptyState declared NO props while Dashboard.jsx had always passed one — React dropped
 * `onAddCamera` in silence, so the empty streams table offered no way out and the navigation wired
 * for it was dead code. guardrails.test.js now catches the DECLARATION going missing again; this
 * catches the other half, that a declared handler actually reaches a button someone can press.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoStreamsEmptyState } from './EmptyState';

describe('NoStreamsEmptyState', () => {
    it('offers the caller a way out of the empty table and calls it', () => {
        const onAddCamera = vi.fn();
        render(<NoStreamsEmptyState onAddCamera={onAddCamera} />);

        fireEvent.click(screen.getByRole('button', { name: 'Kelola Kamera' }));

        expect(onAddCamera).toHaveBeenCalledTimes(1);
    });

    /* No handler, no button — an action that goes nowhere is worse than none. */
    it('renders no action when the caller wires none', () => {
        render(<NoStreamsEmptyState />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByText('Tidak Ada Stream Aktif')).toBeTruthy();
    });
});
