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
    // Overlap the runtime-config network round-trip with the App chunk download/parse instead of
    // serializing them — removes one blocking round-trip before first paint on slow links. App still
    // renders only after config resolves, so getApiUrl() is ready before any API call.
    const [, appModule] = await Promise.all([
        loadRuntimeConfig(),
        import('./App.jsx'),
    ]);
    const { default: App } = appModule;
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
