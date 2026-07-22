/*
 * Purpose: Register the public PWA service worker and force a reload when a new version takes control.
 * Caller: frontend/src/main.jsx bootstrap after runtime config loading.
 * Deps: Browser navigator.serviceWorker API.
 * MainFuncs: registerServiceWorker.
 * SideEffects: Registers /sw.js, listens for SW controller changes (reloads the page on update), and re-checks for updates when the app regains focus.
 */

export async function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

        // Forced auto-reload when a NEW service worker takes control (a deploy landed).
        // The SW self-activates (skipWaiting + clients.claim in sw.js), so a new version
        // claims the page and fires `controllerchange`; we reload once to swap to the new
        // assets — no manual refresh needed.
        //
        // `controllerActivated` guards the FIRST claim on a previously-uncontrolled page
        // (a first visit): that controllerchange is the initial takeover, not an update,
        // so we swallow it. Every controllerchange after that is a real update → reload.
        let controllerActivated = Boolean(navigator.serviceWorker.controller);
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!controllerActivated) {
                controllerActivated = true;
                return;
            }
            if (reloading) {
                return;
            }
            reloading = true;
            window.location.reload();
        });

        // An already-open PWA would otherwise only pick up a new deploy on its next
        // natural navigation. Re-check for a new SW whenever the app regains focus so
        // updates land promptly (the browser byte-compares /sw.js; a new version then
        // installs → activates → triggers the reload above).
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
