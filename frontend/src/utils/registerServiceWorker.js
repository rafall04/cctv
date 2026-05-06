/*
 * Purpose: Register the public PWA service worker when the browser supports it.
 * Caller: frontend/src/main.jsx bootstrap after runtime config loading.
 * Deps: Browser navigator.serviceWorker API.
 * MainFuncs: registerServiceWorker.
 * SideEffects: Registers /sw.js with root scope and logs registration failures.
 */

export async function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
        return;
    }

    try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (error) {
        console.warn('[PWA] Service worker registration failed', error);
    }
}
