import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

window.addEventListener('vite:preloadError', (event) => {
    console.warn('[App] Vite preload error detected:', event?.payload || event);
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }
});

window.addEventListener('unhandledrejection', (event) => {
    const message = String(event?.reason?.message || event?.reason || '');
    if (message.includes("reading 'payload'") || message.includes('vite:preloadError')) {
        console.warn('[App] Suppressed known preload/payload rejection:', message);
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
    }
});

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
