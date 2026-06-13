/*
 * Purpose: Promise-based confirmation so callers replace blocking window.confirm()
 *   with `await confirm(...)` — same control flow, but an accessible themed dialog.
 * Caller: App provider tree; any component via useConfirm().
 * Deps: React context/state, ConfirmDialog.
 * MainFuncs: ConfirmProvider, useConfirm.
 * SideEffects: Renders a single ConfirmDialog while a confirmation is pending.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
    const [dialog, setDialog] = useState(null);
    const resolveRef = useRef(null);

    // confirm('msg') or confirm({ title, message, confirmLabel, cancelLabel, tone }).
    const confirm = useCallback((options = {}) => {
        const opts = typeof options === 'string' ? { message: options } : (options || {});
        return new Promise((resolve) => {
            resolveRef.current = resolve;
            setDialog({
                title: opts.title || 'Konfirmasi',
                message: opts.message || '',
                confirmLabel: opts.confirmLabel || 'Ya',
                cancelLabel: opts.cancelLabel || 'Batal',
                tone: opts.tone || 'default',
            });
        });
    }, []);

    const settle = useCallback((result) => {
        setDialog(null);
        const resolve = resolveRef.current;
        resolveRef.current = null;
        if (resolve) {
            resolve(result);
        }
    }, []);

    const value = useMemo(() => ({ confirm }), [confirm]);

    return (
        <ConfirmContext.Provider value={value}>
            {children}
            {dialog && (
                <ConfirmDialog
                    {...dialog}
                    onConfirm={() => settle(true)}
                    onCancel={() => settle(false)}
                />
            )}
        </ConfirmContext.Provider>
    );
}

export function useConfirm() {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error('useConfirm must be used within a ConfirmProvider');
    }
    return ctx.confirm;
}

export default ConfirmContext;
