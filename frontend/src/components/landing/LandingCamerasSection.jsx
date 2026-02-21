import { useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { useCameras } from '../../contexts/CameraContext';
import { Icons } from '../ui/Icons';
import { GridSkeleton, CameraCardSkeleton } from '../ui/Skeleton';
import { NoSearchResultsEmptyState, NoDataWithFilterEmptyState } from '../ui/EmptyState';
import CameraCard from './LandingCameraCard';

const MapView = lazy(() => import('../MapView'));
const Playback = lazy(() => import('../../pages/Playback'));

export default function CamerasSection({ 
    onCameraClick, 
    onAddMulti, 
    multiCameras, 
    viewMode, 
    setViewMode, 
    landingSettings = { section_title: 'CCTV Publik' },
    selectedCamera,
    favorites = [],
    onToggleFavorite,
    isFavorite
}) {
    const { cameras, areas, loading } = useCameras();
    const [connectionTab, setConnectionTab] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const [focusedCameraId, setFocusedCameraId] = useState(null);
    const searchInputRef = useRef(null);
    const searchContainerRef = useRef(null);

    const tunnelCameras = useMemo(() => cameras.filter(c => c.is_tunnel === 1), [cameras]);
    const stableCameras = useMemo(() => cameras.filter(c => c.is_tunnel !== 1), [cameras]);
    const hasTunnelCameras = useMemo(() => tunnelCameras.length > 0, [tunnelCameras]);

    const searchFilteredCameras = useMemo(() => {
        if (!searchQuery.trim()) return cameras;

        const query = searchQuery.toLowerCase().trim();
        return cameras.filter(camera => {
            const name = (camera.name || '').toLowerCase();
            const location = (camera.location || '').toLowerCase();
            const areaName = (camera.area_name || '').toLowerCase();

            return name.includes(query) ||
                location.includes(query) ||
                areaName.includes(query);
        });
    }, [cameras, searchQuery]);

    const filteredForGrid = useMemo(() => {
        let baseList = searchFilteredCameras;
        if (connectionTab === 'stable') return baseList.filter(c => c.is_tunnel !== 1);
        if (connectionTab === 'tunnel') return baseList.filter(c => c.is_tunnel === 1);
        if (connectionTab === 'favorites') return baseList.filter(c => favorites.includes(c.id));
        return baseList;
    }, [searchFilteredCameras, connectionTab, favorites]);

    const displayCameras = viewMode === 'map' ? searchFilteredCameras : filteredForGrid;

    const clearSearch = useCallback(() => {
        setSearchQuery('');
        setShowSearchDropdown(false);
        searchInputRef.current?.focus();
    }, []);

    const handleCameraSelect = useCallback((camera) => {
        if (viewMode === 'map') {
            setFocusedCameraId(camera.id);
        } else {
            onCameraClick(camera);
        }
        setSearchQuery('');
        setShowSearchDropdown(false);
    }, [viewMode, onCameraClick]);

    const handleFocusHandled = useCallback(() => {
        setFocusedCameraId(null);
    }, []);

    return (
        <section id="playback-section" className="py-6 sm:py-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col gap-4 mb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                                {landingSettings.section_title}
                            </h2>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                                {cameras.length} kamera tersedia • Streaming langsung 24/7
                            </p>
                        </div>

                        <div className="flex items-center p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                            <button
                                onClick={() => setViewMode('map')}
                                className={`p-2.5 rounded-lg transition-colors ${viewMode === 'map'
                                    ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                    }`}
                                title="Map View"
                            >
                                <Icons.Map />
                            </button>
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-2.5 rounded-lg transition-colors ${viewMode === 'grid'
                                    ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                    }`}
                                title="Grid View (Multi-View)"
                            >
                                <Icons.Grid />
                            </button>
                            <button
                                onClick={() => setViewMode('playback')}
                                className={`p-2.5 rounded-lg transition-colors ${viewMode === 'playback'
                                    ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                    }`}
                                title="Playback Rekaman"
                            >
                                <Icons.Clock />
                            </button>
                        </div>
                    </div>

                    <div className="relative" ref={searchContainerRef}>
                        <div className="relative flex items-center">
                            <div className="absolute left-3 text-gray-400 dark:text-gray-500 pointer-events-none">
                                <Icons.Search />
                            </div>
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => searchQuery.trim() && setShowSearchDropdown(true)}
                                placeholder="Cari kamera berdasarkan nama, lokasi, atau area..."
                                className="w-full pl-10 pr-20 sm:pr-24 py-2.5 sm:py-3 bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-primary dark:focus:border-primary rounded-xl text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm sm:text-base outline-none transition-colors"
                            />
                            <div className="absolute right-2 flex items-center gap-1.5">
                                {searchQuery && (
                                    <button
                                        onClick={clearSearch}
                                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                        title="Hapus pencarian (Esc)"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                                <span className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 rounded">
                                    <kbd className="font-sans">⌘</kbd>
                                    <kbd className="font-sans">K</kbd>
                                </span>
                            </div>
                        </div>

                        {showSearchDropdown && searchFilteredCameras.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-[1100] max-h-[300px] sm:max-h-[400px] overflow-y-auto">
                                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {searchFilteredCameras.length} kamera ditemukan • Klik untuk {viewMode === 'map' ? 'lihat di peta' : 'putar video'}
                                    </span>
                                </div>
                                {searchFilteredCameras.map((camera, idx) => {
                                    const isMaintenance = camera.status === 'maintenance';
                                    const isTunnel = camera.is_tunnel === 1;
                                    const hasCoords = camera.latitude && camera.longitude;
                                    const isDisabled = viewMode === 'map' && !hasCoords;

                                    return (
                                        <button
                                            key={camera.id ?? `search-${idx}`}
                                            onClick={() => handleCameraSelect(camera)}
                                            disabled={isDisabled}
                                            className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 ${!isDisabled
                                                ? 'hover:bg-sky-50 dark:hover:bg-primary/10 cursor-pointer'
                                                : 'opacity-50 cursor-not-allowed'
                                                }`}
                                        >
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isMaintenance
                                                ? 'bg-red-100 dark:bg-red-500/20 text-red-500'
                                                : isTunnel
                                                    ? 'bg-orange-100 dark:bg-orange-500/20 text-orange-500'
                                                    : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-500'
                                                }`}>
                                                {isMaintenance ? (
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                    </svg>
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={`font-medium truncate ${isMaintenance
                                                        ? 'text-red-600 dark:text-red-400'
                                                        : 'text-gray-900 dark:text-white'
                                                        }`}>
                                                        {camera.name}
                                                    </span>
                                                    {isMaintenance && (
                                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded">
                                                            PERBAIKAN
                                                        </span>
                                                    )}
                                                    {isTunnel && !isMaintenance && (
                                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded">
                                                            TUNNEL
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                    {camera.location && (
                                                        <span className="flex items-center gap-1 truncate">
                                                            <Icons.MapPin />
                                                            {camera.location}
                                                        </span>
                                                    )}
                                                    {camera.area_name && (
                                                        <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">
                                                            {camera.area_name}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {!isDisabled && (
                                                <div className="text-gray-400 dark:text-gray-500 shrink-0">
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path d="M9 5l7 7-7 7" />
                                                    </svg>
                                                </div>
                                            )}
                                            {isDisabled && (
                                                <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                                                    Tanpa koordinat
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {showSearchDropdown && searchQuery.trim() && searchFilteredCameras.length === 0 && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-[1100] p-6 text-center">
                                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400">
                                    <Icons.Search />
                                </div>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">
                                    Tidak ditemukan kamera untuk "<span className="font-medium text-gray-700 dark:text-gray-300">{searchQuery}</span>"
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {viewMode === 'grid' && hasTunnelCameras && (
                    <div className="mb-6">
                        <div className="flex flex-wrap gap-2 p-1.5 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
                            <button
                                onClick={() => setConnectionTab('all')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${connectionTab === 'all'
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                    }`}
                            >
                                Semua ({searchFilteredCameras.length})
                            </button>
                            <button
                                onClick={() => setConnectionTab('stable')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${connectionTab === 'stable'
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                    }`}
                            >
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                Stabil ({searchFilteredCameras.filter(c => c.is_tunnel !== 1).length})
                            </button>
                            <button
                                onClick={() => setConnectionTab('tunnel')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${connectionTab === 'tunnel'
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                    }`}
                            >
                                <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                Tunnel ({searchFilteredCameras.filter(c => c.is_tunnel === 1).length})
                            </button>
                            {favorites.length > 0 && (
                                <button
                                    onClick={() => setConnectionTab('favorites')}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${connectionTab === 'favorites'
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                        }`}
                                >
                                    <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                    </svg>
                                    Favorit ({favorites.length})
                                </button>
                            )}
                        </div>

                        {connectionTab === 'tunnel' && (
                            <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-lg text-sm text-orange-700 dark:text-orange-400 flex items-start gap-2">
                                <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span>Kamera tunnel mungkin kurang stabil. Refresh jika stream tidak muncul.</span>
                            </div>
                        )}
                    </div>
                )}

                {loading ? (
                    <GridSkeleton items={6} columns={3} SkeletonComponent={CameraCardSkeleton} />
                ) : displayCameras.length === 0 ? (
                    searchQuery ? (
                        <NoSearchResultsEmptyState
                            searchQuery={searchQuery}
                            onClearSearch={clearSearch}
                        />
                    ) : connectionTab !== 'all' ? (
                        <NoDataWithFilterEmptyState
                            filterName={connectionTab === 'tunnel' ? 'Koneksi Tunnel' : connectionTab === 'favorites' ? 'Kamera Favorit' : 'Koneksi Stabil'}
                            onClearFilter={() => setConnectionTab('all')}
                        />
                    ) : (
                        <div className="text-center py-16">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400">
                                <Icons.Camera />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                Belum Ada Kamera
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400">
                                Kamera CCTV akan segera tersedia untuk ditonton.
                            </p>
                        </div>
                    )
                ) : viewMode === 'playback' ? (
                    <Suspense fallback={
                        <div className="h-[600px] bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-gray-300 border-t-primary rounded-full animate-spin" />
                        </div>
                    }>
                        <Playback 
                            cameras={cameras.filter(c => c.enable_recording)}
                            selectedCamera={selectedCamera}
                        />
                    </Suspense>
                ) : viewMode === 'map' ? (
                    <Suspense fallback={
                        <div className="h-[450px] bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-gray-300 border-t-primary rounded-full animate-spin" />
                        </div>
                    }>
                        <MapView
                            cameras={cameras}
                            areas={areas}
                            className="h-[450px] sm:h-[550px]"
                            focusedCameraId={focusedCameraId}
                            onFocusHandled={handleFocusHandled}
                        />
                    </Suspense>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                        {filteredForGrid.map((camera, idx) => (
                            <CameraCard
                                key={camera.id ?? `grid-${idx}`}
                                camera={camera}
                                onClick={() => onCameraClick(camera)}
                                onAddMulti={() => onAddMulti(camera)}
                                inMulti={multiCameras.some(c => c.id === camera.id)}
                                isFavorite={isFavorite}
                                onToggleFavorite={onToggleFavorite}
                            />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
