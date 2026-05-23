/*
Purpose: Public-facing "Sponsor Kami" strip listing currently active sponsors by tier.
Caller: LandingFooter (rendered above the copyright row).
Deps: React hooks, sponsorService.getActiveSponsors.
MainFuncs: SponsorStrip.
SideEffects: One GET /api/sponsors/active on mount; silently hides if the request fails.

Note: Sponsors are LOCAL (rendered by us from our DB). This component must
not be used to render external ads-network impressions — those go through
components/ads/* with their own configuration and disclosures.

Tier metadata (name, color, sort_order) is read directly from the sponsor
row — backend `getActiveSponsors` LEFT JOINs sponsor_packages so each
sponsor carries `package_name`, `package_color`, `package_sort_order`.
That keeps the public surface in lockstep with whatever profile catalog
admins are running, including custom keys like "paket-sukamaju", without
any frontend redeploy.
*/

import { useEffect, useMemo, useState } from 'react';
import sponsorService from '../../services/sponsorService';

const COLOR_TO_LABEL_TIER = {
    yellow: 'Sponsor Utama',
    gray: 'Sponsor Pendukung',
    orange: 'Sponsor',
};

// Bigger logos for higher tiers — heuristic based on the package color
// (which admins choose) so a custom "paket emas lokal" with a yellow
// color still gets the gold-tier display size, even with a custom key.
const COLOR_TO_LOGO_HEIGHT = {
    yellow: 'h-16 sm:h-20',
    gray: 'h-12 sm:h-14',
    orange: 'h-10 sm:h-12',
};

function tierKey(sponsor) {
    // Sort_order coming from the JOIN is the authoritative grouping field.
    // Fall back to package key when the row is orphan (catalog deleted).
    const sortOrder = Number(sponsor.package_sort_order ?? 9999);
    return `${String(sortOrder).padStart(5, '0')}:${sponsor.package || 'lainnya'}`;
}

function groupByTier(sponsors) {
    const groups = new Map();
    for (const sponsor of sponsors) {
        const key = tierKey(sponsor);
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                label:
                    sponsor.package_name
                    || COLOR_TO_LABEL_TIER[sponsor.package_color]
                    || 'Sponsor',
                color: sponsor.package_color || 'gray',
                entries: [],
            });
        }
        groups.get(key).entries.push(sponsor);
    }
    // Map keeps insertion order — but groupByTier iterates in sponsor order
    // which is already sorted by backend. Convert to array and re-sort by
    // tier key (sort_order prefix) to be defensive against any reshuffling.
    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function SponsorEntry({ sponsor, color }) {
    const heightClass = COLOR_TO_LOGO_HEIGHT[color] || COLOR_TO_LOGO_HEIGHT.orange;
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
        return () => { mounted = false; };
    }, []);

    const tiers = useMemo(() => groupByTier(sponsors), [sponsors]);

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
                {tiers.map((tier) => (
                    <div key={tier.key} className="space-y-3">
                        <p className="text-center text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                            {tier.label}
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-5">
                            {tier.entries.map((sponsor) => (
                                <SponsorEntry key={sponsor.id} sponsor={sponsor} color={tier.color} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
