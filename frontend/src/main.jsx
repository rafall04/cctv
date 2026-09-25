/*
Purpose: Bootstrap the React application after loading backend-provided runtime configuration.
Caller: Browser module loader from index.html.
Deps: React, ReactDOM, runtimeConfig, lazyWithRetry, App, global CSS.
MainFuncs: bootstrap, AppShell.
SideEffects: Loads runtime config, mounts React into #root, registers the service worker once the app chunk mounts.
*/

import React, { Suspense, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { loadRuntimeConfig } from './config/runtimeConfig.js';
import { registerServiceWorker } from './utils/registerServiceWorker.js';
import lazyWithRetry from './utils/lazyWithRetry.js';
import './index.css';

// Not a bare `await import()`: when that rejected, #root stayed empty forever and the visitor got a
// white page whose only explanation was a console line. lazyWithRetry retries, and failing that
// renders a recovery card with a "Coba lagi" button.
const App = lazyWithRetry(() => import('./App.jsx'), 'app-shell');

// StrictMode remounts effects in dev; the guard keeps the registration (and its listeners) single.
let serviceWorkerStarted = false;

function AppShell() {
    // Registered from here, not from bootstrap(): the effect runs only after the App chunk has
    // mounted, so UpdateAvailableBar is already listening when the update-ready event fires.
    useEffect(() => {
        if (serviceWorkerStarted) return;
        serviceWorkerStarted = true;
        registerServiceWorker();
    }, []);

    return <App />;
}

function bootstrap() {
    // Don't block first paint on the runtime-config network round-trip. Kick it off (it caches itself
    // for getApiUrl()) and render as soon as the App chunk is parsed. apiClient resolves its base URL
    // per request, so early calls use the same-origin relative fallback and later calls pick up the
    // resolved config — one fewer round-trip before the page appears.
    loadRuntimeConfig().catch((error) => {
        console.warn('Runtime config load failed; using fallback:', error?.message);
    });
    /*
     * Mount on the NEXT frame, not inside this task. createRoot().render() wipes
     * #root — including the SSI-injected #boot-lcp-img — and under CPU throttling
     * the eval long-task starves every paint until mount, so the already-decoded
     * image never reaches a frame and can't be an LCP candidate. A double rAF
     * yields exactly one post-eval paint (the thumbnail lands in it), then React
     * takes over. The timeout is the no-frames path (hidden tab / headless): the
     * page must still boot even when rAF never fires.
     */
    let mounted = false;
    const mount = () => {
        if (mounted) return;
        mounted = true;
        ReactDOM.createRoot(document.getElementById('root')).render(
            <React.StrictMode>
                <Suspense
                    fallback={
                        <div className="flex min-h-screen items-center justify-center bg-surface-sunken">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-edge border-t-primary" />
                        </div>
                    }
                >
                    <AppShell />
                </Suspense>
            </React.StrictMode>
        );
    };
    requestAnimationFrame(() => requestAnimationFrame(mount));
    setTimeout(mount, 800);
}

try {
    bootstrap();
} catch (error) {
    console.error('Failed to bootstrap app:', error);
}
