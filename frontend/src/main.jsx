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
    await loadRuntimeConfig();
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
