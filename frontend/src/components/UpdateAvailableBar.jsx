/*
 * Purpose: Offer a waiting app update instead of forcing a reload on the visitor.
 * Caller: App.jsx, mounted once beside the other global chrome.
 * Deps: React, utils/registerServiceWorker (SW_UPDATE_READY_EVENT).
 * MainFuncs: UpdateAvailableBar.
 * SideEffects: Listens on window for the update-ready event; reloads only via the visitor's tap.
 *
 * Renders nothing until a genuinely newer version is installed and waiting, so it costs an empty
 * render on every page for the ability to never interrupt anyone.
 *
 * The bottom offsets are derived, not eyeballed. Two things already occupy the bottom-right:
 * LandingMobileDock at `bottom-3` (~76px tall including its inset) and FeedbackWidget's bubble at
 * `bottom-24 right-4` / `sm:bottom-6` (~56px tall, so it fills 96–152px on a phone and 24–80px on
 * a desktop). `bottom-40` (160px) and `sm:bottom-24` (96px) sit clear of both. Verified by
 * screenshot: at the first offset I tried, the feedback bubble covered the close button outright.
 */

import { useEffect, useState } from 'react';
import { SW_UPDATE_READY_EVENT } from '../utils/registerServiceWorker.js';

export default function UpdateAvailableBar() {
    const [apply, setApply] = useState(null);

    useEffect(() => {
        const handleUpdateReady = (event) => {
            const accept = event?.detail?.apply;
            // setState with an updater, because React would otherwise CALL a function passed
            // directly — which would apply the update instead of storing it.
            if (typeof accept === 'function') setApply(() => accept);
        };

        window.addEventListener(SW_UPDATE_READY_EVENT, handleUpdateReady);
        return () => window.removeEventListener(SW_UPDATE_READY_EVENT, handleUpdateReady);
    }, []);

    if (!apply) return null;

    return (
        <div
            role="status"
            data-testid="update-available-bar"
            className="fixed inset-x-3 bottom-40 z-toast mx-auto flex max-w-md items-center gap-2 rounded-card border border-edge bg-surface-overlay px-3 py-2 shadow-e2 sm:bottom-24"
        >
            <p className="min-w-0 flex-1 text-sm text-content">
                Versi baru tersedia.
            </p>
            <button
                type="button"
                onClick={() => apply()}
                className="shrink-0 rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
            >
                Muat ulang
            </button>
            <button
                type="button"
                aria-label="Tutup pemberitahuan versi baru"
                onClick={() => setApply(null)}
                className="shrink-0 rounded-control p-1.5 text-content-muted transition-colors hover:bg-surface-raised hover:text-content"
            >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
}
