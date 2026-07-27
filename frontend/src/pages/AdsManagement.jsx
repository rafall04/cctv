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
import { PageHeader } from '../components/ui';

export default function AdsManagement() {
    return (
        <div className="space-y-5">
            <PageHeader
                title="Iklan"
                description="Script iklan pihak ketiga (AdSense / Adsterra / PropellerAds) per placement. Sponsor lokal diatur terpisah di halaman Sponsor."
            />
            <AdsSettingsPanel />
        </div>
    );
}
