/**
 * Purpose: Public landing hero rebuilt as an operational "status deck" — a live
 *          spotlight camera beside a mono metric board, instead of a marketing banner.
 *          The structure is inherently multi-city (city count, spotlight, coverage all
 *          read live data); only the headline/subtitle copy stays branding-driven.
 * Caller: LandingPage full mode.
 * Deps: useCameras, LandingStatsBar (metric board), LandingHeroSpotlight, city rollup,
 *       availability + animation helpers.
 * MainFuncs: LandingHero, pickFeaturedCamera.
 * SideEffects: None (spotlight opens the shared popup via onCameraClick).
 */
import { useMemo } from 'react';
import { useCameras } from '../../contexts/CameraContext';
import LandingStatsBar from './LandingStatsBar';
import LandingHeroSpotlight from './LandingHeroSpotlight';
import { groupCamerasByCity } from '../../utils/publicCityMapping';
import { getCameraAvailabilityState } from '../../utils/cameraAvailability.js';
import { shouldDisableAnimations } from '../../utils/animationControl';

// Most-watched up camera that actually has a thumbnail — the "on air" spotlight.
function pickFeaturedCamera(cameras) {
    let best = null;
    let bestViewers = -1;
    for (const camera of cameras) {
        const state = getCameraAvailabilityState(camera);
        if (state === 'offline' || state === 'maintenance') {
            continue;
        }
        if (!(camera.external_snapshot_url || camera.thumbnail_path)) {
            continue;
        }
        const viewers = Number(camera.live_viewers ?? camera.viewer_stats?.live_viewers ?? 0);
        if (viewers > bestViewers) {
            bestViewers = viewers;
            best = camera;
        }
    }
    return best;
}

export default function Hero({ branding, landingSettings, disableHeavyEffects, onCameraClick }) {
    const { cameras } = useCameras();
    const disableAnimations = shouldDisableAnimations();

    // Copy stays branding-driven (admin-configured); only the two shipped defaults are
    // shortened. Everything structural around it is multi-city by construction.
    const heroTitle = branding.hero_title === 'Pantau CCTV Secara Real-Time'
        ? 'Pantau CCTV Real-Time'
        : branding.hero_title;
    const heroSubtitle = branding.hero_subtitle === 'Pantau CCTV secara real-time dengan sistem CCTV RAF NET. Akses gratis 24 jam untuk memantau berbagai lokasi.'
        ? 'Akses CCTV publik 24 jam dari satu halaman.'
        : branding.hero_subtitle;

    const cityCount = useMemo(() => groupCamerasByCity(cameras).length, [cameras]);
    const featured = useMemo(() => pickFeaturedCamera(cameras), [cameras]);

    return (
        <header className="relative overflow-hidden border-b border-edge bg-surface-sunken">
            {/* Faint instrument grid, faded out toward the content. Heavy-effect gated. */}
            {!disableHeavyEffects && (
                <div
                    className="pointer-events-none absolute inset-0"
                    aria-hidden="true"
                    style={{
                        backgroundImage: 'linear-gradient(var(--edge) 1px, transparent 1px), linear-gradient(90deg, var(--edge) 1px, transparent 1px)',
                        backgroundSize: '34px 34px',
                        WebkitMaskImage: 'radial-gradient(120% 65% at 25% 0%, #000, transparent 72%)',
                        maskImage: 'radial-gradient(120% 65% at 25% 0%, #000, transparent 72%)',
                        opacity: 0.6,
                    }}
                />
            )}

            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
                <div
                    data-testid="landing-hero-badge-stack"
                    className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2"
                >
                    <span className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full bg-status-live ${disableAnimations ? '' : 'animate-pulse'}`}></span>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-status-live">
                            {landingSettings.hero_badge}
                        </span>
                    </span>
                    <span className="h-3 w-px bg-edge-strong" aria-hidden="true"></span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-content-subtle">
                        {cityCount} kota · siaran 24 jam
                    </span>
                    {branding.show_powered_by === 'true' && (
                        <span className="flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-[10px] font-semibold text-content-muted sm:ml-auto">
                            <span className="flex h-4 w-4 items-center justify-center rounded bg-primary text-[9px] font-bold text-white">{branding.logo_text}</span>
                            <span>Powered by {branding.company_name}</span>
                        </span>
                    )}
                </div>

                <h1 className="max-w-3xl text-balance text-3xl font-bold leading-[1.05] tracking-tight text-content sm:text-4xl lg:text-[2.75rem]">
                    {heroTitle}
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-content-muted sm:text-base">
                    {heroSubtitle}
                </p>

                <div className={`mt-6 grid gap-4 ${featured ? 'lg:grid-cols-[1.4fr_1fr] lg:items-stretch' : ''}`}>
                    <LandingHeroSpotlight
                        camera={featured}
                        onOpen={onCameraClick}
                        disableHeavyEffects={disableHeavyEffects}
                    />
                    <LandingStatsBar onCameraClick={onCameraClick} />
                </div>
            </div>
        </header>
    );
}
