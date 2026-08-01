/*
 * Purpose: The one dialog shell for admin surfaces — scrim, focus trap, Escape, labelled heading.
 * Caller: admin pages/components (via components/ui barrel).
 * Deps: React, hooks/useFocusTrap.
 * MainFuncs: Modal, ModalFooter.
 * SideEffects: Traps focus while mounted; Escape and scrim click both request close; locks body
 *   scroll so the page behind cannot be scrolled away under the dialog.
 *
 * Why this exists: 11 admin files hand-rolled a dialog. Between them there were 2 role="dialog",
 * 2 aria-modal, 2 focus traps and ZERO Escape handlers — so most admin dialogs could not be closed
 * from the keyboard and leaked focus to the page behind. They also all sat at z-50, the same layer
 * as the sidebar, leaving the stacking order to DOM accident; `z-modal` is deliberately above it.
 */

import { useEffect, useId, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { IconButton } from './Button';

const SIZES = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
};

function CloseIcon() {
    return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
    );
}

/**
 * @param {string} title required — becomes the dialog's accessible name via aria-labelledby
 * @param {Function} onClose called by Escape, the close button and a scrim click
 * @param {'sm'|'md'|'lg'|'xl'} [size='md']
 * @param {React.ReactNode} [footer] action row pinned below the scrollable body
 * @param {boolean} [dismissible=true] set false for a step the user must resolve explicitly
 * @param {string} [bodyClassName] override the body padding — pass '' so media can bleed to the
 *   edges. On a phone the default px-4 costs 32px of width from the one thing that matters.
 * @param {React.RefObject} [bodyRef] the scrollable body element. A dialog whose content filters
 *   (a picker with a search box) has to return the list to the top itself; without this a caller
 *   would have to reach for the body by class name, coupling it to this file's internals.
 */
export function Modal({
    title,
    description,
    onClose,
    size = 'md',
    footer = null,
    dismissible = true,
    className = '',
    bodyClassName = 'px-4 py-4',
    bodyRef = null,
    children,
}) {
    const dialogRef = useRef(null);
    const titleId = useId();
    const descId = useId();

    useFocusTrap(dialogRef, { onEscape: dismissible ? onClose : undefined });

    // The page behind must not scroll while a dialog owns the screen — otherwise a wheel/touch
    // gesture aimed at the dialog scrolls the route underneath it.
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    return (
        <div
            className="fixed inset-0 z-modal flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
            onClick={dismissible ? onClose : undefined}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descId : undefined}
                onClick={(e) => e.stopPropagation()}
                className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-card border border-edge bg-surface-overlay shadow-e2 sm:rounded-card ${
                    SIZES[size] ?? SIZES.md
                } ${className}`}
            >
                <div className="flex items-start justify-between gap-3 border-b border-edge px-4 py-3">
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-sm font-semibold text-content">{title}</h2>
                        {description && <p id={descId} className="mt-1 text-xs text-content-muted">{description}</p>}
                    </div>
                    {dismissible && (
                        <IconButton label="Tutup dialog" size="sm" onClick={onClose} className="-mr-2 -mt-1">
                            <CloseIcon />
                        </IconButton>
                    )}
                </div>

                <div ref={bodyRef} className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>

                {footer && (
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-edge bg-surface px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:pb-3">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Convenience wrapper when a caller builds the footer inline rather than via the `footer` prop. */
export function ModalFooter({ className = '', children }) {
    return <div className={`flex flex-wrap items-center justify-end gap-2 ${className}`}>{children}</div>;
}
