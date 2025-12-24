import { useEffect, useState, useMemo, memo } from 'react';
import { streamService } from '../services/streamService';
import VideoPlayer from '../components/VideoPlayer';

export default function LandingPage() {
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedCamera, setExpandedCamera] = useState(null);
    const [layout, setLayout] = useState('grid'); // grid, focus, sidebar
    const [selectedGroup, setSelectedGroup] = useState('All');
    const [activeCameraIds, setActiveCameraIds] = useState([]);
    const [selectedCameraIds, setSelectedCameraIds] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState('area'); // area, location

    useEffect(() => {
        loadCameras();
    }, []);

    const loadCameras = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await streamService.getAllActiveStreams();

            if (response.success) {
                setCameras(response.data);
            } else {
                setError('Failed to load cameras');
            }
        } catch (err) {
            console.error('Load cameras error:', err);
            setError('Failed to load cameras');
        } finally {
            setLoading(false);
        }
    };

    const groups = useMemo(() => ['All', ...new Set(cameras.map(c => {
        if (filterType === 'area') return c.area_name || c.group_name || 'Uncategorized';
        if (filterType === 'location') return c.location || 'No Location';
        return 'Other';
    }))], [cameras, filterType]);

    const filteredCameras = useMemo(() => cameras.filter(c => {
        // Search filter
        const matchesSearch = !searchQuery ||
            c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (c.location && c.location.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (c.area_name && c.area_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()));

        if (!matchesSearch) return false;

        // Group filter
        if (selectedGroup === 'All') return true;

        const groupValue = filterType === 'area'
            ? (c.area_name || c.group_name || 'Uncategorized')
            : (c.location || 'No Location');

        return groupValue === selectedGroup;
    }), [cameras, searchQuery, selectedGroup, filterType]);

    const groupedCameras = useMemo(() => filteredCameras.reduce((acc, camera) => {
        const group = filterType === 'area'
            ? (camera.area_name || camera.group_name || 'Uncategorized')
            : (camera.location || 'No Location');

        if (!acc[group]) acc[group] = [];
        acc[group].push(camera);
        return acc;
    }, {}), [filteredCameras, filterType]);

    const toggleCameraSelection = (cameraId) => {
        setSelectedCameraIds(prev => {
            let newSelection;
            if (prev.includes(cameraId)) {
                newSelection = prev.filter(id => id !== cameraId);
            } else if (prev.length >= 3) {
                // Remove the first one and add the new one (FIFO)
                newSelection = [...prev.slice(1), cameraId];
            } else {
                newSelection = [...prev, cameraId];
            }

            // Sync active cameras with selection
            setActiveCameraIds(newSelection);
            return newSelection;
        });
    };

    const toggleActiveCamera = (cameraId) => {
        setActiveCameraIds(prev => {
            if (prev.includes(cameraId)) {
                return prev.filter(id => id !== cameraId);
            }
            // If not in selection, just add it (limit to 3 for performance)
            if (prev.length >= 3) {
                return [...prev.slice(1), cameraId];
            }
            return [...prev, cameraId];
        });
    };

    const clearSelection = () => {
        setSelectedCameraIds([]);
    };

    // Get selected camera objects in order
    const selectedCameras = selectedCameraIds
        .map(id => cameras.find(c => c.id === id))
        .filter(Boolean);

    return (
        <div className="min-h-screen bg-dark-950 text-white selection:bg-primary-500/30">
            {/* Header - Simplified Blur */}
            <header className="sticky top-0 z-50 bg-dark-950/80 border-b border-white/5 backdrop-blur-md">
                <div className="container mx-auto px-4 lg:px-8 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 lg:w-12 lg:h-12 bg-gradient-to-br from-primary-500 to-accent-600 rounded-xl 
                            flex items-center justify-center shadow-lg shadow-primary-500/20 ring-1 ring-white/10">
                                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <div>
                                <h1 className="text-xl lg:text-2xl font-bold font-display text-transparent bg-clip-text bg-gradient-to-r from-white to-dark-300">
                                    RAF NET CCTV
                                </h1>
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                    </span>
                                    <p className="text-xs text-dark-400 font-medium tracking-wide uppercase">Live Monitoring v2.2</p>
                                </div>
                            </div>
                        </div>

                        {/* Layout Selector (Visible on Mobile & Desktop) */}
                        <div className="flex items-center bg-dark-900/50 rounded-xl p-1 border border-white/5 mx-2 lg:mx-4">
                            <button
                                onClick={() => setLayout('grid')}
                                className={`p-1.5 lg:p-2 rounded-lg transition-all ${layout === 'grid' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' : 'text-dark-400 hover:text-white'}`}
                                title="Grid View"
                            >
                                <svg className="w-4 h-4 lg:w-5 lg:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setLayout('focus')}
                                className={`p-1.5 lg:p-2 rounded-lg transition-all ${layout === 'focus' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' : 'text-dark-400 hover:text-white'}`}
                                title="Focus View"
                            >
                                <svg className="w-4 h-4 lg:w-5 lg:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 19h16" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setLayout('sidebar')}
                                className={`p-1.5 lg:p-2 rounded-lg transition-all ${layout === 'sidebar' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' : 'text-dark-400 hover:text-white'}`}
                                title="Sidebar View"
                            >
                                <svg className="w-4 h-4 lg:w-5 lg:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                                </svg>
                            </button>
                        </div>

                        <div className="w-8"></div>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="container mx-auto px-4 lg:px-8 py-8 lg:py-12">
                {loading && (
                    <div className="flex flex-col items-center justify-center min-h-[60vh]">
                        <div className="relative">
                            <div className="w-16 h-16 border-4 border-dark-800 border-t-primary-500 rounded-full animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-2 h-2 bg-primary-500 rounded-full"></div>
                            </div>
                        </div>
                        <p className="mt-6 text-dark-400 text-lg font-medium animate-pulse">Initializing Secure Stream...</p>
                    </div>
                )}

                {error && (
                    <div className="flex items-center justify-center min-h-[60vh]">
                        <div className="text-center max-w-md mx-auto p-8 rounded-2xl bg-dark-900/50 border border-red-500/20 backdrop-blur-sm">
                            <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                                <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Connection Failed</h3>
                            <p className="text-dark-400 mb-8">{error}</p>
                            <button
                                onClick={loadCameras}
                                className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors shadow-lg shadow-red-900/20"
                            >
                                Retry Connection
                            </button>
                        </div>
                    </div>
                )}

                {!loading && !error && cameras.length === 0 && (
                    <div className="flex items-center justify-center min-h-[60vh]">
                        <div className="text-center max-w-md mx-auto p-8">
                            <div className="w-24 h-24 bg-dark-800/50 rounded-full flex items-center justify-center mx-auto mb-6 border border-dark-700">
                                <svg className="w-12 h-12 text-dark-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">No Cameras Active</h3>
                            <p className="text-dark-400">There are currently no active camera feeds available for public viewing.</p>
                        </div>
                    </div>
                )}

                {!loading && !error && cameras.length > 0 && (
                    <div className="animate-fade-in">
                        {/* Advanced Filter Controls */}
                        <div className="flex flex-col md:flex-row gap-4 mb-6">
                            {/* Search Bar */}
                            <div className="relative flex-1 group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <svg className="w-5 h-5 text-dark-500 group-focus-within:text-primary-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                </div>
                                <input
                                    type="text"
                                    placeholder="Search cameras..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 bg-dark-900/60 border border-white/10 rounded-xl text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500 transition-all"
                                />
                            </div>

                            {/* Filter Type Selector */}
                            <div className="flex items-center bg-dark-900/40 rounded-2xl p-1 border border-white/5 backdrop-blur-sm">
                                <button
                                    onClick={() => { setFilterType('area'); setSelectedGroup('All'); }}
                                    className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${filterType === 'area' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' : 'text-dark-400 hover:text-white'}`}
                                >
                                    By Area
                                </button>
                                <button
                                    onClick={() => { setFilterType('location'); setSelectedGroup('All'); }}
                                    className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${filterType === 'location' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' : 'text-dark-400 hover:text-white'}`}
                                >
                                    By Location
                                </button>
                            </div>
                        </div>

                        {/* Filter Results Info */}
                        <div className="flex items-center justify-between mb-4 px-2">
                            <p className="text-xs font-bold text-dark-400 uppercase tracking-widest">
                                Showing {filteredCameras.length} of {cameras.length} Cameras
                            </p>
                            {(searchQuery || selectedGroup !== 'All') && (
                                <button
                                    onClick={() => { setSearchQuery(''); setSelectedGroup('All'); }}
                                    className="text-xs font-bold text-primary-500 hover:text-primary-400 transition-colors uppercase tracking-widest flex items-center gap-1"
                                >
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    Reset Filters
                                </button>
                            )}
                        </div>

                        {/* Group Filter Buttons */}
                        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-8 no-scrollbar">
                            {groups.map(group => (
                                <button
                                    key={group}
                                    onClick={() => setSelectedGroup(group)}
                                    className={`px-5 py-2.5 rounded-full text-sm font-bold transition-all whitespace-nowrap border ${selectedGroup === group
                                        ? 'bg-primary-500 border-primary-400 text-white shadow-lg shadow-primary-500/20'
                                        : 'bg-dark-900/50 border-white/5 text-dark-400 hover:text-white hover:border-white/10'
                                        }`}
                                >
                                    {group}
                                </button>
                            ))}
                        </div>

                        {/* Selection Bar */}
                        {selectedCameraIds.length > 0 && (
                            <div className="flex items-center justify-between bg-primary-500/10 border border-primary-500/20 rounded-2xl p-4 mb-8 animate-slide-up">
                                <div className="flex items-center gap-4">
                                    <div className="flex -space-x-3">
                                        {selectedCameras.map((cam, i) => (
                                            <div key={cam.id} className="w-8 h-8 rounded-full bg-dark-800 border-2 border-primary-500 flex items-center justify-center text-[10px] font-bold text-white shadow-lg" style={{ zIndex: 10 - i }}>
                                                {i + 1}
                                            </div>
                                        ))}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white">
                                            {selectedCameraIds.length} / 3 Cameras Selected
                                        </p>
                                        <p className="text-[10px] text-primary-400 font-bold uppercase tracking-wider">
                                            {layout === 'grid' ? 'Switch to Focus or Sidebar view to play all' : 'Playing selected cameras simultaneously'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={clearSelection}
                                    className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    Clear Selection
                                </button>
                            </div>
                        )}

                        {/* Camera grid */}
                        {selectedGroup === 'All' && layout === 'grid' ? (
                            <div className="space-y-16">
                                {Object.entries(groupedCameras).map(([group, groupCameras]) => (
                                    <div key={group} className="space-y-8">
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-8 bg-primary-500 rounded-full"></div>
                                                <h3 className="text-2xl font-black text-white tracking-tight">
                                                    {group}
                                                </h3>
                                            </div>
                                            <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent"></div>
                                            <span className="text-xs font-bold text-dark-500 uppercase tracking-widest bg-dark-900/50 px-3 py-1 rounded-full border border-white/5">
                                                {groupCameras.length} Cameras
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 lg:gap-8">
                                            {groupCameras.map((camera) => (
                                                <CameraCard
                                                    key={camera.id}
                                                    camera={camera}
                                                    setExpandedCamera={setExpandedCamera}
                                                    isActive={activeCameraIds.includes(camera.id)}
                                                    setActiveCameraId={toggleActiveCamera}
                                                    isSelected={selectedCameraIds.includes(camera.id)}
                                                    onToggleSelect={toggleCameraSelection}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {layout === 'focus' ? (
                                    <FocusLayout
                                        cameras={selectedCameras.length > 0 ? selectedCameras : filteredCameras}
                                        setExpandedCamera={setExpandedCamera}
                                        activeCameraIds={activeCameraIds}
                                        toggleActiveCamera={toggleActiveCamera}
                                    />
                                ) : layout === 'sidebar' ? (
                                    <SidebarLayout
                                        cameras={selectedCameras.length > 0 ? selectedCameras : filteredCameras}
                                        setExpandedCamera={setExpandedCamera}
                                        activeCameraIds={activeCameraIds}
                                        toggleActiveCamera={toggleActiveCamera}
                                    />
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 lg:gap-8">
                                        {filteredCameras.map((camera) => (
                                            <CameraCard
                                                key={camera.id}
                                                camera={camera}
                                                setExpandedCamera={setExpandedCamera}
                                                isActive={activeCameraIds.includes(camera.id)}
                                                setActiveCameraId={toggleActiveCamera}
                                                isSelected={selectedCameraIds.includes(camera.id)}
                                                onToggleSelect={toggleCameraSelection}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )
                }
            </main >

            {/* Smart Expanded View Modal (Theater Mode) */}
            {
                expandedCamera && (
                    <div
                        className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-2 md:p-8 animate-fade-in"
                        onClick={() => setExpandedCamera(null)}
                    >
                        <div
                            className="relative w-full max-w-7xl bg-dark-950 rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10 flex flex-col"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Camera Info Header (Above Video) */}
                            <div className="p-4 md:p-6 bg-dark-900 border-b border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-1.5 h-8 bg-primary-500 rounded-full hidden md:block"></div>
                                    <div>
                                        <h2 className="text-xl md:text-2xl font-black text-white tracking-tight">{expandedCamera.name}</h2>
                                        <p className="text-xs md:text-sm text-dark-400 font-bold uppercase tracking-wider flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                            {expandedCamera.location || 'Live Stream'}
                                            {(expandedCamera.area_name || expandedCamera.group_name) && (
                                                <span className="text-primary-500 ml-1">
                                                    [{expandedCamera.area_name || expandedCamera.group_name}]
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setExpandedCamera(null)}
                                    className="p-2 lg:p-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all border border-white/10 group"
                                >
                                    <svg className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="relative flex-1 aspect-video bg-black">
                                <VideoPlayer
                                    camera={expandedCamera}
                                    streams={expandedCamera.streams}
                                    isExpanded={true}
                                    enableZoom={true}
                                />
                            </div>

                            {expandedCamera.description && (
                                <div className="p-4 md:p-6 bg-dark-900/50 border-t border-white/5">
                                    <p className="text-sm text-dark-300 font-medium leading-relaxed">{expandedCamera.description}</p>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }

            {/* Footer */}
            <footer className="border-t border-white/5 mt-auto bg-dark-950/50 backdrop-blur-sm">
                <div className="container mx-auto px-4 py-8">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="text-center md:text-left">
                            <p className="text-dark-400 text-sm font-bold">
                                © {new Date().getFullYear()} RAF NET <span className="text-primary-500">CCTV</span>
                            </p>
                            <p className="text-dark-600 text-[10px] font-black uppercase tracking-[0.2em] mt-1">
                                Secure Enterprise Monitoring System
                            </p>
                        </div>
                        <div className="flex items-center gap-6 text-dark-500">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                System Operational
                            </div>
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                Encrypted Connection
                            </div>
                        </div>
                    </div>
                </div>
            </footer>
        </div >
    );
}

// Helper Components
const CameraCard = memo(({ camera, setExpandedCamera, isActive, setActiveCameraId, isSelected, onToggleSelect }) => {
    return (
        <div
            className={`group relative bg-dark-900/60 rounded-xl overflow-hidden border transition-all duration-200 ${isSelected ? 'border-primary-500 ring-1 ring-primary-500/50' : 'border-white/5 hover:border-primary-500/30'
                }`}
            onClick={() => setExpandedCamera(camera)}
        >
            {/* Selection Toggle */}
            <div
                className={`absolute top-2.5 left-2.5 z-20 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${isSelected
                    ? 'bg-primary-500 border-primary-400 text-white shadow-lg shadow-primary-500/20'
                    : 'bg-black/60 border-white/20 text-transparent hover:border-primary-500/50'
                    }`}
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(camera.id);
                }}
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
            </div>
            <div className="aspect-video w-full bg-black relative">
                {isActive ? (
                    <VideoPlayer camera={camera} streams={camera.streams} onExpand={() => setExpandedCamera(camera)} />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900/40 transition-colors">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveCameraId(camera.id);
                            }}
                            className="w-12 h-12 bg-primary-500/10 hover:bg-primary-500/30 text-primary-500 rounded-full flex items-center justify-center border border-primary-500/20 transition-all"
                        >
                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>
            <div className="p-3 bg-dark-900/90 border-t border-white/5 flex items-center justify-between">
                <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{camera.name}</p>
                    <p className="text-[10px] text-dark-400 font-medium uppercase tracking-wider truncate">{camera.location || 'Live'}</p>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 ml-2"></div>
            </div>
        </div>
    );
});

function FocusLayout({ cameras, setExpandedCamera, activeCameraIds, toggleActiveCamera }) {
    if (cameras.length === 0) return null;
    const [main, ...others] = cameras;
    return (
        <div className="flex flex-col gap-6">
            <div className="w-full aspect-video bg-dark-950 rounded-3xl overflow-hidden border border-primary-500/20 shadow-2xl shadow-primary-900/10 relative group cursor-pointer"
                onClick={() => setExpandedCamera(main)}>
                {activeCameraIds.includes(main.id) ? (
                    <VideoPlayer camera={main} streams={main.streams} onExpand={() => setExpandedCamera(main)} />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900/60 md:group-hover:bg-dark-900/40 transition-colors">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleActiveCamera(main.id);
                            }}
                            className="w-20 h-20 bg-primary-500/20 hover:bg-primary-500/40 text-primary-500 rounded-full flex items-center justify-center border border-primary-500/30 transition-all transform md:group-hover:scale-110"
                        >
                            <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </button>
                        <p className="mt-4 text-sm font-bold text-dark-400 uppercase tracking-widest md:opacity-0 md:group-hover:opacity-100 transition-opacity">Click to Load Main Stream</p>
                    </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                    <h2 className="text-2xl font-black text-white mb-1">{main.name}</h2>
                    <p className="text-sm text-dark-200 font-bold uppercase tracking-wider">{main.location || 'Main View'}</p>
                </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                {others.map((camera) => (
                    <div
                        key={camera.id}
                        className="group relative bg-dark-900/40 rounded-xl overflow-hidden border border-white/5 hover:border-primary-500/30 transition-all duration-300 cursor-pointer"
                        onClick={() => setExpandedCamera(camera)}
                    >
                        <div className="aspect-video w-full bg-dark-950 relative">
                            {activeCameraIds.includes(camera.id) ? (
                                <VideoPlayer camera={camera} streams={camera.streams} />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center bg-dark-900/60 md:group-hover:bg-dark-900/40 transition-colors">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleActiveCamera(camera.id);
                                        }}
                                        className="w-10 h-10 bg-primary-500/20 hover:bg-primary-500/40 text-primary-500 rounded-full flex items-center justify-center border border-primary-500/30 transition-all transform md:group-hover:scale-110"
                                    >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="p-2 bg-dark-900/80 border-t border-white/5">
                            <p className="text-[10px] font-bold text-white truncate">{camera.name}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SidebarLayout({ cameras, setExpandedCamera, activeCameraIds, toggleActiveCamera }) {
    if (cameras.length === 0) return null;
    const [main, ...others] = cameras;
    return (
        <div className="flex flex-col lg:flex-row gap-6 h-full min-h-[600px]">
            <div className="flex-1 aspect-video lg:aspect-auto bg-dark-950 rounded-3xl overflow-hidden border border-primary-500/20 shadow-2xl shadow-primary-900/10 relative group cursor-pointer"
                onClick={() => setExpandedCamera(main)}>
                {activeCameraIds.includes(main.id) ? (
                    <VideoPlayer camera={main} streams={main.streams} onExpand={() => setExpandedCamera(main)} />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900/60 md:group-hover:bg-dark-900/40 transition-colors">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleActiveCamera(main.id);
                            }}
                            className="w-20 h-20 bg-primary-500/20 hover:bg-primary-500/40 text-primary-500 rounded-full flex items-center justify-center border border-primary-500/30 transition-all transform md:group-hover:scale-110"
                        >
                            <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </button>
                        <p className="mt-4 text-sm font-bold text-dark-400 uppercase tracking-widest md:opacity-0 md:group-hover:opacity-100 transition-opacity">Click to Load Main Stream</p>
                    </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                    <h2 className="text-2xl font-black text-white mb-1">{main.name}</h2>
                    <p className="text-sm text-dark-200 font-bold uppercase tracking-wider">{main.location || 'Main View'}</p>
                </div>
            </div>
            <div className="w-full lg:w-80 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar max-h-[80vh]">
                {others.map((camera) => (
                    <div
                        key={camera.id}
                        className="group relative bg-dark-900/40 rounded-xl overflow-hidden border border-white/5 hover:border-primary-500/30 transition-all duration-300 cursor-pointer shrink-0"
                        onClick={() => setExpandedCamera(camera)}
                    >
                        <div className="aspect-video w-full bg-dark-950 relative">
                            {activeCameraIds.includes(camera.id) ? (
                                <VideoPlayer camera={camera} streams={camera.streams} />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center bg-dark-900/60 md:group-hover:bg-dark-900/40 transition-colors">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleActiveCamera(camera.id);
                                        }}
                                        className="w-10 h-10 bg-primary-500/20 hover:bg-primary-500/40 text-primary-500 rounded-full flex items-center justify-center border border-primary-500/30 transition-all transform md:group-hover:scale-110"
                                    >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="p-2 bg-dark-900/80 border-t border-white/5">
                            <p className="text-[10px] font-bold text-white truncate">{camera.name}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
