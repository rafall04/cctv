import { useState, useMemo } from 'react';
import { useCameras } from '../../contexts/CameraContext';
import { Icons } from '../ui/Icons';
import { shouldDisableAnimations } from '../../utils/animationControl';

function ListModal({ title, items, type, onClose }) {
    const getHeaderColor = () => {
        switch (type) {
            case 'online': return 'from-emerald-500 to-emerald-600';
            case 'offline': return 'from-gray-500 to-gray-600';
            case 'maintenance': return 'from-red-500 to-red-600';
            case 'areas': return 'from-purple-500 to-purple-600';
            default: return 'from-primary to-primary-600';
        }
    };

    const getStatusIcon = () => {
        const iconClass = "w-5 h-5 text-white";
        switch (type) {
            case 'online':
                return <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7" /></svg>;
            case 'offline':
                return <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12" /></svg>;
            case 'maintenance':
                return <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877" /></svg>;
            case 'areas':
                return <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><circle cx="12" cy="11" r="3" /></svg>;
            default:
                return <Icons.Camera />;
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

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 dark:bg-black/80" onClick={onClose}>
            <div
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[70vh] overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className={`bg-gradient-to-r ${getHeaderColor()} px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between`}>
                    <div className="flex items-center gap-2 sm:gap-3">
                        {getStatusIcon()}
                        <h3 className="text-white font-bold text-base sm:text-lg">{title}</h3>
                        <span className="px-2 py-0.5 bg-white/20 rounded-full text-white text-xs sm:text-sm font-medium">
                            {items.length}
                        </span>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-white">
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
                                const isTunnel = camera.is_tunnel === 1;
                                return (
                                    <button
                                        key={camera.id}
                                        onClick={() => onClose(camera)}
                                        className={`w-full px-4 py-3 text-left flex items-center gap-3 ${disableAnimations
                                            ? 'hover:bg-gray-100 dark:hover:bg-gray-800'
                                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
                                            }`}
                                    >
                                        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${getIconColor()}`}>
                                            <Icons.Camera />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <p className="font-medium text-gray-900 dark:text-white truncate text-sm sm:text-base">{camera.name}</p>
                                                {isTunnel && type === 'online' && (
                                                    <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-bold bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded">
                                                        TUNNEL
                                                    </span>
                                                )}
                                            </div>
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
        const onlineList = cameras.filter(c => c.status !== 'maintenance' && c.is_online !== 0);
        const offlineList = cameras.filter(c => c.status !== 'maintenance' && c.is_online === 0);
        const maintenanceList = cameras.filter(c => c.status === 'maintenance');
        return {
            online: onlineList.length,
            offline: offlineList.length,
            maintenance: maintenanceList.length,
            total: cameras.length,
            onlineList,
            offlineList,
            maintenanceList
        };
    }, [cameras]);

    const totalAreas = areas.length;

    if (cameras.length === 0) return null;

    const handleCameraItemClick = (camera) => {
        setActiveModal(null);
        onCameraClick?.(camera);
    };

    const StatsItem = ({ count, label, sublabel, gradient, shadow, onClick, disabled = false }) => (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 rounded-xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm shadow-sm ${disabled
                ? 'opacity-50 cursor-not-allowed'
                : disableAnimations
                    ? 'hover:bg-white/80 dark:hover:bg-gray-800/80 cursor-pointer'
                    : 'hover:scale-105 hover:shadow-md cursor-pointer transition-all'
                }`}
        >
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg ${shadow}`}>
                <span className="text-white font-bold text-sm sm:text-lg">{count}</span>
            </div>
            <div className="text-left">
                <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">{label}</p>
                <p className="text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200">{sublabel}</p>
            </div>
        </button>
    );

    return (
        <>
            <div className="flex flex-wrap justify-center gap-2 sm:gap-4 mt-8 pt-6 border-t border-gray-200/50 dark:border-gray-700/50">
                <StatsItem
                    count={stats.online}
                    label="Online"
                    sublabel="Kamera"
                    gradient="from-emerald-400 to-emerald-600"
                    shadow="shadow-emerald-500/30"
                    onClick={() => setActiveModal('online')}
                />

                {stats.offline > 0 && (
                    <StatsItem
                        count={stats.offline}
                        label="Offline"
                        sublabel="Kamera"
                        gradient="from-gray-400 to-gray-600"
                        shadow="shadow-gray-500/30"
                        onClick={() => setActiveModal('offline')}
                    />
                )}

                {stats.maintenance > 0 && (
                    <StatsItem
                        count={stats.maintenance}
                        label="Perbaikan"
                        sublabel="Kamera"
                        gradient="from-red-400 to-red-600"
                        shadow="shadow-red-500/30"
                        onClick={() => setActiveModal('maintenance')}
                    />
                )}

                {totalAreas > 0 && (
                    <StatsItem
                        count={totalAreas}
                        label="Monitoring"
                        sublabel="Area"
                        gradient="from-purple-400 to-purple-600"
                        shadow="shadow-purple-500/30"
                        onClick={() => setActiveModal('areas')}
                    />
                )}
            </div>

            {activeModal === 'online' && (
                <ListModal
                    title="Kamera Online"
                    items={stats.onlineList}
                    type="online"
                    onClose={handleCameraItemClick}
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
