import { useState, useEffect, useRef } from 'react';
import { getSegments, getPlaylistUrl } from '../services/recordingService';
import { cameraService } from '../services/cameraService';
import { useTheme } from '../contexts/ThemeContext';

// Icons
const Icons = {
    Play: () => <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>,
    Pause: () => <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>,
    SkipBack: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/></svg>,
    SkipForward: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>,
    Clock: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    Calendar: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
    Download: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3"/></svg>,
};

/**
 * Format duration (seconds to HH:MM:SS)
 */
const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

/**
 * Format file size
 */
const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

/**
 * Format timestamp
 */
const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
};

export default function Playback() {
    const { theme } = useTheme();
    const videoRef = useRef(null);
    const hlsRef = useRef(null);

    const [cameras, setCameras] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);
    const [segments, setSegments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Video player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    // Load cameras on mount
    useEffect(() => {
        loadCameras();
    }, []);

    const loadCameras = async () => {
        try {
            const response = await cameraService.getActiveCameras();
            setCameras(response.data);
            if (response.data.length > 0) {
                setSelectedCamera(response.data[0].id);
            }
        } catch (err) {
            console.error('Error loading cameras:', err);
            setError('Gagal memuat daftar kamera');
        }
    };

    // Load segments when camera changes
    useEffect(() => {
        if (selectedCamera) {
            loadSegments(selectedCamera);
        }
    }, [selectedCamera]);

    const loadSegments = async (cameraId) => {
        setLoading(true);
        setError(null);
        try {
            const response = await getSegments(cameraId);
            setSegments(response.data.segments || []);
            
            // Initialize HLS player if segments available
            if (response.data.segments && response.data.segments.length > 0) {
                initializePlayer(cameraId);
            }
        } catch (err) {
            console.error('Error loading segments:', err);
            setError('Gagal memuat rekaman');
            setSegments([]);
        } finally {
            setLoading(false);
        }
    };

    const initializePlayer = async (cameraId) => {
        if (!videoRef.current) return;

        // Cleanup previous HLS instance
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        try {
            const Hls = (await import('hls.js')).default;
            
            if (Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: 30,
                });

                const playlistUrl = getPlaylistUrl(cameraId);
                hls.loadSource(playlistUrl);
                hls.attachMedia(videoRef.current);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log('Playlist loaded');
                });

                hls.on(Hls.Events.ERROR, (event, data) => {
                    console.error('HLS Error:', data);
                    if (data.fatal) {
                        setError('Error loading playback');
                    }
                });

                hlsRef.current = hls;
            } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
                // Native HLS support (Safari)
                videoRef.current.src = getPlaylistUrl(cameraId);
            }
        } catch (err) {
            console.error('Error initializing player:', err);
            setError('Gagal menginisialisasi player');
        }
    };

    // Video event handlers
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
        const handleDurationChange = () => setDuration(video.duration);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('durationchange', handleDurationChange);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('durationchange', handleDurationChange);
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
        };
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }
        };
    }, []);

    const togglePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
        }
    };

    const skip = (seconds) => {
        if (videoRef.current) {
            videoRef.current.currentTime += seconds;
        }
    };

    const changeSpeed = (speed) => {
        if (videoRef.current) {
            videoRef.current.playbackRate = speed;
            setPlaybackSpeed(speed);
        }
    };

    const seekTo = (time) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
        }
    };

    const jumpToSegment = (segment) => {
        const segmentIndex = segments.findIndex(s => s.id === segment.id);
        if (segmentIndex !== -1 && videoRef.current) {
            // Calculate time offset (each segment is 10 minutes)
            const timeOffset = segmentIndex * 600;
            videoRef.current.currentTime = timeOffset;
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        📹 Playback Rekaman
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Tonton rekaman CCTV 5-6 jam terakhir
                    </p>
                </div>

                {/* Camera Selector */}
                <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Pilih Kamera
                    </label>
                    <select
                        value={selectedCamera || ''}
                        onChange={(e) => setSelectedCamera(Number(e.target.value))}
                        className="w-full md:w-64 px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500"
                    >
                        {cameras.map(camera => (
                            <option key={camera.id} value={camera.id}>
                                {camera.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Video Player */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden mb-6">
                    <div className="aspect-video bg-black relative">
                        <video
                            ref={videoRef}
                            className="w-full h-full"
                            controls={false}
                        />
                        
                        {loading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                <div className="text-white">Memuat...</div>
                            </div>
                        )}
                        
                        {error && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                <div className="text-red-400">{error}</div>
                            </div>
                        )}
                    </div>

                    {/* Custom Controls */}
                    <div className="p-4 bg-gray-50 dark:bg-gray-900">
                        {/* Timeline */}
                        <div className="mb-4">
                            <input
                                type="range"
                                min="0"
                                max={duration || 0}
                                value={currentTime}
                                onChange={(e) => seekTo(Number(e.target.value))}
                                className="w-full h-2 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mt-1">
                                <span>{formatDuration(currentTime)}</span>
                                <span>{formatDuration(duration)}</span>
                            </div>
                        </div>

                        {/* Control Buttons */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => skip(-10)}
                                    className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                                    title="Mundur 10 detik"
                                >
                                    <Icons.SkipBack />
                                </button>
                                
                                <button
                                    onClick={togglePlayPause}
                                    className="p-3 rounded-lg bg-sky-500 hover:bg-sky-600 text-white transition-colors"
                                >
                                    {isPlaying ? <Icons.Pause /> : <Icons.Play />}
                                </button>
                                
                                <button
                                    onClick={() => skip(10)}
                                    className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                                    title="Maju 10 detik"
                                >
                                    <Icons.SkipForward />
                                </button>
                            </div>

                            {/* Speed Control */}
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Kecepatan:</span>
                                {[0.5, 1, 2, 4].map(speed => (
                                    <button
                                        key={speed}
                                        onClick={() => changeSpeed(speed)}
                                        className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                                            playbackSpeed === speed
                                                ? 'bg-sky-500 text-white'
                                                : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                                        }`}
                                    >
                                        {speed}x
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Segments List */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                        Segmen Rekaman ({segments.length})
                    </h2>
                    
                    {segments.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                            Tidak ada rekaman tersedia
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                            {segments.map((segment, index) => (
                                <button
                                    key={segment.id}
                                    onClick={() => jumpToSegment(segment)}
                                    className="p-3 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-sky-100 dark:hover:bg-sky-900 transition-colors text-left"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <Icons.Clock />
                                        <span className="font-medium text-sm">
                                            {formatTime(segment.start_time)}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {formatFileSize(segment.file_size)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
