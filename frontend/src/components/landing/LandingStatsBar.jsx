/*
 * Purpose: Render public landing status counters and camera/area detail modals.
 * Caller: LandingHero and public landing status surfaces.
 * Deps: React state/effects/memo, CameraContext, camera availability helpers, landing UI icons.
 * MainFuncs: StatsBar, ListModal.
 * SideEffects: Locks body scroll while stats modal is open and handles Escape to close it.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useCameras } from '../../contexts/CameraContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getCameraAvailabilityState } from '../../utils/cameraAvailability.js';
import { groupCamerasByCity } from '../../utils/publicCityMapping';
import { Icons } from '../ui/Icons';
import { shouldDisableAnimations } from '../../utils/animationControl';

function ListModal({ title, items, type, onClose, onCameraClick }) {
    // One dot instead of a per-type gradient header. Same reasoning as the stats
    // row: colour should encode state, not decorate a panel.
    const getStatusDot = () => {
        switch (type) {
            case 'online': return 'bg-status-live';
            case 'offline': return 'bg-status-idle';
            case 'maintenance': return 'bg-status-fault';
            default: return 'bg-content-subtle';
        }
    };

    const getIconColor = () => {
        switch (type) {
            case 'online': return 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400';
            case 'offline': return 'bg-gray-100 dark:bg-gray-500/20 text-gray-600 dark:text-gray-400';
            case 'maintenance': return 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400';
            default: return 'bg-sky-100 dark:bg-primary/20 text-primary-600 dark:text-primary-400';
        }
    };

    const disableAnimations = shouldDisableAnimations();

    const modalRef = useRef(null);
    // Trap focus inside the dialog + restore it on close. ESC is already
    // handled by the keydown effect below, so we don't pass onEscape.
    useFocusTrap(modalRef);

    useEffect(() => {
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = originalOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 dark:bg-black/80" onClick={onClose}>
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="max-h-[70vh] w-full max-w-md overflow-hidden rounded-card border border-edge bg-surface shadow-e2"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-edge px-4 py-3 sm:px-5 sm:py-4">
                    <div className="flex items-center gap-2.5">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${getStatusDot()}`} aria-hidden="true"></span>
                        <h3 className="text-base font-semibold text-content">{title}</h3>
                        <span className="text-sm tabular-nums text-content-muted">{items.length}</span>
                    </div>
                    <button onClick={onClose} className="rounded-control p-1.5 text-content-muted transition-colors hover:bg-surface-raised hover:text-content">
                        <Icons.X />
                    </button>
                </div>

                <div className="overflow-y-auto max-h-[calc(70vh-80px)]">
                    {items.length === 0 ? (
                        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                            Tidak ada data
                        </div>
                    ) : type === 'areas' ? (
                        <div className="divide-y divide-gray-100 dark:divide-gray-800">
                            {items.map(area => (
                                <div key={area.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                    <p className="font-medium text-gray-900 dark:text-white text-sm sm:text-base">{area.name}</p>
                                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                                        {[area.kelurahan, area.kecamatan].filter(Boolean).join(', ') || 'Lokasi tidak tersedia'}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-800">
                            {items.map(camera => {
                                return (
                                    <button
                                        key={camera.id}
                                        onClick={() => onCameraClick?.(camera)}
                                        className={`w-full px-4 py-3 text-left flex items-center gap-3 ${disableAnimations
                                            ? 'hover:bg-gray-100 dark:hover:bg-gray-800'
                                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
                                            }`}
                                    >
                                        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${getIconColor()}`}>
                                            <Icons.Camera />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {/* The TUNNEL badge that used to sit here was internal
                                                transport jargon with no meaning to the public. */}
                                            <p className="truncate text-sm font-medium text-content sm:text-base">{camera.name}</p>
                                            {camera.location && (
                                                <p className="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
                                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><circle cx="12" cy="11" r="3" />
                                                    </svg>
                                                    <span className="truncate">{camera.location}</span>
                                                </p>
                                            )}
                                            {camera.area_name && (
                                                <p className="text-[11px] sm:text-xs text-gray-400 dark:text-gray-500 truncate flex items-center gap-1 mt-0.5">
                                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                                                    </svg>
                                                    <span className="truncate">{camera.area_name}</span>
                                                </p>
                                            )}
                                            {!camera.location && !camera.area_name && (
                                                <p className="text-[11px] sm:text-xs text-gray-400 dark:text-gray-500">Lokasi tidak tersedia</p>
                                            )}
                                        </div>
                                        {type === 'online' && (
                                            <div className="shrink-0 text-emerald-500 w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center">
                                                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function StatsBar({ onCameraClick }) {
    const { cameras } = useCameras();
    const [activeModal, setActiveModal] = useState(null);
    const disableAnimations = shouldDisableAnimations();

    const stats = useMemo(() => {
        const initialStats = {
            online: 0,
            offline: 0,
            maintenance: 0,
            total: cameras.length,
            onlineList: [],
            offlineList: [],
            maintenanceList: [],
        };

        return cameras.reduce((nextStats, camera) => {
            if (camera.status === 'maintenance') {
                nextStats.maintenance += 1;
                nextStats.maintenanceList.push(camera);
                return nextStats;
            }

            if (getCameraAvailabilityState(camera) === 'offline') {
                nextStats.offline += 1;
                nextStats.offlineList.push(camera);
                return nextStats;
            }

            nextStats.online += 1;
            nextStats.onlineList.push(camera);
            return nextStats;
        }, initialStats);
    }, [cameras]);

    // Kota (city) rollup replaces the old raw "area dipantau" count: the public
    // identity is a multi-city network, so the headline figure is cities, not areas.
    const cities = useMemo(() => groupCamerasByCity(cameras), [cameras]);
    // Honest "watching now" = summed live viewers. No fabricated time-series sparkline.
    const liveViewersNow = useMemo(
        () => cameras.reduce(
            (sum, camera) => sum + Number(camera.live_viewers ?? camera.viewer_stats?.live_viewers ?? 0),
            0,
        ),
        [cameras],
    );

    if (cameras.length === 0) return null;

    const handleCameraItemClick = (camera) => {
        setActiveModal(null);
        onCameraClick?.(camera);
    };

    /*
     * The count used to sit inside a gradient tile with a coloured drop shadow
     * (`shadow-emerald-500/30` and friends) and grew on hover. Four gradients —
     * including a purple one for "Area" that carried no meaning — turned a row of
     * plain facts into the loudest element on the page. Now the numeral itself is
     * the emphasis, with a small dot doing the colour-coding, and `tabular-nums`
     * keeps the row from twitching as counts refresh.
     */
    // One board cell. Clickable cells open the drill-down modal; the numeral is the
    // emphasis (mono + tabular so it never twitches as counts refresh), colour on the
    // value encodes state (green up / red offline) — not decoration.
    const Metric = ({ value, label, ariaLabel, valueClass = 'text-content', onClick }) => {
        const interactive = typeof onClick === 'function';
        const Tag = interactive ? 'button' : 'div';
        return (
            <Tag
                {...(interactive ? { type: 'button', onClick, 'aria-label': ariaLabel } : {})}
                className={`flex flex-col gap-1 bg-surface px-3.5 py-3 text-left ${interactive ? `hover:bg-surface-raised ${disableAnimations ? '' : 'transition-colors'}` : ''}`}
            >
                <span className={`font-mono text-2xl font-bold leading-none tabular-nums ${valueClass}`}>{value}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-subtle">{label}</span>
            </Tag>
        );
    };

    return (
        <div className="relative flex h-full flex-col rounded-card border border-edge bg-surface p-4">
            <div className="mb-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-content-subtle">Status jaringan kamera</span>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-edge bg-edge">
                <Metric
                    value={stats.online}
                    label="Online"
                    ariaLabel={`${stats.online} kamera online`}
                    valueClass="text-status-live"
                    onClick={() => setActiveModal('online')}
                />
                <Metric
                    value={stats.offline}
                    label="Offline"
                    ariaLabel={`${stats.offline} kamera offline`}
                    valueClass={stats.offline > 0 ? 'text-status-fault' : 'text-content'}
                    onClick={() => setActiveModal('offline')}
                />
                <Metric value={stats.total} label="Total unit" />
                <Metric value={cities.length} label="Kota terpantau" />
            </div>

            {stats.maintenance > 0 && (
                <button
                    type="button"
                    onClick={() => setActiveModal('maintenance')}
                    aria-label={`${stats.maintenance} kamera perbaikan`}
                    className="mt-2.5 flex items-center gap-2 self-start text-xs text-content-muted hover:text-content"
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-status-fault" aria-hidden="true"></span>
                    <span className="font-mono tabular-nums">{stats.maintenance}</span>
                    <span>dalam perbaikan</span>
                </button>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-edge pt-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-subtle">Menonton sekarang</span>
                <span className="flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-data">
                    <span className={`h-1.5 w-1.5 rounded-full bg-data ${disableAnimations ? '' : 'animate-pulse'}`} aria-hidden="true"></span>
                    {liveViewersNow.toLocaleString('id-ID')}
                </span>
            </div>

            {cities.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-subtle">Cakupan</span>
                    {cities.slice(0, 3).map((city) => (
                        <span key={city.key} className="rounded-full border border-edge px-2 py-0.5 font-mono text-[10px] text-content-muted">
                            {city.label} <span className="text-content-subtle">{city.count}</span>
                        </span>
                    ))}
                    {cities.length > 3 && (
                        <span className="font-mono text-[10px] text-content-subtle">+{cities.length - 3} kota</span>
                    )}
                </div>
            )}

            {activeModal === 'online' && (
                <ListModal
                    title="Kamera Online"
                    items={stats.onlineList}
                    type="online"
                    onClose={() => setActiveModal(null)}
                    onCameraClick={handleCameraItemClick}
                />
            )}
            {activeModal === 'offline' && (
                <ListModal
                    title="Kamera Offline"
                    items={stats.offlineList}
                    type="offline"
                    onClose={() => setActiveModal(null)}
                    onCameraClick={handleCameraItemClick}
                />
            )}
            {activeModal === 'maintenance' && (
                <ListModal
                    title="Kamera Perbaikan"
                    items={stats.maintenanceList}
                    type="maintenance"
                    onClose={() => setActiveModal(null)}
                    onCameraClick={handleCameraItemClick}
                />
            )}
        </div>
    );
}
