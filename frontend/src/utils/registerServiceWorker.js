/*
 * Purpose: Register the public PWA service worker and offer a new version instead of forcing it.
 * Caller: frontend/src/main.jsx bootstrap after runtime config loading.
 * Deps: Browser navigator.serviceWorker API.
 * MainFuncs: registerServiceWorker, SW_UPDATE_READY_EVENT.
 * SideEffects: Registers /sw.js, dispatches SW_UPDATE_READY_EVENT on window when an update is
 *   waiting, re-checks for updates when the app regains focus, and reloads ONCE — only after the
 *   visitor accepts.
 *
 * WHY THIS NO LONGER AUTO-RELOADS
 * It used to: sw.js called skipWaiting() + clients.claim(), so a new worker seized the page and
 * `controllerchange` triggered window.location.reload(). Reproduced locally — returning to the app
 * after any deploy reloaded it about 3 seconds in, while it was still settling. Two costs:
 *  - it threw away whatever the visitor was doing (scroll position, playback position, a typed
 *    access key) with no warning and no way to decline;
 *  - between the claim and the reload the page ran OLD html/js under a NEW worker that had already
 *    purged the cache holding the old build's assets. A page missing its stylesheet or a lazy chunk
 *    renders wide and unstyled — which matches the "skewed, black down the right, then it refreshed
 *    and was fine" report exactly. The reload was hiding the damage it had caused.
 * Now the new worker waits, the visitor is offered the update, and the reload happens only because
 * they asked for it.
 */

/** Fired on `window` when a new version is installed and waiting. `detail.apply()` accepts it. */
export const SW_UPDATE_READY_EVENT = 'rafnet:sw-update-ready';

export async function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

        // Reload only ever happens because the visitor accepted — never spontaneously.
        let updateRequested = false;
        let reloading = false;

        const applyUpdate = () => {
            if (!registration.waiting) return;
            updateRequested = true;
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        };

        const announceUpdate = () => {
            if (!registration.waiting) return;
            // A worker waiting on an UNCONTROLLED page is the first install, not an update —
            // there is no older version to replace, so there is nothing to offer.
            if (!navigator.serviceWorker.controller) return;
            if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
            window.dispatchEvent(new CustomEvent(SW_UPDATE_READY_EVENT, { detail: { apply: applyUpdate } }));
        };

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!updateRequested || reloading) return;
            reloading = true;
            window.location.reload();
        });

        registration.addEventListener?.('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
                if (installing.state === 'installed') announceUpdate();
            });
        });

        // A version may already have been waiting since a previous visit.
        announceUpdate();

        // An already-open PWA would otherwise only notice a new deploy on its next natural
        // navigation. Re-check on focus so the offer appears promptly; this is just a check now,
        // so it can no longer surprise anyone.
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    registration.update().catch(() => { /* transient network — retry next focus */ });
                }
            });
        }
    } catch (error) {
        console.warn('[PWA] Service worker registration failed', error);
    }
}
