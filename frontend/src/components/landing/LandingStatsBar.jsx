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
    const { cameras, areas } = useCameras();
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

    const totalAreas = areas.length;

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
    const StatsItem = ({ count, label, dotClass, onClick }) => (
        <button
            onClick={onClick}
            className={`flex items-center gap-2.5 rounded-control border border-edge bg-surface px-3.5 py-2 hover:border-edge-strong hover:bg-surface-raised ${disableAnimations ? '' : 'transition-colors'
                }`}
        >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true"></span>
            <span className="text-base font-semibold tabular-nums text-content sm:text-lg">{count}</span>
            <span className="text-xs text-content-muted">{label}</span>
        </button>
    );

    return (
        <>
            <div className="mt-8 flex flex-wrap justify-center gap-2 border-t border-edge pt-6">
                <StatsItem
                    count={stats.online}
                    label="kamera online"
                    dotClass="bg-status-live"
                    onClick={() => setActiveModal('online')}
                />

                {stats.offline > 0 && (
                    <StatsItem
                        count={stats.offline}
                        label="kamera offline"
                        dotClass="bg-status-idle"
                        onClick={() => setActiveModal('offline')}
                    />
                )}

                {stats.maintenance > 0 && (
                    <StatsItem
                        count={stats.maintenance}
                        label="kamera perbaikan"
                        dotClass="bg-status-fault"
                        onClick={() => setActiveModal('maintenance')}
                    />
                )}

                {totalAreas > 0 && (
                    <StatsItem
                        count={totalAreas}
                        label="area dipantau"
                        dotClass="bg-content-subtle"
                        onClick={() => setActiveModal('areas')}
                    />
                )}
            </div>

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
                />
            )}
            {activeModal === 'maintenance' && (
                <ListModal
                    title="Kamera Perbaikan"
                    items={stats.maintenanceList}
                    type="maintenance"
                    onClose={() => setActiveModal(null)}
                />
            )}
            {activeModal === 'areas' && (
                <ListModal
                    title="Area Monitoring"
                    items={areas}
                    type="areas"
                    onClose={() => setActiveModal(null)}
                />
            )}
        </>
    );
}
