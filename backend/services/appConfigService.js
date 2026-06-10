/**
 * App Config Service
 *
 * Business logic for the public runtime configuration, version info, and the dynamic PWA manifest.
 * Route files (configRoutes.js) delegate here so they stay thin — no DB access or business logic
 * in the route layer.
 */

import { config } from '../config/config.js';
import { query } from '../database/connectionPool.js';

export function getAppVersionInfo() {
    return {
        appVersion: process.env.APP_VERSION || '1.0.0',
        buildId: process.env.APP_BUILD_ID
            || process.env.GIT_COMMIT_SHA
            || process.env.RENDER_GIT_COMMIT
            || process.env.SOURCE_COMMIT
            || 'unknown',
    };
}

export function buildManifestFromBranding(branding = {}) {
    return {
        name: branding.meta_title || branding.company_name || 'CCTV System',
        short_name: branding.company_name || 'CCTV',
        description: branding.meta_description || 'Pantau CCTV secara online dan live streaming 24 jam',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: branding.primary_color || '#0ea5e9',
        orientation: 'any',
        icons: [
            {
                src: '/favicon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any maskable'
            },
            {
                src: '/favicon-192x192.png',
                sizes: '192x192',
                type: 'image/png'
            },
            {
                src: '/favicon-512x512.png',
                sizes: '512x512',
                type: 'image/png'
            }
        ],
        categories: ['security', 'utilities'],
        lang: 'id',
        dir: 'ltr'
    };
}

function loadBrandingSettings() {
    try {
        const settings = query(
            "SELECT key, value FROM settings WHERE key LIKE 'company_%' OR key LIKE 'meta_%' OR key = 'primary_color'"
        );

        return settings.reduce((acc, setting) => {
            acc[setting.key] = setting.value;
            return acc;
        }, {});
    } catch (error) {
        console.warn('[ConfigRoutes] Failed to load branding settings for manifest:', error.message);
        return {};
    }
}

/**
 * Build the public runtime configuration payload.
 * @param {Object} params
 * @param {string} params.protocol - Detected request protocol ('http' | 'https')
 * @param {string} params.hostname - Request hostname (fallback for frontendDomain)
 */
export function getPublicRuntimeConfig({ protocol, hostname } = {}) {
    const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
    const versionInfo = getAppVersionInfo();

    return {
        // In the Single-Port Nginx Architecture, we use relative paths for everything.
        apiUrl: '/api',
        frontendDomain: config.security.frontendDomain || hostname,
        serverIp: config.security.serverIp || '',
        portPublic: process.env.PORT_PUBLIC || '800',
        protocol,
        wsProtocol,
        appVersion: versionInfo.appVersion,
        buildId: versionInfo.buildId,
        timestamp: new Date().toISOString(),
    };
}

export function getVersionInfo() {
    const versionInfo = getAppVersionInfo();
    return {
        name: 'RAF NET CCTV',
        version: versionInfo.appVersion,
        buildId: versionInfo.buildId,
        environment: config.server.env,
        timestamp: new Date().toISOString(),
    };
}

export function getManifest() {
    return buildManifestFromBranding(loadBrandingSettings());
}
