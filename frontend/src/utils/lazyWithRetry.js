/*
Purpose: Load lazy chunks so a failed fetch stays recoverable — one reload for a stale deploy, a human way out otherwise, never a dead view.
Caller: App route tree, main.jsx bootstrap, landing lazy panels.
Deps: React lazy/hooks, sessionStorage, navigator.onLine.
MainFuncs: lazyWithRetry, isChunkLoadError.
SideEffects: May reload the page once per chunk key; listens to window online/offline while the recovery card is on screen.
*/

import { createElement, lazy, useCallback, useEffect, useState } from 'react';

export function isChunkLoadError(error) {
    const message = String(error?.message || error || '');
    return (
        message.includes('Failed to fetch dynamically imported module')
        || message.includes('Importing a module script failed')
        || message.includes('ChunkLoadError')
        || message.includes('error loading dynamically imported module')
    );
}

// The browser throws those same four messages for BOTH causes — a stale deploy (the hashed file is
// gone from the server) and a dead network — so the message alone must never decide a reload.
// Reloading a disconnected browser only trades the page for the browser's own error screen; a stale
// deploy is the one case where a reload actually fetches a working index.html.
function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function sessionStore() {
    try {
        return typeof window !== 'undefined' ? window.sessionStorage : null;
    } catch {
        return null;
    }
}

function recoveryCard({ offline, busy, onAction }) {
    return createElement(
        'div',
        { className: 'flex min-h-[260px] w-full items-center justify-center p-6' },
        createElement(
            'div',
            { className: 'w-full max-w-md rounded-card border border-edge bg-surface-raised p-6 text-center shadow-e1' },
            createElement(
                'h2',
                { className: 'mb-2 text-base font-semibold text-content' },
                offline ? 'Koneksi internet terputus' : 'Bagian ini belum selesai dimuat',
            ),
            createElement(
                'p',
                { className: 'mb-5 text-sm text-content-muted' },
                offline
                    ? 'Sebagian halaman belum sempat diunduh. Sambungkan kembali internet, lalu tekan Coba lagi — halaman tidak perlu ditutup.'
                    : 'Sebagian halaman gagal diunduh. Muat ulang untuk mengambilnya sekali lagi.',
            ),
            createElement(
                'button',
                {
                    type: 'button',
                    onClick: onAction,
                    disabled: busy,
                    className: 'rounded-control bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60',
                },
                offline ? 'Coba lagi' : 'Muat ulang',
            ),
        ),
    );
}

// React.lazy caches a REJECTED factory promise forever, so a component that threw once can never
// load again — not on re-render, not on leaving map mode and coming back. The way out is to resolve
// with a component that owns the recovery instead of letting the rejection escape.
//
// It re-imports rather than reloading on sight, but it does NOT pretend that always works: a browser
// keeps a failed module fetch in its module map for the life of the document, so importing the same
// URL again returns the cached failure without touching the network (measured in Chromium: three
// import() calls, one network request, three identical failures). A fresh document is the only
// reliable way back — hence the reload the visitor presses, rather than a spinner that lies.
function createChunkRecovery(importer) {
    return function ChunkRecovery(props) {
        const [Loaded, setLoaded] = useState(null);
        const [offline, setOffline] = useState(isOffline);
        const [busy, setBusy] = useState(false);

        const tryImport = useCallback(async () => {
            setBusy(true);
            try {
                const module = await importer();
                setLoaded(() => module.default);
            } catch {
                setOffline(isOffline());
                setBusy(false);
            }
        }, []);

        useEffect(() => {
            if (typeof window === 'undefined') return undefined;
            // Best effort the moment the network returns; when the module map has already poisoned
            // this URL it simply falls through to the "Muat ulang" card, which does work.
            const handleOnline = () => tryImport();
            const handleOffline = () => setOffline(true);
            window.addEventListener('online', handleOnline);
            window.addEventListener('offline', handleOffline);
            return () => {
                window.removeEventListener('online', handleOnline);
                window.removeEventListener('offline', handleOffline);
            };
        }, [tryImport]);

        if (Loaded) return createElement(Loaded, props);
        return recoveryCard({
            offline,
            busy,
            onAction: offline ? tryImport : () => window.location.reload(),
        });
    };
}

export function lazyWithRetry(importer, key) {
    return lazy(async () => {
        const store = sessionStore();
        const storageKey = `lazy-retry:${key}`;

        try {
            const module = await importer();
            store?.removeItem(storageKey);
            return module;
        } catch (error) {
            // A genuine error inside the module is not a fetch problem — let it reach ErrorBoundary.
            if (!isChunkLoadError(error)) {
                store?.removeItem(storageKey);
                throw error;
            }

            if (store && !isOffline() && store.getItem(storageKey) !== '1') {
                store.setItem(storageKey, '1');
                window.location.reload();
                return new Promise(() => {});
            }

            store?.removeItem(storageKey);
            return { default: createChunkRecovery(importer) };
        }
    });
}

export default lazyWithRetry;
