import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cameraService } from '../services/cameraService';
import recordingService from '../services/recordingService';

function Playback() {
    const [searchParams] = useSearchParams();
    const cameraIdFromUrl = searchParams.get('camera');
    
    const [cameras, setCameras] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);
    const [segments, setSegments] = useState([]);
    const [selectedSegment, setSelectedSegment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [videoError, setVideoError] = useState(null);
    const [debugInfo, setDebugInfo] = useState(null);
    
    const videoRef = useRef(null);
    const timelineRef = useRef(null);

    // Fetch cameras with recording enabled
    useEffect(() => {
        const fetchCameras = async () => {
            try {
                // Use public endpoint for active cameras
                const response = await cameraService.getActiveCameras();
                if (response.success) {
                    const recordingCameras = response.data.filter(cam => cam.enable_recording);
                    setCameras(recordingCameras);
                    
                    // Auto-select camera from URL or first camera
                    if (cameraIdFromUrl) {
                        const camera = recordingCameras.find(c => c.id === parseInt(cameraIdFromUrl));
                        if (camera) setSelectedCamera(camera);
                    } else if (recordingCameras.length > 0) {
                        setSelectedCamera(recordingCameras[0]);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch cameras:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchCameras();
    }, [cameraIdFromUrl]);

    // Fetch segments when camera selected
    useEffect(() => {
        if (!selectedCamera) return;

        const fetchSegments = async () => {
            try {
                const response = await recordingService.getSegments(selectedCamera.id);
                if (response.success && response.data) {
                    // Handle response structure: response.data.segments is the array
                    const segmentsArray = response.data.segments || [];
                    setSegments(segmentsArray);
                    // Auto-select latest segment
                    if (segmentsArray.length > 0) {
                        setSelectedSegment(segmentsArray[segmentsArray.length - 1]);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch segments:', error);
                setSegments([]);
            }
        };

        fetchSegments();
        // Refresh segments every 30 seconds
        const interval = setInterval(fetchSegments, 30000);
        return () => clearInterval(interval);
    }, [selectedCamera]);

    // Initialize video player (native HTML5, no HLS.js needed for MP4)
    useEffect(() => {
        if (!selectedSegment || !videoRef.current || !selectedCamera) return;

        setVideoError(null);
        setDebugInfo(null);

        const streamUrl = `${import.meta.env.VITE_API_URL}/api/recordings/${selectedCamera.id}/stream/${selectedSegment.filename}`;
        
        const debugData = {
            timestamp: new Date().toISOString(),
            camera: { id: selectedCamera.id, name: selectedCamera.name },
            segment: { filename: selectedSegment.filename, size: selectedSegment.file_size },
            streamUrl: streamUrl,
            apiUrl: import.meta.env.VITE_API_URL
        };
        
        console.log('=== VIDEO PLAYER DEBUG ===');
        console.log('Selected Camera:', selectedCamera);
        console.log('Selected Segment:', selectedSegment);
        console.log('Stream URL:', streamUrl);
        console.log('Video Element:', videoRef.current);

        // Test if URL is accessible
        fetch(streamUrl, { method: 'HEAD' })
            .then(response => {
                const headInfo = {
                    status: response.status,
                    statusText: response.statusText,
                    headers: {
                        contentType: response.headers.get('content-type'),
                        contentLength: response.headers.get('content-length'),
                        acceptRanges: response.headers.get('accept-ranges'),
                        cors: response.headers.get('access-control-allow-origin')
                    }
                };
                
                console.log('HEAD Request Response:', headInfo);
                debugData.headResponse = headInfo;
                setDebugInfo(debugData);
                
                if (response.ok) {
                    console.log('✓ URL is accessible');
                    
                    // Set video source
                    videoRef.current.src = streamUrl;
                    videoRef.current.load();
                    
                    console.log('Video src set to:', videoRef.current.src);
                    console.log('Video readyState:', videoRef.current.readyState);
                    console.log('Video networkState:', videoRef.current.networkState);
                    
                } else {
                    const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
                    console.error('✗ URL returned error:', errorMsg);
                    setVideoError(errorMsg);
                }
            })
            .catch(error => {
                const errorMsg = `Network error: ${error.message}`;
                console.error('✗ Failed to fetch URL:', error);
                setVideoError(errorMsg);
                debugData.fetchError = error.message;
                setDebugInfo(debugData);
            });

        // Video event listeners for debugging
        const video = videoRef.current;
        
        const handleLoadStart = () => console.log('Video: loadstart');
        const handleLoadedMetadata = () => {
            console.log('Video: loadedmetadata', {
                duration: video.duration,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight
            });
        };
        const handleLoadedData = () => console.log('Video: loadeddata');
        const handleCanPlay = () => console.log('Video: canplay');
        const handleCanPlayThrough = () => console.log('Video: canplaythrough');
        const handleError = (e) => {
            const errorInfo = {
                error: video.error,
                code: video.error?.code,
                message: video.error?.message,
                networkState: video.networkState,
                readyState: video.readyState
            };
            console.error('Video: error', errorInfo);
            
            // Map error codes to messages
            const errorMessages = {
                1: 'MEDIA_ERR_ABORTED: Video loading aborted',
                2: 'MEDIA_ERR_NETWORK: Network error while loading video',
                3: 'MEDIA_ERR_DECODE: Video decoding failed',
                4: 'MEDIA_ERR_SRC_NOT_SUPPORTED: Video format not supported'
            };
            
            const errorMsg = errorMessages[video.error?.code] || 'Unknown video error';
            setVideoError(errorMsg);
        };
        const handleStalled = () => console.warn('Video: stalled');
        const handleSuspend = () => console.log('Video: suspend');
        const handleAbort = () => console.warn('Video: abort');

        video.addEventListener('loadstart', handleLoadStart);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('loadeddata', handleLoadedData);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('canplaythrough', handleCanPlayThrough);
        video.addEventListener('error', handleError);
        video.addEventListener('stalled', handleStalled);
        video.addEventListener('suspend', handleSuspend);
        video.addEventListener('abort', handleAbort);

        // Try to play after a short delay
        const playTimeout = setTimeout(() => {
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        console.log('✓ Video playing successfully');
                    })
                    .catch(error => {
                        console.error('✗ Play failed:', error.name, error.message);
                        if (error.name !== 'AbortError') {
                            setVideoError(`Play failed: ${error.message}`);
                        }
                    });
            }
        }, 500);

        return () => {
            clearTimeout(playTimeout);
            video.removeEventListener('loadstart', handleLoadStart);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('loadeddata', handleLoadedData);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('canplaythrough', handleCanPlayThrough);
            video.removeEventListener('error', handleError);
            video.removeEventListener('stalled', handleStalled);
            video.removeEventListener('suspend', handleSuspend);
            video.removeEventListener('abort', handleAbort);
            
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.src = '';
            }
        };
    }, [selectedSegment, selectedCamera]);

    // Update current time
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
        const handleLoadedMetadata = () => setDuration(video.duration);

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
    }, [selectedSegment]);

    // Handle playback speed change
    const handleSpeedChange = (speed) => {
        setPlaybackSpeed(speed);
        if (videoRef.current) {
            videoRef.current.playbackRate = speed;
        }
    };

    // Handle segment click
    const handleSegmentClick = (segment) => {
        setSelectedSegment(segment);
    };

    // Format time
    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Format timestamp
    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    // Format file size
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    // Get timeline data
    const getTimelineData = () => {
        if (segments.length === 0) return { start: null, end: null, duration: 0, gaps: [] };

        const sortedSegments = [...segments].sort((a, b) => 
            new Date(a.start_time) - new Date(b.start_time)
        );

        const start = new Date(sortedSegments[0].start_time);
        const end = new Date(sortedSegments[sortedSegments.length - 1].end_time);
        const duration = (end - start) / 1000; // in seconds

        // Detect gaps
        const gaps = [];
        for (let i = 0; i < sortedSegments.length - 1; i++) {
            const currentEnd = new Date(sortedSegments[i].end_time);
            const nextStart = new Date(sortedSegments[i + 1].start_time);
            const gapDuration = (nextStart - currentEnd) / 1000;
            
            // If gap > 30 seconds, consider it a missing segment
            if (gapDuration > 30) {
                gaps.push({
                    start: currentEnd,
                    end: nextStart,
                    duration: gapDuration
                });
            }
        }

        return { start, end, duration, gaps, sortedSegments };
    };

    const timelineData = getTimelineData();

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (cameras.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950">
                <div className="text-center max-w-md mx-auto px-4">
                    <svg className="w-20 h-20 mx-auto mb-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                        Belum Ada Recording Tersedia
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                        Fitur recording sedang dalam proses aktivasi. Silakan cek kembali nanti.
                    </p>
                    <a 
                        href="/" 
                        className="inline-flex items-center gap-2 text-primary-500 hover:text-primary-600 font-medium"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                        Kembali ke Live Stream
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-lg">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Playback Recording</h1>
                    
                    {/* Camera Selector */}
                    <div className="flex items-center gap-4">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Pilih Kamera:</label>
                        <select
                            value={selectedCamera?.id || ''}
                            onChange={(e) => {
                                const camera = cameras.find(c => c.id === parseInt(e.target.value));
                                setSelectedCamera(camera);
                            }}
                            className="flex-1 max-w-md px-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
                        >
                            {cameras.map(camera => (
                                <option key={camera.id} value={camera.id}>
                                    {camera.name} - {camera.location || 'No location'}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Video Player */}
                <div className="bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-lg">
                    <div className="aspect-video bg-black relative">
                        <video
                            ref={videoRef}
                            className="w-full h-full"
                            controls
                            playsInline
                        />
                        
                        {/* Error Overlay */}
                        {videoError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-8">
                                <div className="text-center max-w-md">
                                    <svg className="w-16 h-16 mx-auto mb-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <h3 className="text-xl font-semibold text-white mb-2">Video Error</h3>
                                    <p className="text-red-300 mb-4">{videoError}</p>
                                    <button
                                        onClick={() => {
                                            setVideoError(null);
                                            if (videoRef.current) {
                                                videoRef.current.load();
                                            }
                                        }}
                                        className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors"
                                    >
                                        Retry
                                    </button>
                                </div>
                            </div>
                        )}
                        
                        {/* Speed Control Overlay */}
                        <div className="absolute top-4 right-4 flex gap-2">
                            {[0.5, 1, 1.5, 2].map(speed => (
                                <button
                                    key={speed}
                                    onClick={() => handleSpeedChange(speed)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                        playbackSpeed === speed
                                            ? 'bg-primary-500 text-white'
                                            : 'bg-black/50 text-white hover:bg-black/70'
                                    }`}
                                >
                                    {speed}x
                                </button>
                            ))}
                        </div>

                        {/* Current Segment Info */}
                        {selectedSegment && (
                            <div className="absolute bottom-4 left-4 bg-black/70 text-white px-4 py-2 rounded-lg text-sm">
                                <div className="font-medium">{formatTimestamp(selectedSegment.start_time)}</div>
                                <div className="text-xs text-gray-300">
                                    {formatTime(currentTime)} / {formatTime(duration)}
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {/* Debug Panel */}
                    {debugInfo && (
                        <div className="p-4 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                            <details className="text-sm">
                                <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    🔍 Debug Information (Click to expand)
                                </summary>
                                <div className="mt-2 space-y-2 text-xs font-mono">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="text-gray-600 dark:text-gray-400">Stream URL:</div>
                                        <div className="text-gray-900 dark:text-white break-all">{debugInfo.streamUrl}</div>
                                        
                                        <div className="text-gray-600 dark:text-gray-400">API URL:</div>
                                        <div className="text-gray-900 dark:text-white">{debugInfo.apiUrl}</div>
                                        
                                        <div className="text-gray-600 dark:text-gray-400">Camera ID:</div>
                                        <div className="text-gray-900 dark:text-white">{debugInfo.camera.id}</div>
                                        
                                        <div className="text-gray-600 dark:text-gray-400">Filename:</div>
                                        <div className="text-gray-900 dark:text-white">{debugInfo.segment.filename}</div>
                                        
                                        <div className="text-gray-600 dark:text-gray-400">DB File Size:</div>
                                        <div className="text-gray-900 dark:text-white">{formatFileSize(debugInfo.segment.size)}</div>
                                    </div>
                                    
                                    {debugInfo.headResponse && (
                                        <>
                                            <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                                                <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">HEAD Response:</div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="text-gray-600 dark:text-gray-400">Status:</div>
                                                    <div className={debugInfo.headResponse.status === 200 ? 'text-green-600' : 'text-red-600'}>
                                                        {debugInfo.headResponse.status} {debugInfo.headResponse.statusText}
                                                    </div>
                                                    
                                                    <div className="text-gray-600 dark:text-gray-400">Content-Type:</div>
                                                    <div className="text-gray-900 dark:text-white">{debugInfo.headResponse.headers.contentType || 'N/A'}</div>
                                                    
                                                    <div className="text-gray-600 dark:text-gray-400">Content-Length:</div>
                                                    <div className="text-gray-900 dark:text-white">
                                                        {debugInfo.headResponse.headers.contentLength 
                                                            ? formatFileSize(parseInt(debugInfo.headResponse.headers.contentLength))
                                                            : 'N/A'}
                                                    </div>
                                                    
                                                    <div className="text-gray-600 dark:text-gray-400">Accept-Ranges:</div>
                                                    <div className="text-gray-900 dark:text-white">{debugInfo.headResponse.headers.acceptRanges || 'N/A'}</div>
                                                    
                                                    <div className="text-gray-600 dark:text-gray-400">CORS:</div>
                                                    <div className="text-gray-900 dark:text-white">{debugInfo.headResponse.headers.cors || 'N/A'}</div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                    
                                    {debugInfo.fetchError && (
                                        <div className="border-t border-red-300 dark:border-red-600 pt-2 mt-2">
                                            <div className="font-semibold text-red-600 mb-1">Fetch Error:</div>
                                            <div className="text-red-700 dark:text-red-400">{debugInfo.fetchError}</div>
                                        </div>
                                    )}
                                    
                                    <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                                        <button
                                            onClick={() => {
                                                const url = debugInfo.streamUrl;
                                                window.open(url, '_blank');
                                            }}
                                            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs"
                                        >
                                            Open URL in New Tab
                                        </button>
                                    </div>
                                </div>
                            </details>
                        </div>
                    )}
                </div>

                {/* Timeline */}
                {timelineData.start && (
                    <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-lg">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Timeline</h2>
                        
                        {/* Timeline Bar */}
                        <div className="mb-6">
                            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                                <span>{timelineData.start.toLocaleTimeString('id-ID')}</span>
                                <span>{timelineData.end.toLocaleTimeString('id-ID')}</span>
                            </div>
                            
                            <div 
                                ref={timelineRef}
                                className="relative h-12 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden"
                            >
                                {/* Segments on timeline */}
                                {timelineData.sortedSegments.map((segment) => {
                                    const segmentStart = new Date(segment.start_time);
                                    const segmentEnd = new Date(segment.end_time);
                                    const startOffset = ((segmentStart - timelineData.start) / 1000 / timelineData.duration) * 100;
                                    const width = ((segmentEnd - segmentStart) / 1000 / timelineData.duration) * 100;
                                    
                                    return (
                                        <div
                                            key={segment.id}
                                            onClick={() => handleSegmentClick(segment)}
                                            className={`absolute h-full cursor-pointer transition-colors ${
                                                selectedSegment?.id === segment.id
                                                    ? 'bg-primary-500'
                                                    : 'bg-emerald-500 hover:bg-emerald-600'
                                            }`}
                                            style={{
                                                left: `${startOffset}%`,
                                                width: `${width}%`
                                            }}
                                            title={`${formatTimestamp(segment.start_time)} - ${formatTimestamp(segment.end_time)}`}
                                        />
                                    );
                                })}
                                
                                {/* Gaps on timeline */}
                                {timelineData.gaps.map((gap, index) => {
                                    const startOffset = ((gap.start - timelineData.start) / 1000 / timelineData.duration) * 100;
                                    const width = ((gap.end - gap.start) / 1000 / timelineData.duration) * 100;
                                    
                                    return (
                                        <div
                                            key={`gap-${index}`}
                                            className="absolute h-full bg-red-500/30"
                                            style={{
                                                left: `${startOffset}%`,
                                                width: `${width}%`
                                            }}
                                            title={`Missing: ${Math.round(gap.duration / 60)} minutes`}
                                        />
                                    );
                                })}
                            </div>
                            
                            {/* Legend */}
                            <div className="flex items-center gap-6 mt-3 text-xs text-gray-600 dark:text-gray-400">
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 bg-emerald-500 rounded"></div>
                                    <span>Available</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 bg-primary-500 rounded"></div>
                                    <span>Playing</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 bg-red-500/30 rounded"></div>
                                    <span>Missing</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Segment List */}
                <div className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-lg">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        Recording Segments ({segments.length})
                    </h2>
                    
                    {segments.length > 0 ? (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                            {[...segments].sort((a, b) => 
                                new Date(b.start_time) - new Date(a.start_time)
                            ).map((segment) => (
                                <button
                                    key={segment.id}
                                    onClick={() => handleSegmentClick(segment)}
                                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                                        selectedSegment?.id === segment.id
                                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                            : 'border-gray-200 dark:border-gray-800 hover:border-primary-300 dark:hover:border-primary-700'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                                selectedSegment?.id === segment.id
                                                    ? 'bg-primary-500 text-white'
                                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                                            }`}>
                                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M8 5v14l11-7z"/>
                                                </svg>
                                            </div>
                                            <div>
                                                <div className="font-medium text-gray-900 dark:text-white">
                                                    {formatTimestamp(segment.start_time)} - {formatTimestamp(segment.end_time)}
                                                </div>
                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                    Duration: {Math.round(segment.duration / 60)} min • Size: {formatFileSize(segment.file_size)}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {selectedSegment?.id === segment.id && (
                                            <div className="flex items-center gap-2 text-primary-500">
                                                <svg className="w-5 h-5 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                                                    <circle cx="12" cy="12" r="10"/>
                                                </svg>
                                                <span className="text-sm font-medium">Playing</span>
                                            </div>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12 text-gray-600 dark:text-gray-400">
                            <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <p>Belum ada recording tersedia</p>
                            <p className="text-sm mt-2">Recording akan muncul setelah kamera mulai merekam</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Playback;
