import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { streamService } from '../services/streamService';
import { useTheme } from '../contexts/ThemeContext';
import Hls from 'hls.js';

// Icons
const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>,
    Grid: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>,
    Camera: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
    Search: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
    Close: () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
    Location: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    Expand: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>,
    ZoomIn: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>,
    ZoomOut: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" /></svg>,
    Reset: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
    Filter: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>,
    Layout1: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} /></svg>,
    Layout2: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="8" height="18" rx="1" strokeWidth={2} /><rect x="13" y="3" width="8" height="18" rx="1" strokeWidth={2} /></svg>,
    Layout3: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="5" height="18" rx="1" strokeWidth={2} /><rect x="10" y="3" width="5" height="18" rx="1" strokeWidth={2} /><rect x="17" y="3" width="4" height="18" rx="1" strokeWidth={2} /></svg>,
    Check: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
    Play: () => <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>,
    Fullscreen: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>,
};


// Video Player Component with zoom support
function VideoPlayer({ camera, streams, isExpanded = false, onClose }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const containerRef = useRef(null);
    const [status, setStatus] = useState('loading');
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        if (!streams?.hls || !videoRef.current) return;
        const video = videoRef.current;
        
        const initPlayer = () => {
            setStatus('loading');
            if (Hls.isSupported()) {
                const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
                hlsRef.current = hls;
                hls.loadSource(streams.hls);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().then(() => setStatus('playing')).catch(() => setStatus('error'));
                });
                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (data.fatal) setStatus('error');
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = streams.hls;
                video.addEventListener('loadedmetadata', () => {
                    video.play().then(() => setStatus('playing')).catch(() => setStatus('error'));
                });
            }
        };
        initPlayer();
        return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } };
    }, [streams]);

    useEffect(() => {
        const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handleFsChange);
        document.addEventListener('webkitfullscreenchange', handleFsChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFsChange);
            document.removeEventListener('webkitfullscreenchange', handleFsChange);
        };
    }, []);

    const handleZoom = (delta) => {
        const newZoom = Math.min(Math.max(1, zoom + delta), 4);
        setZoom(newZoom);
        if (newZoom === 1) setPan({ x: 0, y: 0 });
    };

    const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

    const handlePointerDown = (e) => {
        if (zoom <= 1) return;
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    };

    const handlePointerMove = (e) => {
        if (!isDragging || zoom <= 1) return;
        const bounds = 100 * (zoom - 1);
        setPan({
            x: Math.min(Math.max(e.clientX - dragStart.x, -bounds), bounds),
            y: Math.min(Math.max(e.clientY - dragStart.y, -bounds), bounds)
        });
    };

    const handlePointerUp = () => setIsDragging(false);

    const toggleFullscreen = async () => {
        if (!containerRef.current) return;
        try {
            if (!document.fullscreenElement) {
                await (containerRef.current.requestFullscreen?.() || containerRef.current.webkitRequestFullscreen?.());
            } else {
                await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
            }
        } catch (e) { console.error(e); }
    };

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden" style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
            onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}>
            <video ref={videoRef} className="w-full h-full transition-transform duration-100"
                style={{ transform: `scale(${zoom}) translate(${pan.x/zoom}px, ${pan.y/zoom}px)`, objectFit: isExpanded ? 'contain' : 'cover', cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
                muted playsInline controls={false} />
            
            {status === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <div className="w-10 h-10 border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                </div>
            )}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <div className="text-center text-white">
                        <p className="text-sm">Stream unavailable</p>
                    </div>
                </div>
            )}

            {isExpanded && (
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />LIVE
                            </span>
                            <span className="text-white text-sm font-medium">{camera.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={() => handleZoom(-0.5)} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"><Icons.ZoomOut /></button>
                            <span className="px-2 text-white text-xs font-mono">{Math.round(zoom * 100)}%</span>
                            <button onClick={() => handleZoom(0.5)} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"><Icons.ZoomIn /></button>
                            <button onClick={resetZoom} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"><Icons.Reset /></button>
                            <button onClick={toggleFullscreen} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"><Icons.Fullscreen /></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


// Camera Card Component
function CameraCard({ camera, onExpand, isSelected, onSelect, selectionCount }) {
    const [showPreview, setShowPreview] = useState(false);
    const canSelect = selectionCount < 3 || isSelected;

    return (
        <div className={`group relative bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border-2 ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-gray-200 dark:border-gray-700'}`}>
            <div className="aspect-video bg-gray-100 dark:bg-gray-900 relative"
                onMouseEnter={() => setShowPreview(true)} onMouseLeave={() => setShowPreview(false)}
                onTouchStart={() => setShowPreview(true)} onTouchEnd={() => setShowPreview(false)}>
                {showPreview ? (
                    <VideoPlayer camera={camera} streams={camera.streams} />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                            <div className="w-14 h-14 mx-auto mb-2 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-400">
                                <Icons.Play />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Tap to preview</p>
                        </div>
                    </div>
                )}
                <div className="absolute top-3 left-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Live
                    </span>
                </div>
                <button onClick={() => canSelect && onSelect(camera.id)}
                    className={`absolute top-3 right-3 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white/80 dark:bg-gray-800/80 border-gray-300 dark:border-gray-600'} ${!canSelect && !isSelected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    {isSelected && <Icons.Check />}
                </button>
            </div>
            <div className="p-4">
                <h3 className="font-semibold text-gray-900 dark:text-white truncate">{camera.name}</h3>
                {camera.location && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1"><Icons.Location /><span className="truncate">{camera.location}</span></p>}
                {camera.area_name && <span className="mt-2 inline-block px-2 py-0.5 text-xs font-medium rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">{camera.area_name}</span>}
            </div>
            <button onClick={() => onExpand(camera)} className="absolute bottom-4 right-4 p-2 rounded-lg bg-gray-900/80 dark:bg-white/10 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-900 dark:hover:bg-white/20">
                <Icons.Expand />
            </button>
        </div>
    );
}


// Multi-view Layout Component
function MultiViewLayout({ cameras, layout, onExpand }) {
    const gridClass = layout === 1 ? 'grid-cols-1' : layout === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3';
    return (
        <div className={`grid ${gridClass} gap-4`}>
            {cameras.slice(0, layout).map(camera => (
                <div key={camera.id} className="relative aspect-video bg-black rounded-2xl overflow-hidden shadow-lg">
                    <VideoPlayer camera={camera} streams={camera.streams} isExpanded={true} />
                    <div className="absolute top-3 left-3 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm">
                        <p className="text-white text-sm font-medium">{camera.name}</p>
                    </div>
                    <button onClick={() => onExpand(camera)} className="absolute top-3 right-3 p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white">
                        <Icons.Expand />
                    </button>
                </div>
            ))}
        </div>
    );
}

// Filter Panel Component
function FilterPanel({ isOpen, onClose, filters, setFilters, areas, locations }) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-2xl p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Filters</h3>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><Icons.Close /></button>
                </div>
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Area</label>
                        <div className="flex flex-wrap gap-2">
                            {areas.map(area => (
                                <button key={area} onClick={() => setFilters(f => ({ ...f, area }))}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filters.area === area ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                                    {area}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Location</label>
                        <div className="flex flex-wrap gap-2">
                            {locations.map(loc => (
                                <button key={loc} onClick={() => setFilters(f => ({ ...f, location: f.location === loc ? 'All' : loc }))}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filters.location === loc ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                                    {loc}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sort By</label>
                        <select value={filters.sortBy} onChange={e => setFilters(f => ({ ...f, sortBy: e.target.value }))}
                            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border-0 rounded-lg text-gray-900 dark:text-white">
                            <option value="name">Name</option>
                            <option value="location">Location</option>
                            <option value="area">Area</option>
                        </select>
                    </div>
                </div>
                <div className="mt-6 flex gap-3">
                    <button onClick={() => setFilters({ area: 'All', location: 'All', sortBy: 'name' })}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium">
                        Reset
                    </button>
                    <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-medium">Apply</button>
                </div>
            </div>
        </div>
    );
}


// Main Landing Page Component
export default function LandingPage() {
    const { theme, toggleTheme } = useTheme();
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedCamera, setExpandedCamera] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState([]);
    const [viewMode, setViewMode] = useState('grid'); // grid, multi
    const [multiLayout, setMultiLayout] = useState(2);
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState({ area: 'All', location: 'All', sortBy: 'name' });

    useEffect(() => { loadCameras(); }, []);

    const loadCameras = async () => {
        try {
            setLoading(true);
            const response = await streamService.getAllActiveStreams();
            if (response.success) setCameras(response.data);
            else setError('Failed to load cameras');
        } catch { setError('Connection failed'); }
        finally { setLoading(false); }
    };

    const areas = useMemo(() => ['All', ...new Set(cameras.map(c => c.area_name || 'Uncategorized'))], [cameras]);
    const locations = useMemo(() => ['All', ...new Set(cameras.filter(c => c.location).map(c => c.location))], [cameras]);

    const filteredCameras = useMemo(() => {
        let result = cameras.filter(c => {
            const matchSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.location?.toLowerCase().includes(searchQuery.toLowerCase());
            const matchArea = filters.area === 'All' || (c.area_name || 'Uncategorized') === filters.area;
            const matchLoc = filters.location === 'All' || c.location === filters.location;
            return matchSearch && matchArea && matchLoc;
        });
        result.sort((a, b) => {
            if (filters.sortBy === 'name') return a.name.localeCompare(b.name);
            if (filters.sortBy === 'location') return (a.location || '').localeCompare(b.location || '');
            if (filters.sortBy === 'area') return (a.area_name || '').localeCompare(b.area_name || '');
            return 0;
        });
        return result;
    }, [cameras, searchQuery, filters]);

    const selectedCameras = useMemo(() => selectedIds.map(id => cameras.find(c => c.id === id)).filter(Boolean), [selectedIds, cameras]);

    const toggleSelect = useCallback((id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : prev.length < 3 ? [...prev, id] : prev);
    }, []);

    const activeFiltersCount = (filters.area !== 'All' ? 1 : 0) + (filters.location !== 'All' ? 1 : 0);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
            {/* Header */}
            <header className="sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                                <Icons.Camera />
                            </div>
                            <div className="hidden sm:block">
                                <h1 className="text-lg font-bold text-gray-900 dark:text-white">RAF NET CCTV</h1>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Live Monitoring</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {selectedIds.length > 0 && (
                                <div className="hidden sm:flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                                    {[1, 2, 3].map(n => (
                                        <button key={n} onClick={() => { setViewMode('multi'); setMultiLayout(n); }} disabled={selectedIds.length < n}
                                            className={`p-2 rounded-md transition-colors ${viewMode === 'multi' && multiLayout === n ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'} ${selectedIds.length < n ? 'opacity-30' : ''}`}>
                                            {n === 1 ? <Icons.Layout1 /> : n === 2 ? <Icons.Layout2 /> : <Icons.Layout3 />}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                                <Icons.Grid />
                            </button>
                            <button onClick={toggleTheme} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">
                                {theme === 'dark' ? <Icons.Sun /> : <Icons.Moon />}
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                {/* Search & Filters */}
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400"><Icons.Search /></div>
                        <input type="text" placeholder="Search cameras..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <button onClick={() => setShowFilters(true)} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 hover:border-blue-300">
                        <Icons.Filter />
                        <span>Filters</span>
                        {activeFiltersCount > 0 && <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">{activeFiltersCount}</span>}
                    </button>
                </div>

                {/* Selection Bar */}
                {selectedIds.length > 0 && (
                    <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
                        <div className="flex items-center gap-3">
                            <div className="flex -space-x-2">
                                {selectedCameras.map((c, i) => (
                                    <div key={c.id} className="w-8 h-8 rounded-full bg-blue-600 border-2 border-white dark:border-gray-900 flex items-center justify-center text-white text-xs font-bold" style={{ zIndex: 3 - i }}>{i + 1}</div>
                                ))}
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedIds.length}/3 selected</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Choose layout above to view</p>
                            </div>
                        </div>
                        <button onClick={() => setSelectedIds([])} className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg">Clear</button>
                    </div>
                )}

                {/* Content */}
                {loading && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-12 h-12 border-4 border-gray-200 dark:border-gray-700 border-t-blue-500 rounded-full animate-spin" />
                        <p className="mt-4 text-gray-500 dark:text-gray-400">Loading cameras...</p>
                    </div>
                )}

                {error && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <p className="text-gray-900 dark:text-white font-medium mb-4">{error}</p>
                        <button onClick={loadCameras} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Retry</button>
                    </div>
                )}

                {!loading && !error && cameras.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4 text-gray-400"><Icons.Camera /></div>
                        <p className="text-gray-900 dark:text-white font-medium">No cameras available</p>
                    </div>
                )}

                {!loading && !error && filteredCameras.length > 0 && (
                    <>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Showing {filteredCameras.length} of {cameras.length} cameras</p>
                        {viewMode === 'multi' && selectedCameras.length > 0 ? (
                            <MultiViewLayout cameras={selectedCameras} layout={multiLayout} onExpand={setExpandedCamera} />
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {filteredCameras.map(camera => (
                                    <CameraCard key={camera.id} camera={camera} onExpand={setExpandedCamera} isSelected={selectedIds.includes(camera.id)} onSelect={toggleSelect} selectionCount={selectedIds.length} />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* Expanded Modal */}
            {expandedCamera && (
                <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-2 sm:p-4" onClick={() => setExpandedCamera(null)}>
                    <div className="relative w-full max-w-6xl bg-gray-900 rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-gray-800">
                            <div>
                                <h2 className="text-lg font-semibold text-white">{expandedCamera.name}</h2>
                                {expandedCamera.location && <p className="text-sm text-gray-400 flex items-center gap-1"><Icons.Location />{expandedCamera.location}</p>}
                            </div>
                            <button onClick={() => setExpandedCamera(null)} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400"><Icons.Close /></button>
                        </div>
                        <div className="aspect-video"><VideoPlayer camera={expandedCamera} streams={expandedCamera.streams} isExpanded={true} /></div>
                    </div>
                </div>
            )}

            <FilterPanel isOpen={showFilters} onClose={() => setShowFilters(false)} filters={filters} setFilters={setFilters} areas={areas} locations={locations} />

            <footer className="border-t border-gray-200 dark:border-gray-800 mt-12">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <p className="text-center text-sm text-gray-500 dark:text-gray-400">© {new Date().getFullYear()} RAF NET CCTV</p>
                </div>
            </footer>
        </div>
    );
}
