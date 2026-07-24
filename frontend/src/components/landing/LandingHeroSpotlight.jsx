/*
 * Purpose: Featured "on air" camera for the public hero status deck — a light,
 *          tap-to-watch thumbnail (no autoplay video, so it stays cheap on mobile)
 *          that proves the network is live the moment the page loads.
 * Caller: LandingHero (full-mode status deck).
 * Deps: CameraThumbnail, publicCityMapping (city label).
 * MainFuncs: LandingHeroSpotlight.
 * SideEffects: None (opens the shared video popup via onOpen).
 */

import CameraThumbnail from '../CameraThumbnail';
import LandingBezelTicks from './LandingBezelTicks';
import { getAreaCity } from '../../utils/publicCityMapping';

export default function LandingHeroSpotlight({ camera, onOpen, disableHeavyEffects = false }) {
    if (!camera) {
        return null;
    }

    const city = getAreaCity(camera.area_name).label || camera.area_name || '';
    const viewers = Number(camera.live_viewers ?? camera.viewer_stats?.live_viewers ?? 0);

    return (
        <button
            type="button"
            onClick={() => onOpen?.(camera)}
            aria-label={`Tonton siaran langsung ${camera.name}`}
            className="group relative flex flex-col overflow-hidden rounded-card border border-edge bg-surface text-left transition-colors hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-data"
        >
            <LandingBezelTicks />
            <div className="relative aspect-video overflow-hidden bg-black">
                <CameraThumbnail
                    thumbnailPath={camera.external_snapshot_url || camera.thumbnail_path}
                    cameraName={camera.name}
                />
                {!disableHeavyEffects && (
                    <span
                        className="pointer-events-none absolute inset-0 z-10"
                        aria-hidden="true"
                        style={{ backgroundImage: 'repeating-linear-gradient(0deg,rgba(0,0,0,0.16) 0 1px,transparent 1px 3px)' }}
                    />
                )}
                <span className="absolute left-2.5 top-2.5 z-20 flex items-center gap-1.5 rounded-full border border-status-live/60 bg-black/55 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur-sm">
                    <span className={`h-1.5 w-1.5 rounded-full bg-status-live ${disableHeavyEffects ? '' : 'animate-pulse'}`}></span>
                    Live
                </span>
                <span className="pointer-events-none absolute inset-0 z-20 grid place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="grid h-12 w-12 place-items-center rounded-full border border-white/40 bg-black/55 backdrop-blur-sm">
                        <svg viewBox="0 0 24 24" fill="#fff" className="h-5 w-5"><path d="M8 5v14l11-7z" /></svg>
                    </span>
                </span>
            </div>
            <div className="flex items-center gap-3 border-t border-edge px-3.5 py-2.5">
                <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-content">{camera.name}</span>
                    <span className="block truncate font-mono text-[11px] text-content-muted">{city || 'Lokasi tidak tersedia'}</span>
                </span>
                {viewers > 0 && (
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs text-data">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.6" />
                        </svg>
                        {viewers.toLocaleString('id-ID')}
                    </span>
                )}
            </div>
        </button>
    );
}
