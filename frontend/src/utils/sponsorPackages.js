/*
Purpose: Shared sponsor-package definitions (label, default price, color, features, camera quota).
Caller: Admin SponsorManagement page and any public sponsor surface (SponsorBadge wiring, sponsor strip).
Deps: None.
MainFuncs: SPONSOR_PACKAGE_KEYS, SPONSOR_PACKAGES, getPackageInfo, getPackageColor.
SideEffects: None.

Note: Sponsors are LOCAL entities (logos we render ourselves). They are
intentionally distinct from the ads-network feature (AdSense / Adsterra /
PropellerAds) handled in components/ads/. Do not extend this file with
ad-network keys — those belong to the ads config.

The pricing here is the default tier price (Rp). Per-row sponsor prices
are still editable in the admin form for custom deals; the DB stores the
actual price on each sponsor row. This module just gives the UI a stable
catalog to render package cards, pre-fill the price when switching tiers,
and color the tier badges consistently across pages.
*/

export const SPONSOR_PACKAGE_KEYS = ['bronze', 'silver', 'gold'];

export const SPONSOR_PACKAGES = {
    bronze: {
        key: 'bronze',
        name: 'Bronze',
        price: 500_000,
        color: 'orange',
        cameraQuota: 1,
        features: [
            'Logo di 1 kamera',
            'Mention di deskripsi',
            'Link ke website',
        ],
    },
    silver: {
        key: 'silver',
        name: 'Silver',
        price: 1_500_000,
        color: 'gray',
        cameraQuota: 3,
        features: [
            'Logo di 3 kamera',
            'Banner di landing page',
            'Social media mention',
            'Dedicated page',
        ],
    },
    gold: {
        key: 'gold',
        name: 'Gold',
        price: 3_000_000,
        color: 'yellow',
        cameraQuota: null, // null = semua kamera
        features: [
            'Logo di semua kamera',
            'Banner premium',
            'Dedicated page',
            'Social media promo',
            'Monthly report',
        ],
    },
};

export function getPackageInfo(packageKey) {
    return SPONSOR_PACKAGES[packageKey] || null;
}

/**
 * Map package key → Tailwind color name used for badges/labels. Falls
 * back to neutral gray so the UI never breaks on legacy/unknown values.
 */
export function getPackageColor(packageKey) {
    return SPONSOR_PACKAGES[packageKey]?.color || 'gray';
}

/**
 * Stable display order: Gold first, then Silver, then Bronze. Matches the
 * backend SELECT ordering so admin and public lists stay consistent.
 */
export const SPONSOR_PACKAGE_DISPLAY_ORDER = ['gold', 'silver', 'bronze'];
