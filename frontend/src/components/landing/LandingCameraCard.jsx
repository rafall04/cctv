import { memo } from 'react';
import { Icons } from '../ui/Icons';
import CodecBadge from '../CodecBadge';
import CameraThumbnail from '../CameraThumbnail';
import { shouldDisableAnimations } from '../../utils/animationControl';

const CameraCard = memo(function CameraCard({ camera, onClick, onAddMulti, inMulti, isFavorite, onToggleFavorite }) {
    const isMaintenance = camera.status === 'maintenance';
    const isOffline = camera.is_online === 0;
    const isTunnel = camera.is_tunnel === 1;
    const disableAnimations = shouldDisableAnimations();
    const isFav = isFavorite?.(camera.id);

    const cardStyle = isMaintenance
        ? 'ring-red-500/50 hover:ring-red-500'
        : isOffline
            ? 'ring-gray-400/50 hover:ring-gray-500'
            : 'ring-gray-200 dark:ring-gray-800 hover:ring-primary/50';

    const bgStyle = isMaintenance
        ? 'bg-red-100 dark:bg-red-900/30'
        : isOffline
            ? 'bg-gray-200 dark:bg-gray-700'
            : 'bg-gray-100 dark:bg-gray-800';

    const iconStyle = isMaintenance
        ? 'text-red-300 dark:text-red-700'
        : isOffline
            ? 'text-gray-400 dark:text-gray-600'
            : 'text-gray-300 dark:text-gray-700';

    const transitionClass = disableAnimations ? '' : 'transition-all duration-200';
    const hoverTransform = disableAnimations ? '' : 'hover:-translate-y-1';

    return (
        <div className={`relative rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-lg ring-1 ${transitionClass} ${hoverTransform} group/card ${cardStyle}`}>
            <div className="absolute top-3 right-3 z-30 flex gap-2">
                {onToggleFavorite && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite(camera.id); }}
                        className={`p-2.5 rounded-xl shadow-lg ${isFav
                            ? 'bg-amber-400 text-white'
                            : 'bg-white/90 dark:bg-gray-800/90 text-gray-400'
                            } ${disableAnimations ? '' : 'transition-colors hover:bg-amber-400 hover:text-white'}`}
                        title={isFav ? 'Hapus dari Favorit' : 'Tambah ke Favorit'}
                    >
                        <svg className="w-5 h-5" fill={isFav ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                    </button>
                )}
                <button
                    onClick={(e) => { e.stopPropagation(); onAddMulti(); }}
                    className={`p-2.5 rounded-xl shadow-lg ${inMulti
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white/90 dark:bg-gray-800/90 text-gray-600 dark:text-gray-300'
                        } ${disableAnimations ? '' : 'transition-colors hover:bg-primary hover:text-white'}`}
                    title={inMulti ? 'Hapus dari Multi-View' : 'Tambah ke Multi-View'}
                >
                    {inMulti ? <Icons.Check /> : <Icons.Plus />}
                </button>
            </div>

            <div onClick={onClick} className={`aspect-video relative cursor-pointer overflow-hidden ${bgStyle}`}>
                <CameraThumbnail
                    cameraId={camera.id}
                    thumbnailPath={camera.thumbnail_path}
                    cameraName={camera.name}
                    isMaintenance={isMaintenance}
                    isOffline={isOffline}
                />

                {!isMaintenance && !isOffline && !disableAnimations && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 bg-black/40 transition-opacity">
                        <div className="w-14 h-14 rounded-full bg-white/95 flex items-center justify-center text-primary shadow-xl">
                            <Icons.Play />
                        </div>
                    </div>
                )}

                <div className="absolute top-3 left-3 flex items-center gap-1.5">
                    {isMaintenance ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-600/90 text-white text-[10px] font-bold shadow-lg">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63" />
                            </svg>
                            PERBAIKAN
                        </span>
                    ) : isOffline ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-600/90 text-white text-[10px] font-bold shadow-lg">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072" />
                            </svg>
                            OFFLINE
                        </span>
                    ) : (
                        <>
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/90 text-white text-[10px] font-bold shadow-lg">
                                <span className="relative flex h-1.5 w-1.5">
                                    {!disableAnimations && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>}
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                                </span>
                                LIVE
                            </span>
                            {camera.is_recording && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-600/90 text-white text-[10px] font-bold shadow-lg" title="Sedang merekam">
                                    <span className="relative flex h-1.5 w-1.5">
                                        {!disableAnimations && <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>}
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                                    </span>
                                    REC
                                </span>
                            )}
                            {isTunnel && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-orange-500/90 text-white text-[10px] font-bold shadow-lg" title="Koneksi Tunnel - mungkin kurang stabil">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0" />
                                    </svg>
                                    TUNNEL
                                </span>
                            )}
                        </>
                    )}
                </div>

                {isOffline && !isMaintenance && (
                    <div className="absolute bottom-3 left-3">
                        <span className="px-2 py-1 rounded-lg bg-gray-800/80 text-gray-300 text-[10px] font-medium">
                            Tidak tersedia
                        </span>
                    </div>
                )}

                {camera.area_name && (
                    <div className={`absolute bottom-3 ${isOffline && !isMaintenance ? 'right-3' : 'left-3'}`}>
                        <span className="px-2 py-1 rounded-lg bg-black/60 text-white text-[10px] font-medium">
                            {camera.area_name}
                        </span>
                    </div>
                )}
            </div>

            <div className="p-4 cursor-pointer" onClick={onClick}>
                <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className={`font-bold truncate flex-1 ${isMaintenance
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-900 dark:text-white'
                        } ${!disableAnimations ? 'group-hover/card:text-primary transition-colors' : ''}`}>
                        {camera.name}
                    </h3>
                    {camera.video_codec && (
                        <CodecBadge codec={camera.video_codec} size="sm" showWarning={true} />
                    )}
                </div>

                {camera.location && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                        <Icons.MapPin />
                        <span className="truncate">{camera.location}</span>
                    </p>
                )}
            </div>
        </div>
    );
});

export default CameraCard;
