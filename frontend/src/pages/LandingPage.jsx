import { useEffect, useState, useMemo } from 'react';
import { streamService } from '../services/streamService';
import VideoPlayer from '../components/VideoPlayer';
import { useTheme } from '../contexts/ThemeContext';

const SunIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
);

const MoonIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
);

const GridIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
);

const ListIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
);

const CameraIcon = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const SearchIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);

const CloseIcon = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const LocationIcon = () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

function CameraCard({ camera, onExpand }) {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <div
            className="group relative bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-200 dark:border-gray-700"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="aspect-video bg-gray-100 dark:bg-gray-900 relative">
                {isHovered ? (
                    <VideoPlayer camera={camera} streams={camera.streams} />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                                <CameraIcon />
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Hover to preview</p>
                        </div>
                    </div>
                )}
                
                <div className="absolute top-3 left-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        Live
                    </span>
                </div>
            </div>

            <div className="p-4">
                <h3 className="font-semibold text-gray-900 dark:text-white truncate">{camera.name}</h3>
                {camera.location && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <LocationIcon />
                        <span className="truncate">{camera.location}</span>
                    </p>
                )}
                {camera.area_name && (
                    <span className="mt-2 inline-block px-2 py-0.5 text-xs font-medium rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                        {camera.area_name}
                    </span>
                )}
            </div>

            <button
                onClick={() => onExpand(camera)}
                className="absolute bottom-4 right-4 p-2 rounded-lg bg-gray-900/80 dark:bg-white/10 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-900 dark:hover:bg-white/20"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
            </button>
        </div>
    );
}

export default function LandingPage() {
    const { theme, toggleTheme } = useTheme();
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedCamera, setExpandedCamera] = useState(null);
    const [layout, setLayout] = useState('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedArea, setSelectedArea] = useState('All');

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
            setError('Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    const areas = useMemo(() => {
        const areaSet = new Set(cameras.map(c => c.area_name || 'Uncategorized'));
        return ['All', ...Array.from(areaSet)];
    }, [cameras]);

    const filteredCameras = useMemo(() => {
        return cameras.filter(c => {
            const matchesSearch = !searchQuery ||
                c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (c.location && c.location.toLowerCase().includes(searchQuery.toLowerCase()));
            const matchesArea = selectedArea === 'All' || (c.area_name || 'Uncategorized') === selectedArea;
            return matchesSearch && matchesArea;
        });
    }, [cameras, searchQuery, selectedArea]);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
            <header className="sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                                <CameraIcon />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-gray-900 dark:text-white">RAF NET CCTV</h1>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Live Monitoring</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="hidden sm:flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                                <button
                                    onClick={() => setLayout('grid')}
                                    className={`p-2 rounded-md transition-colors ${layout === 'grid' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                                >
                                    <GridIcon />
                                </button>
                                <button
                                    onClick={() => setLayout('list')}
                                    className={`p-2 rounded-md transition-colors ${layout === 'list' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                                >
                                    <ListIcon />
                                </button>
                            </div>

                            <button
                                onClick={toggleTheme}
                                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            >
                                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                    <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                            <SearchIcon />
                        </div>
                        <input
                            type="text"
                            placeholder="Search cameras..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 no-scrollbar">
                        {areas.map(area => (
                            <button
                                key={area}
                                onClick={() => setSelectedArea(area)}
                                className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                                    selectedArea === area
                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                                }`}
                            >
                                {area}
                            </button>
                        ))}
                    </div>
                </div>

                {loading && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-12 h-12 border-4 border-gray-200 dark:border-gray-700 border-t-blue-500 rounded-full animate-spin"></div>
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
                        <p className="text-gray-900 dark:text-white font-medium mb-2">Connection Error</p>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">{error}</p>
                        <button
                            onClick={loadCameras}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {!loading && !error && cameras.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                            <CameraIcon />
                        </div>
                        <p className="text-gray-900 dark:text-white font-medium">No cameras available</p>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">Check back later</p>
                    </div>
                )}

                {!loading && !error && filteredCameras.length > 0 && (
                    <>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            Showing {filteredCameras.length} of {cameras.length} cameras
                        </p>

                        <div className={layout === 'grid' 
                            ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                            : 'space-y-4'
                        }>
                            {filteredCameras.map(camera => (
                                <CameraCard
                                    key={camera.id}
                                    camera={camera}
                                    onExpand={setExpandedCamera}
                                />
                            ))}
                        </div>
                    </>
                )}
            </main>

            {expandedCamera && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setExpandedCamera(null)}
                >
                    <div
                        className="relative w-full max-w-5xl bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{expandedCamera.name}</h2>
                                {expandedCamera.location && (
                                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                        <LocationIcon />
                                        {expandedCamera.location}
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={() => setExpandedCamera(null)}
                                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
                            >
                                <CloseIcon />
                            </button>
                        </div>
                        <div className="aspect-video bg-black">
                            <VideoPlayer
                                camera={expandedCamera}
                                streams={expandedCamera.streams}
                                isExpanded={true}
                                enableZoom={true}
                            />
                        </div>
                    </div>
                </div>
            )}

            <footer className="border-t border-gray-200 dark:border-gray-800 mt-12">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                        © {new Date().getFullYear()} RAF NET CCTV. Secure Monitoring System.
                    </p>
                </div>
            </footer>
        </div>
    );
}
