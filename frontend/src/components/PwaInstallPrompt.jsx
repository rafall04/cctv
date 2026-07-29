/*
 * Purpose: Render a delayed dismissible public/admin PWA install toast when the browser exposes install capability.
 * Caller: App route shell inside BrowserRouter.
 * Deps: React hooks, React Router location, beforeinstallprompt event, localStorage.
 * MainFuncs: PwaInstallPrompt, getPromptConfig.
 * SideEffects: Captures install prompt event, calls prompt(), and stores dismissal state.
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const PUBLIC_DISMISS_KEY = 'rafnet_pwa_prompt_dismissed';
const ADMIN_DISMISS_KEY = 'rafnet_admin_pwa_prompt_dismissed';
const DEFAULT_DELAY_MS = 11000;

// Bump when either manifest changes: `public/` files are copied unhashed, and the edge serves them
// immutable for a year — an edited manifest sat at the CDN for 30 days once. Identity is pinned by
// the manifest's own `id`, so a query string here cannot orphan an installed app.
const MANIFEST_VERSION = '1';
const PUBLIC_MANIFEST = `/site.webmanifest?v=${MANIFEST_VERSION}`;
const ADMIN_MANIFEST = `/admin.webmanifest?v=${MANIFEST_VERSION}`;

function isStandaloneDisplay() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true;
}

/**
 * Point <link rel="manifest"> at the admin app while on /admin, and back at the public app
 * otherwise. This is what makes "Install" on an admin page install ADMIN — same origin, same
 * bundle, but its own name, icon, start_url and shortcuts. Without it the browser installs
 * whatever single manifest the document shipped with, so an admin who installed from /admin got
 * an app called "CCTV System" that opened the public landing page.
 */
function useRouteManifest(isAdminRoute) {
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const link = document.querySelector('link[rel="manifest"]');
        if (!link) return;
        const next = isAdminRoute ? ADMIN_MANIFEST : PUBLIC_MANIFEST;
        if (link.getAttribute('href') !== next) {
            link.setAttribute('href', next);
        }
    }, [isAdminRoute]);
}

export default function PwaInstallPrompt({ delayMs = DEFAULT_DELAY_MS }) {
    const location = useLocation();
    const [installEvent, setInstallEvent] = useState(null);
    const [visible, setVisible] = useState(false);
    const isAdminRoute = location.pathname.startsWith('/admin');
    const config = isAdminRoute
        ? {
            dismissKey: ADMIN_DISMISS_KEY,
            title: 'Install CCTV Admin',
            body: 'Buka admin lebih cepat untuk cek kamera, health, analytics, dan token playback.',
            className: 'bottom-24 sm:bottom-6',
        }
        : {
            dismissKey: PUBLIC_DISMISS_KEY,
            title: 'Install CCTV System',
            body: 'Buka lebih cepat dari layar utama tanpa mencari browser lagi.',
            className: 'top-20',
        };

    useRouteManifest(isAdminRoute);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        /*
         * The event is captured in index.html, BEFORE React exists — it fires once per page load
         * and a listener attached later just misses it. So the primary source is the stash left on
         * `window`; the listener below only covers the case where React somehow mounted first.
         *
         * Each capture also records WHICH app it belongs to. The browser binds the event to the
         * manifest linked at fire time and never re-binds it, so after a client-side move from /
         * to /admin the captured event still installs the PUBLIC app while the toast says "Admin".
         */
        const adopt = () => {
            if (window.__deferredInstallPrompt) {
                setInstallEvent(window.__deferredInstallPrompt);
            }
        };
        adopt();

        const handleBeforeInstallPrompt = (event) => {
            event.preventDefault();
            setInstallEvent({
                event,
                manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') || '',
            });
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('rafnet:installprompt', adopt);
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('rafnet:installprompt', adopt);
        };
    }, []);

    // True only when the captured event installs the app this route is actually about.
    const matchesRoute = Boolean(installEvent)
        && installEvent.manifest.includes(isAdminRoute ? 'admin.webmanifest' : 'site.webmanifest');

    useEffect(() => {
        if (!installEvent || !matchesRoute || isStandaloneDisplay()
            || localStorage.getItem(config.dismissKey) === 'true') {
            setVisible(false);
            return undefined;
        }

        const timer = window.setTimeout(() => setVisible(true), delayMs);
        return () => window.clearTimeout(timer);
    }, [delayMs, installEvent, matchesRoute, config.dismissKey]);

    const dismiss = () => {
        localStorage.setItem(config.dismissKey, 'true');
        setVisible(false);
    };

    const install = async () => {
        if (!installEvent) {
            dismiss();
            return;
        }

        await installEvent.event.prompt();
        await installEvent.event.userChoice.catch(() => null);
        dismiss();
    };

    if (!visible) {
        return null;
    }

    return (
        <div
            data-testid="pwa-install-prompt"
            className={`fixed left-4 right-4 z-[99997] rounded-2xl border border-sky-200 bg-white p-4 shadow-2xl dark:border-sky-500/20 dark:bg-gray-900 sm:left-auto sm:right-6 sm:max-w-sm ${config.className}`}
        >
            <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                    <span className="text-lg font-black">+</span>
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold text-gray-900 dark:text-white">{config.title}</h2>
                    <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-400">
                        {config.body}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={install}
                            className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white transition hover:bg-primary-600"
                        >
                            Install
                        </button>
                        <button
                            type="button"
                            onClick={dismiss}
                            className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                            Nanti
                        </button>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={dismiss}
                    className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    aria-label="Tutup prompt"
                >
                    x
                </button>
            </div>
        </div>
    );
}
