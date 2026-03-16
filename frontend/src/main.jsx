import React from 'react';
import ReactDOM from 'react-dom/client';
import { loadRuntimeConfig } from './config/runtimeConfig.js';
import './index.css';

async function bootstrap() {
    await loadRuntimeConfig();
    const { default: App } = await import('./App.jsx');

    ReactDOM.createRoot(document.getElementById('root')).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}

bootstrap().catch((error) => {
    console.error('Failed to bootstrap app:', error);
});
