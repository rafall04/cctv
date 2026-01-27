/**
 * Monetag Service Worker
 * Required for push notifications
 * 
 * IMPORTANT: Ganti YOUR_MONETAG_TOKEN dengan token dari Monetag dashboard
 */

(function() {
    'use strict';

    // Monetag Configuration
    const MONETAG_TOKEN = 'YOUR_MONETAG_TOKEN'; // Ganti dengan token Anda dari Monetag
    
    // Service Worker Installation
    self.addEventListener('install', function(event) {
        console.log('[Monetag SW] Service Worker installing...');
        self.skipWaiting();
    });

    // Service Worker Activation
    self.addEventListener('activate', function(event) {
        console.log('[Monetag SW] Service Worker activated');
        event.waitUntil(self.clients.claim());
    });

    // Push Notification Handler
    self.addEventListener('push', function(event) {
        console.log('[Monetag SW] Push notification received');
        
        if (event.data) {
            const data = event.data.json();
            const options = {
                body: data.body || 'New notification',
                icon: data.icon || '/icon-192x192.png',
                badge: data.badge || '/badge-72x72.png',
                data: data.data || {},
                requireInteraction: false,
                tag: data.tag || 'monetag-notification'
            };

            event.waitUntil(
                self.registration.showNotification(data.title || 'RAF NET CCTV', options)
            );
        }
    });

    // Notification Click Handler
    self.addEventListener('notificationclick', function(event) {
        console.log('[Monetag SW] Notification clicked');
        event.notification.close();

        event.waitUntil(
            clients.openWindow(event.notification.data.url || '/')
        );
    });

    // Monetag Script Loader
    if (MONETAG_TOKEN && MONETAG_TOKEN !== 'YOUR_MONETAG_TOKEN') {
        importScripts('https://alwingulla.com/88/tag.min.js');
        
        // Initialize Monetag
        self.addEventListener('message', function(event) {
            if (event.data && event.data.type === 'MONETAG_INIT') {
                console.log('[Monetag SW] Initializing Monetag...');
            }
        });
    } else {
        console.warn('[Monetag SW] Token not configured. Please update MONETAG_TOKEN.');
    }
})();
