/**
 * App Config Service
 *
 * Business logic for the public runtime configuration, version info, and the dynamic PWA manifest.
 * Route files (configRoutes.js) delegate here so they stay thin — no DB access or business logic
 * in the route layer.
 */

import { config } from '../config/config.js';
import { query } from '../database/connectionPool.js';
import { PUBLIC_LIVE_SQL } from '../utils/cameraVisibility.js';

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
        // Branding lives in `branding_settings` (brandingService.js is the source of truth), NOT the
        // general `settings` table. Reading `settings` here returned {} so the PWA manifest always
        // fell back to "CCTV System"/#0ea5e9 no matter what the buyer set in the admin panel.
        const settings = query(
            "SELECT key, value FROM branding_settings WHERE key LIKE 'company_%' OR key LIKE 'meta_%' OR key = 'primary_color'"
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
        name: 'RAF CCTV',
        version: versionInfo.appVersion,
        buildId: versionInfo.buildId,
        environment: config.server.env,
        timestamp: new Date().toISOString(),
    };
}

export function getManifest() {
    return buildManifestFromBranding(loadBrandingSettings());
}

const SITEMAP_STATIC_ROUTES = ['/', '/dukungan', '/sewa', '/daftar'];

function xmlEscape(value) {
    return String(value).replace(/[<>&'"]/g, (c) => (
        { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
    ));
}

/**
 * GET /sitemap.xml — crawlable public entry points: the static public pages plus every
 * area page that actually carries public cameras (the same rule the area route uses, so a
 * slug with zero public cameras — e.g. an owner_private-only area — never leaks into it).
 */
export function buildSitemapXml({ protocol = 'https', hostname } = {}) {
    const origin = `${protocol}://${hostname || config.security.frontendDomain || 'localhost'}`;
    const areas = query(`
        SELECT COALESCE(a.slug, LOWER(REPLACE(a.name, ' ', '-'))) AS slug
        FROM areas a
        WHERE EXISTS (
            SELECT 1 FROM cameras c
            WHERE c.area_id = a.id AND c.enabled = 1 AND ${PUBLIC_LIVE_SQL}
        )
        ORDER BY slug
    `);

    const today = new Date().toISOString().slice(0, 10);
    const urls = [
        ...SITEMAP_STATIC_ROUTES.map((path) => ({ loc: `${origin}${path}`, priority: path === '/' ? '1.0' : '0.7' })),
        ...areas.map((a) => ({ loc: `${origin}/area/${xmlEscape(a.slug)}`, priority: '0.8' })),
    ];

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map(({ loc, priority }) => `  <url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>${priority}</priority></url>`),
        '</urlset>',
    ].join('\n');
}
