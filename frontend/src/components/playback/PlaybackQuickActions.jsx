/*
 * Purpose: Render compact public playback navigation actions for live CCTV and area routes.
 * Caller: Playback page public scope.
 * Deps: React Router Link, publicGrowthShare URL helpers.
 * MainFuncs: PlaybackQuickActions.
 * SideEffects: Navigates to public routes.
 */

import { Link } from 'react-router-dom';
import { buildCameraUrl } from '../../utils/publicGrowthShare.js';

const Icons = {
    Play: () => (
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
        </svg>
    ),
    MapPin: () => (
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
        </svg>
    ),
    Home: () => (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
    ),
};

function ActionLink({ to, icon, label, description, variant = 'neutral' }) {
    const baseClass = 'flex min-h-[3.5rem] min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition';
    const variantClass = variant === 'primary'
        ? 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 dark:border-primary/30 dark:bg-primary/10'
        : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:bg-gray-800';

    return (
        <Link to={to} className={`${baseClass} ${variantClass}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-current shadow-sm ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10">
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{label}</span>
                <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{description}</span>
            </span>
        </Link>
    );
}

export default function PlaybackQuickActions({
    selectedCamera = null,
}) {
    const liveHref = selectedCamera ? buildCameraUrl(selectedCamera, '') : '/';
    const areaSlug = selectedCamera?.area_slug || selectedCamera?.areaSlug || null;
    const areaHref = areaSlug ? `/area/${encodeURIComponent(areaSlug)}` : null;
    const areaLabel = selectedCamera?.area_name || selectedCamera?.areaName || 'Area publik';
    const cameraLabel = selectedCamera?.name || 'kamera ini';

    if (!selectedCamera) {
        return null;
    }

    return (
        <nav
            data-testid="playback-quick-actions"
            className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            aria-label="Aksi cepat playback publik"
        >
            <div className="mb-2 min-w-0">
                <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">Aksi Cepat</div>
                <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {cameraLabel} - {areaLabel}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ActionLink
                    to={liveHref}
                    icon={<Icons.Play />}
                    label="Buka CCTV Live"
                    description="Lihat kamera aktif"
                    variant="primary"
                />
                {areaHref ? (
                    <ActionLink
                        to={areaHref}
                        icon={<Icons.MapPin />}
                        label="Buka Area"
                        description="Kembali ke area publik"
                    />
                ) : (
                    <ActionLink
                        to="/"
                        icon={<Icons.Home />}
                        label="Beranda"
                        description="Kembali ke CCTV publik"
                    />
                )}
            </div>
        </nav>
    );
}
