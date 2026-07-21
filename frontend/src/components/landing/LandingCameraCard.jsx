/*
 * Purpose: Render a public landing camera card with prioritized/lazy thumbnail, a single status signal, viewer stats, and quick actions.
 * Caller: Landing camera grids and public camera list views.
 * Deps: React memo/ref hooks, Icons, CameraThumbnail, CameraViewerStatsBadges, codec support, animation and availability utilities, video popup preloader.
 * MainFuncs: CameraCard.
 * SideEffects: Invokes caller-provided click, multiview, favorite callbacks, and preloads the video popup chunk on first user intent.
 */

import { memo, useRef } from 'react';
import { Icons } from '../ui/Icons';
import CameraThumbnail from '../CameraThumbnail';
import CameraViewerStatsBadges from '../common/CameraViewerStatsBadges.jsx';
import { shouldDisableAnimations } from '../../utils/animationControl';
import { isCameraHardOffline, isCameraDegraded } from '../../utils/cameraAvailability.js';
import { getPublicCameraQuality } from '../../utils/landingCameraInsights';
import { getCodecWarning } from '../../utils/codecSupport';
import { preloadPublicVideoPopup } from '../../utils/preloadPublicVideoPopup';

/*
 * Status is expressed as ONE dot whose colour carries the state, and a text
 * label ONLY when the state is abnormal.
 *
 * Why: ~89% of cameras are healthy, so a "LIVE" label on every card is a label
 * that carries no information — the eye should be able to scan a 749-card grid
 * for the exceptions. The old card shouted `LIVE` in a red pill on every tile,
 * which both buried the real faults and collided with `PERBAIKAN` (also red).
 * Red is now reserved for genuine trouble; healthy live is a calm green dot.
 *
 * `srLabel` keeps the state available to screen readers even when the visual
 * label is suppressed — the dot alone must never be the only carrier of meaning.
 */
const STATUS = {
    maintenance: { dot: 'bg-status-fault', label: 'Perbaikan', srLabel: 'Sedang perbaikan', ring: 'ring-status-fault/40' },
    offline: { dot: 'bg-status-idle', label: 'Offline', srLabel: 'Sedang offline', ring: 'ring-edge' },
    degraded: { dot: 'bg-status-warn', label: 'Tidak stabil', srLabel: 'Sinyal tidak stabil', ring: 'ring-status-warn/40' },
    live: { dot: 'bg-status-live', label: null, srLabel: 'Siaran langsung', ring: 'ring-edge' },
};

function resolveStatus(camera) {
    if (camera.status === 'maintenance') return STATUS.maintenance;
    if (isCameraHardOffline(camera)) return STATUS.offline;
    if (isCameraDegraded(camera)) return STATUS.degraded;
    return STATUS.live;
}

const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti, isFavorite, onToggleFavorite, thumbnailPriority = false, disableHeavyEffects }) {
    const didPrewarmVideoPopupRef = useRef(false);
    const status = resolveStatus(camera);
    const isLive = status === STATUS.live;
    // Lite experience (mobile / save-data / low-end / user opt-in) drops expensive paint. Motion is a
    // superset: also off for reduced-motion / low tier via shouldDisableAnimations(). When the prop is
    // omitted (other callers) behaviour is unchanged.
    const liteEffects = disableHeavyEffects === true;
    const disableAnimations = liteEffects || shouldDisableAnimations();
    // Let the browser skip layout/paint for off-screen cards while scrolling (big win on long grids /
    // weak GPUs); `contain-intrinsic-size` reserves an approximate height so the scrollbar stays stable.
    const contentVisibilityClass = liteEffects ? '[content-visibility:auto] [contain-intrinsic-size:auto_300px]' : '';
    const isFav = isFavorite?.(camera.id);

    // Only surface a quality chip when it actually distinguishes this camera.
    // `maintenance`/`offline` duplicate the status dot, and the default bucket
    // ("Sering Dilihat") landed on every single card — a badge on 100% of items
    // is decoration, not information.
    const quality = getPublicCameraQuality(camera);
    const showQuality = quality?.key === 'busy' || quality?.key === 'new';

    // The public does not care that a stream is H.264 vs H.265 — that badge was
    // pure technical leakage. Surface it only when this browser genuinely may
    // fail to play the stream, which is actionable.
    const codecWarning = camera.video_codec ? getCodecWarning(camera.video_codec) : null;

    const transitionClass = disableAnimations ? '' : 'transition-colors duration-200';
    const prewarmVideoPopup = () => {
        if (didPrewarmVideoPopupRef.current) {
            return;
        }

        didPrewarmVideoPopupRef.current = true;
        preloadPublicVideoPopup();
    };

    // Keyboard activation for the (div-based) thumbnail "watch" target so it
    // behaves like a button — the primary action on the card.
    const handleOpenKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            onClick?.(e);
        }
    };

    const actionButtonClass = `rounded-control border border-white/15 bg-black/45 p-2 text-white/80 backdrop-blur-sm ${disableAnimations ? '' : 'transition-colors'
        } hover:border-white/30 hover:bg-black/65 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`;

    return (
        <div
            className={`group/card relative overflow-hidden rounded-card bg-surface ring-1 ${status.ring} ${transitionClass} ${contentVisibilityClass} hover:ring-edge-strong`}
            onPointerEnter={prewarmVideoPopup}
            onFocus={prewarmVideoPopup}
        >
            <div
                role="button"
                tabIndex={0}
                aria-label={`Tonton ${camera.name}`}
                onClick={onClick}
                onKeyDown={handleOpenKeyDown}
                className="relative aspect-video cursor-pointer overflow-hidden bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
                <CameraThumbnail
                    cameraId={camera.id}
                    thumbnailPath={camera.external_snapshot_url || camera.thumbnail_path}
                    cameraName={camera.name}
                    isMaintenance={status === STATUS.maintenance}
                    isOffline={status === STATUS.offline}
                    priority={thumbnailPriority}
                />

                {isLive && !disableAnimations && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover/card:opacity-100">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-primary">
                            <Icons.Play />
                        </span>
                    </div>
                )}

                <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 backdrop-blur-sm">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} aria-hidden="true"></span>
                    <span className="sr-only">{status.srLabel}</span>
                    {status.label && (
                        <span className="text-[11px] font-medium leading-none text-white/90">{status.label}</span>
                    )}
                    {/* REC keeps the conventional red, but it is always paired with its
                        own label so it cannot be misread as a fault the way the old
                        unlabelled red LIVE pill could. */}
                    {isLive && camera.is_recording && (
                        <span className="flex items-center gap-1 border-l border-white/20 pl-1.5 text-[11px] font-medium leading-none text-white/90">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-fault" aria-hidden="true"></span>
                            REC
                        </span>
                    )}
                </div>

                <div className="absolute right-2 top-2 flex gap-1.5">
                    {onToggleFavorite && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleFavorite(camera.id); }}
                            className={`${actionButtonClass} ${isFav ? 'border-amber-300/40 text-amber-300' : ''}`}
                            title={isFav ? 'Hapus dari Favorit' : 'Tambah ke Favorit'}
                        >
                            <svg className="h-4 w-4" fill={isFav ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            </svg>
                        </button>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                        className={`${actionButtonClass} ${inMulti ? 'border-status-live/50 text-status-live' : ''}`}
                        title={inMulti ? 'Hapus dari Multi-View' : 'Tambah ke Multi-View'}
                    >
                        {inMulti ? <Icons.Check /> : <Icons.Plus />}
                    </button>
                </div>
            </div>

            <div className="cursor-pointer p-3" onClick={onClick}>
                <div className="flex items-start justify-between gap-2">
                    <h3 className={`min-w-0 flex-1 truncate text-sm font-semibold text-content ${!disableAnimations ? 'transition-colors group-hover/card:text-primary' : ''}`}>
                        {camera.name}
                    </h3>
                    {codecWarning && (
                        <span
                            className="mt-0.5 shrink-0 text-status-warn"
                            title={codecWarning.message}
                            aria-label={codecWarning.message}
                        >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                        </span>
                    )}
                </div>

                {(camera.area_name || camera.location) && (
                    <p className="mt-0.5 truncate text-xs text-content-muted">
                        {[camera.area_name, camera.location].filter(Boolean).join(' · ')}
                    </p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <CameraViewerStatsBadges camera={camera} />
                    {showQuality && (
                        <span className="text-[11px] font-medium text-primary">{quality.label}</span>
                    )}
                </div>
            </div>
        </div>
    );
});

export default CameraCard;
