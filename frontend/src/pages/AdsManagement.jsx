/*
Purpose: Standalone admin page for the external ads-network configuration (AdSense, Adsterra, PropellerAds, etc.).
Caller: Protected admin /admin/ads route.
Deps: AdsSettingsPanel.
MainFuncs: AdsManagement.
SideEffects: None at this level — AdsSettingsPanel owns the actual settings reads/writes.

Note: Ads (external network scripts rendered through components/ads/*) are
deliberately separated from Sponsors (local entities we render ourselves
via SponsorBadge / SponsorStrip). Sponsors and Ads sit as sibling pages
in the admin sidebar, never bundled under Settings, so reviewers know
exactly which concern lives where.
*/

import AdsSettingsPanel from '../components/admin/settings/AdsSettingsPanel';

export default function AdsManagement() {
    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Manajemen Iklan</h1>
                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                    Konfigurasi script iklan eksternal (AdSense / Adsterra / PropellerAds dsb).
                    <span className="ml-1 text-gray-400 dark:text-gray-500">
                        Sponsor lokal — logo yang kita render sendiri — diatur di halaman Sponsors, terpisah.
                    </span>
                </p>
            </div>
            <AdsSettingsPanel />
        </div>
    );
}
