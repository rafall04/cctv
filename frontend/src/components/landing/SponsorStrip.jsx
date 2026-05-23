/*
Purpose: Public-facing "Sponsor Kami" strip listing currently active sponsors by tier.
Caller: LandingFooter (rendered above the copyright row).
Deps: React hooks, sponsorService.getActiveSponsors, shared sponsorPackages catalog.
MainFuncs: SponsorStrip.
SideEffects: One GET /api/sponsors/active on mount; silently hides if the request fails.

Note: Sponsors are LOCAL (rendered by us from our DB). This component must
not be used to render external ads-network impressions — those go through
components/ads/* with their own configuration and disclosures.
*/

import { useEffect, useMemo, useState } from 'react';
import sponsorService from '../../services/sponsorService';
import {
    SPONSOR_PACKAGE_DISPLAY_ORDER,
    getPackageInfo,
} from '../../utils/sponsorPackages.js';

const TIER_LABELS = {
    gold: 'Sponsor Utama',
    silver: 'Sponsor Pendukung',
    bronze: 'Sponsor',
};

const TIER_LOGO_HEIGHT = {
    gold: 'h-16 sm:h-20',
    silver: 'h-12 sm:h-14',
    bronze: 'h-10 sm:h-12',
};

function groupByPackage(sponsors) {
    const groups = { gold: [], silver: [], bronze: [] };
    for (const sponsor of sponsors) {
        const key = SPONSOR_PACKAGE_DISPLAY_ORDER.includes(sponsor.package)
            ? sponsor.package
            : 'bronze';
        groups[key].push(sponsor);
    }
    return groups;
}

function SponsorEntry({ sponsor, tierKey }) {
    const heightClass = TIER_LOGO_HEIGHT[tierKey] || TIER_LOGO_HEIGHT.bronze;
    const inner = sponsor.logo ? (
        <img
            src={sponsor.logo}
            alt={sponsor.name}
            loading="lazy"
            className={`${heightClass} max-w-[160px] object-contain transition-transform duration-200 group-hover:scale-105`}
        />
    ) : (
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 group-hover:text-primary-500">
            {sponsor.name}
        </span>
    );

    const wrapperClass =
        'group flex items-center justify-center rounded-xl bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md dark:bg-gray-800';

    if (!sponsor.url) {
        return (
            <div className={wrapperClass} title={sponsor.name}>
                {inner}
            </div>
        );
    }

    return (
        <a
            href={sponsor.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className={wrapperClass}
            title={sponsor.name}
        >
            {inner}
        </a>
    );
}

export default function SponsorStrip() {
    const [sponsors, setSponsors] = useState([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let mounted = true;
        sponsorService.getActiveSponsors().then((response) => {
            if (!mounted) return;
            if (response?.success && Array.isArray(response.data)) {
                setSponsors(response.data);
            }
            setLoaded(true);
        });
        return () => {
            mounted = false;
        };
    }, []);

    const grouped = useMemo(() => groupByPackage(sponsors), [sponsors]);

    // Hide the section entirely until we know there is something to show.
    // The footer has its own existing content; an empty "Sponsor Kami"
    // block would just be noise.
    if (!loaded || sponsors.length === 0) {
        return null;
    }

    return (
        <section
            data-testid="landing-sponsor-strip"
            className="mb-8 border-t border-gray-100 pt-8 dark:border-gray-800"
        >
            <h4 className="mb-5 text-center text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Sponsor Kami
            </h4>
            <div className="space-y-6">
                {SPONSOR_PACKAGE_DISPLAY_ORDER.map((tierKey) => {
                    const entries = grouped[tierKey];
                    if (!entries.length) return null;
                    const tierInfo = getPackageInfo(tierKey);
                    return (
                        <div key={tierKey} className="space-y-3">
                            <p className="text-center text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                {TIER_LABELS[tierKey] || tierInfo?.name || tierKey}
                            </p>
                            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-5">
                                {entries.map((sponsor) => (
                                    <SponsorEntry
                                        key={sponsor.id}
                                        sponsor={sponsor}
                                        tierKey={tierKey}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
