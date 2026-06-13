/*
 * Purpose: Reusable focus management for modal dialogs — move focus into the
 *   dialog on open, trap Tab/Shift+Tab inside it, restore focus to the
 *   previously-focused element on close, and optionally close on Escape.
 *   Lets existing custom-layout overlays become keyboard/screen-reader
 *   accessible WITHOUT restructuring their markup.
 * Caller: VideoPopup and other overlay/dialog components.
 * Deps: React (useEffect/useRef).
 * MainFuncs: useFocusTrap.
 * SideEffects: Moves DOM focus and adds/removes a capture-phase keydown listener.
 */

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
}

/**
 * Trap focus inside `containerRef` while `active`.
 *
 * @param {React.RefObject<HTMLElement>} containerRef - dialog container element
 * @param {Object} [options]
 * @param {boolean} [options.active=true] - whether the trap is engaged
 * @param {(e: KeyboardEvent) => void} [options.onEscape] - called on Escape (optional;
 *   omit if the caller already handles Escape itself to avoid double-handling)
 */
export function useFocusTrap(containerRef, { active = true, onEscape } = {}) {
    const previouslyFocusedRef = useRef(null);
    // Keep onEscape in a ref so an inline/changing callback does NOT re-run the
    // effect every render (which would steal focus back to the dialog repeatedly).
    const onEscapeRef = useRef(onEscape);
    useEffect(() => {
        onEscapeRef.current = onEscape;
    }, [onEscape]);

    useEffect(() => {
        if (!active) return undefined;
        const container = containerRef.current;
        if (!container || typeof document === 'undefined') return undefined;

        // Remember what had focus so we can return it when the dialog closes.
        previouslyFocusedRef.current = document.activeElement;

        // Move focus into the dialog itself (not a specific control, which is
        // less surprising). It needs a tabindex to be programmatically focusable.
        if (!container.hasAttribute('tabindex')) {
            container.setAttribute('tabindex', '-1');
        }
        container.focus();

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                onEscapeRef.current?.(e);
                return;
            }
            if (e.key !== 'Tab') return;

            const items = getFocusable(container);
            if (items.length === 0) {
                // Nothing focusable inside — keep focus on the dialog.
                e.preventDefault();
                return;
            }

            const first = items[0];
            const last = items[items.length - 1];
            const activeEl = document.activeElement;

            if (e.shiftKey) {
                if (activeEl === first || !container.contains(activeEl)) {
                    e.preventDefault();
                    last.focus();
                }
            } else if (activeEl === last || !container.contains(activeEl)) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown, true);

        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            const previous = previouslyFocusedRef.current;
            if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
                previous.focus();
            }
        };
    }, [active, containerRef]);
}

export default useFocusTrap;
