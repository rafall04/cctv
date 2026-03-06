import { lazy } from 'react';
import { useCameras } from '../../contexts/CameraContext';
import { useLandingCameraFilters } from '../../hooks/public/useLandingCameraFilters';
import { GridSkeleton, CameraCardSkeleton } from '../ui/Skeleton';
import { NoSearchResultsEmptyState, NoDataWithFilterEmptyState } from '../ui/EmptyState';
import { Icons } from '../ui/Icons';
import LandingCameraToolbar from './LandingCameraToolbar';
import LandingAreaFilter from './LandingAreaFilter';
import LandingConnectionTabs from './LandingConnectionTabs';
import LandingResultsGrid from './LandingResultsGrid';
import LandingMapPanel from './LandingMapPanel';
import LandingPlaybackPanel from './LandingPlaybackPanel';

const MapView = lazy(() => import('../MapView'));
const Playback = lazy(() => import('../../pages/Playback'));

function renderSearchDropdown({
    cameras,
    viewMode,
    onSelect,
    searchQuery,
}) {
    if (searchQuery.trim() && cameras.length === 0) {
        return (
            <div className="absolute left-0 right-0 top-full z-[1100] mt-2 rounded-xl border border-gray-200 bg-white p-6 text-center shadow-2xl dark:border-gray-700 dark:bg-gray-800">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400 dark:bg-gray-700">
                    <Icons.Search />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    Tidak ditemukan kamera untuk &quot;<span className="font-medium text-gray-700 dark:text-gray-300">{searchQuery}</span>&quot;
                </p>
            </div>
        );
    }

    if (cameras.length === 0) {
        return null;
    }

    return (
        <div className="absolute left-0 right-0 top-full z-[1100] mt-2 max-h-[300px] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800 sm:max-h-[400px]">
            <div className="sticky top-0 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/50">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                    {cameras.length} hasil pencarian
                </span>
            </div>
            {cameras.map((camera, index) => {
                const isMaintenance = camera.status === 'maintenance';
                const isTunnel = camera.is_tunnel === 1;
                const hasCoords = camera.latitude && camera.longitude;
                const isDisabled = viewMode === 'map' && !hasCoords;

                return (
                    <button
                        key={camera.id ?? `search-${index}`}
                        onClick={() => onSelect(camera)}
                        disabled={isDisabled}
                        className={`flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 dark:border-gray-700/50 ${
                            !isDisabled
                                ? 'cursor-pointer hover:bg-sky-50 dark:hover:bg-primary/10'
                                : 'cursor-not-allowed opacity-50'
                        }`}
                    >
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                            isMaintenance
                                ? 'bg-red-100 text-red-500 dark:bg-red-500/20'
                                : isTunnel
                                    ? 'bg-orange-100 text-orange-500 dark:bg-orange-500/20'
                                    : 'bg-emerald-100 text-emerald-500 dark:bg-emerald-500/20'
                        }`}>
                            {isMaintenance ? (
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63" />
                                </svg>
                            ) : (
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            )}
                        </div>

                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className={`truncate font-medium ${
                                    isMaintenance ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                                }`}>
                                    {camera.name}
                                </span>
                                {isMaintenance && (
                                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-500/20 dark:text-red-400">
                                        Perbaikan
                                    </span>
                                )}
                                {isTunnel && !isMaintenance && (
                                    <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 dark:bg-orange-500/20 dark:text-orange-400">
                                        Tunnel
                                    </span>
                                )}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                                {[camera.area_name, camera.location].filter(Boolean).join(' / ') || 'Lokasi tidak tersedia'}
                            </p>
                        </div>

                        {isDisabled && (
                            <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                                Tanpa koordinat
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

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
    isFavorite,
}) {
    const { cameras, areas, loading } = useCameras();
    const filters = useLandingCameraFilters(cameras, areas, favorites, viewMode, onCameraClick);
    const {
        connectionTab,
        setConnectionTab,
        searchQuery,
        setSearchQuery,
        selectedArea,
        showSearchDropdown,
        setShowSearchDropdown,
        focusedCameraId,
        areaOptions,
        searchFilteredCameras,
        areaFilteredCameras,
        filteredForGrid,
        favoritesInAreaCount,
        displayCameras,
        searchInputRef,
        searchContainerRef,
        clearSearch,
        handleAreaChange,
        handleCameraSelect,
        handleFocusHandled,
    } = filters;

    const searchDropdown = renderSearchDropdown({
        cameras: showSearchDropdown ? areaFilteredCameras : [],
        viewMode,
        onSelect: handleCameraSelect,
        searchQuery,
    });

    const contextualControls = (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {(viewMode === 'map' || viewMode === 'grid') && (
                <LandingAreaFilter
                    selectedArea={selectedArea}
                    onChange={handleAreaChange}
                    areaOptions={areaOptions}
                    searchFilteredCameras={searchFilteredCameras}
                />
            )}

            {viewMode === 'grid' && (
                <LandingConnectionTabs
                    connectionTab={connectionTab}
                    onChange={setConnectionTab}
                    areaFilteredCameras={areaFilteredCameras}
                    favorites={favorites}
                    favoritesInAreaCount={favoritesInAreaCount}
                />
            )}
        </div>
    );

    return (
        <section id="playback-section" className="py-8 pb-16 sm:py-12 sm:pb-24">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <LandingCameraToolbar
                    title={landingSettings.section_title}
                    camerasCount={cameras.length}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    searchProps={{
                        searchQuery,
                        onSearchChange: setSearchQuery,
                        onFocus: () => searchQuery.trim() && setShowSearchDropdown(true),
                        onClear: clearSearch,
                        searchInputRef,
                        searchContainerRef,
                        showSearchDropdown,
                        dropdownContent: searchDropdown,
                    }}
                    contextualControls={viewMode === 'playback' ? null : contextualControls}
                />

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
                    ) : selectedArea !== 'all' ? (
                        <NoDataWithFilterEmptyState
                            filterName={`Area ${selectedArea}`}
                            onClearFilter={() => handleAreaChange('all')}
                        />
                    ) : (
                        <div className="py-16 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-gray-800">
                                <Icons.Camera />
                            </div>
                            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                                Belum Ada Kamera
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400">
                                Kamera CCTV akan segera tersedia untuk ditonton.
                            </p>
                        </div>
                    )
                ) : viewMode === 'playback' ? (
                    <LandingPlaybackPanel
                        Playback={Playback}
                        cameras={cameras.filter((camera) => camera.enable_recording)}
                        selectedCamera={selectedCamera}
                    />
                ) : viewMode === 'map' ? (
                    <LandingMapPanel
                        MapView={MapView}
                        cameras={searchFilteredCameras}
                        areas={areas}
                        selectedArea={selectedArea}
                        onAreaChange={handleAreaChange}
                        focusedCameraId={focusedCameraId}
                        onFocusHandled={handleFocusHandled}
                    />
                ) : (
                    <LandingResultsGrid
                        cameras={filteredForGrid}
                        onCameraClick={onCameraClick}
                        onAddMulti={onAddMulti}
                        multiCameras={multiCameras}
                        isFavorite={isFavorite}
                        onToggleFavorite={onToggleFavorite}
                    />
                )}
            </div>
        </section>
    );
}
