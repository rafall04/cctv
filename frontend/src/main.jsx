/*
Purpose: Bootstrap the React application after loading backend-provided runtime configuration.
Caller: Browser module loader from index.html.
Deps: React, ReactDOM, runtimeConfig, App, global CSS.
MainFuncs: bootstrap.
SideEffects: Loads runtime config, mounts React into #root, logs bootstrap failures.
*/

import React from 'react';
import ReactDOM from 'react-dom/client';
import { loadRuntimeConfig } from './config/runtimeConfig.js';
import { registerServiceWorker } from './utils/registerServiceWorker.js';
import './index.css';

async function bootstrap() {
    // Don't block first paint on the runtime-config network round-trip. Kick it off (it caches itself
    // for getApiUrl()) and render as soon as the App chunk is parsed. apiClient resolves its base URL
    // per request, so early calls use the same-origin relative fallback and later calls pick up the
    // resolved config — one fewer round-trip before the page appears.
    loadRuntimeConfig().catch((error) => {
        console.warn('Runtime config load failed; using fallback:', error?.message);
    });
    const { default: App } = await import('./App.jsx');
    ReactDOM.createRoot(document.getElementById('root')).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
    registerServiceWorker();
}

bootstrap().catch((error) => {
    console.error('Failed to bootstrap app:', error);
});
