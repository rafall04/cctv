/*
 * Purpose: Accessible confirmation dialog — replaces blocking native window.confirm()
 *   with a themed, keyboard/screen-reader-friendly modal. Rendered by ConfirmProvider.
 * Caller: contexts/ConfirmContext.jsx (via useConfirm()).
 * Deps: React, useFocusTrap.
 * MainFuncs: ConfirmDialog.
 * SideEffects: Traps focus while open; ESC / backdrop click cancel.
 */

import { useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export default function ConfirmDialog({
    title = 'Konfirmasi',
    message = '',
    confirmLabel = 'Ya',
    cancelLabel = 'Batal',
    tone = 'default', // 'default' | 'danger'
    onConfirm,
    onCancel,
}) {
    const dialogRef = useRef(null);
    useFocusTrap(dialogRef, { onEscape: onCancel });

    const confirmClass = tone === 'danger'
        ? 'bg-red-600 hover:bg-red-700'
        : 'bg-primary hover:bg-primary-600';

    return (
        // z above the live popup (z-[1000000]) so a confirm triggered from any
        // surface sits on top.
        <div
            className="fixed inset-0 z-[1000010] flex items-center justify-center bg-black/60 p-4"
            onClick={onCancel}
        >
            <div
                ref={dialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-label={title}
                className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>
                {message && (
                    <p className="mt-2 whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">{message}</p>
                )}
                <div className="mt-5 flex gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="flex-1 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors ${confirmClass}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
