// @vitest-environment jsdom

/*
 * Purpose: Verify the useFocusTrap hook moves focus in, traps Tab/Shift+Tab,
 *   handles Escape, and restores focus on unmount.
 * Caller: Frontend Vitest suite for hooks/useFocusTrap.js.
 * Deps: React Testing Library, Vitest.
 * MainFuncs: useFocusTrap behavior tests.
 * SideEffects: Renders a harness component in jsdom and drives DOM focus.
 */

import { useRef } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from './useFocusTrap.js';

function Harness({ active = true, onEscape }) {
    const ref = useRef(null);
    useFocusTrap(ref, { active, onEscape });
    return (
        <div ref={ref} data-testid="dialog">
            <button type="button">first</button>
            <button type="button">middle</button>
            <button type="button">last</button>
        </div>
    );
}

afterEach(() => {
    cleanup();
});

describe('useFocusTrap', () => {
    it('moves focus into the dialog container on open', () => {
        const { getByTestId } = render(<Harness />);
        expect(document.activeElement).toBe(getByTestId('dialog'));
    });

    it('wraps Tab from the last focusable back to the first', () => {
        const { getByText, getByTestId } = render(<Harness />);
        getByText('last').focus();
        fireEvent.keyDown(getByTestId('dialog'), { key: 'Tab' });
        expect(document.activeElement).toBe(getByText('first'));
    });

    it('wraps Shift+Tab from the first focusable back to the last', () => {
        const { getByText, getByTestId } = render(<Harness />);
        getByText('first').focus();
        fireEvent.keyDown(getByTestId('dialog'), { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(getByText('last'));
    });

    it('calls onEscape when Escape is pressed', () => {
        const onEscape = vi.fn();
        const { getByTestId } = render(<Harness onEscape={onEscape} />);
        fireEvent.keyDown(getByTestId('dialog'), { key: 'Escape' });
        expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('does nothing while inactive', () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();
        render(<Harness active={false} />);
        expect(document.activeElement).toBe(outside);
        document.body.removeChild(outside);
    });

    it('restores focus to the previously-focused element on unmount', () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();
        const { unmount } = render(<Harness />);
        // focus moved into the dialog on mount
        expect(document.activeElement).not.toBe(outside);
        unmount();
        expect(document.activeElement).toBe(outside);
        document.body.removeChild(outside);
    });
});
