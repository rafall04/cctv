import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cameraService } from '../services/cameraService';
import recordingService from '../services/recordingService';
import CodecBadge from '../components/CodecBadge';
import { getCodecWarning, getCodecDescription } from '../utils/codecSupport';

// CRITICAL: Maximum safe seek distance (3 minutes = 180 seconds)
// Seeking beyond this may cause buffering issues due to keyframe intervals
const MAX_SEEK_DISTANCE = 180;

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
    const [isSeeking, setIsSeeking] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [seekWarning, setSeekWarning] = useState(null); // Warning toast for long seeks
    const [seekProgress, setSeekProgress] = useState(null); // Progress info for seeking
    
    const videoRef = useRef(null);
    const timelineRef = useRef(null);
    const isInitialLoadRef = useRef(true); // Track initial load
    const lastSeekTimeRef = useRef(0); // Track last seek position for smart limiting
    const bufferingTimeoutRef = useRef(null); // Track buffering timeout

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

        // CRITICAL FIX: Reset selected segment saat camera berubah
        // Ini mencegah HTTP 404 karena segment dari camera lama
        setSelectedSegment(null);
        setSegments([]); // Clear segments array juga
        isInitialLoadRef.current = true; // Mark as initial load
        
        // CRITICAL FIX: Reset seeking/buffering states saat camera berubah
        setIsSeeking(false);
        setIsBuffering(false);
        setSeekWarning(null); // Clear warning juga
        setSeekProgress(null); // Clear progress info
        lastSeekTimeRef.current = 0; // Reset last seek position
        if (bufferingTimeoutRef.current) {
            clearTimeout(bufferingTimeoutRef.current);
            bufferingTimeoutRef.current = null;
        }

        const fetchSegments = async () => {
            try {
                const response = await recordingService.getSegments(selectedCamera.id);
                if (response.success && response.data) {
                    // Handle response structure: response.data.segments is the array
                    const segmentsArray = response.data.segments || [];
                    setSegments(segmentsArray);
                    
                    // CRITICAL FIX: Auto-select latest segment ONLY on initial load
                    // Segments diurutkan DESC (terbaru dulu), jadi index 0 = segment terbaru
                    if (segmentsArray.length > 0 && isInitialLoadRef.current) {
                        setSelectedSegment(segmentsArray[0]); // Index 0 = latest segment (DESC order)
                        isInitialLoadRef.current = false; // Mark initial load complete
                    }
                }
            } catch (error) {
                console.error('Failed to fetch segments:', error);
                setSegments([]);
                setSelectedSegment(null); // Clear segment on error
            }
        };

        fetchSegments();
        // Refresh segments every 10 seconds for near real-time updates
        const interval = setInterval(fetchSegments, 10000);
        
        // CRITICAL: Cleanup interval when camera changes
        return () => {
            clearInterval(interval);
            // Clear states on unmount/camera change
            setSegments([]);
            setSelectedSegment(null);
            isInitialLoadRef.current = true; // Reset for next camera
            setIsSeeking(false);
            setIsBuffering(false);
            setSeekWarning(null);
            setSeekProgress(null);
            lastSeekTimeRef.current = 0;
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
                bufferingTimeoutRef.current = null;
            }
        };
    }, [selectedCamera]); // Only depend on selectedCamera

    // Initialize video player (native HTML5, no HLS.js needed for MP4)
    useEffect(() => {
        if (!selectedSegment || !videoRef.current || !selectedCamera) return;

        // CRITICAL VALIDATION: Pastikan segment filename tidak kosong
        // Validasi dasar untuk mencegah request ke URL invalid
        if (!selectedSegment.filename || selectedSegment.filename.trim() === '') {
            console.warn('[Playback] Selected segment has invalid filename, skipping');
            return;
        }

        // Clear previous error state
        setVideoError(null);

        const streamUrl = `${import.meta.env.VITE_API_URL}/api/recordings/${selectedCamera.id}/stream/${selectedSegment.filename}`;
        
        console.log('=== VIDEO PLAYER DEBUG ===');
        console.log('Selected Camera ID:', selectedCamera.id);
        console.log('Selected Segment ID:', selectedSegment.id);
        console.log('Selected Segment Filename:', selectedSegment.filename);
        console.log('Stream URL:', streamUrl);

        // Clear video element first
        const video = videoRef.current;
        video.pause();
        video.removeAttribute('src');
        video.load(); // This triggers 'abort' and 'emptied' events

        // CRITICAL FIX: Use AbortController to cancel fetch on cleanup
        const abortController = new AbortController();

        // Test if URL is accessible
        fetch(streamUrl, { 
            method: 'HEAD',
            signal: abortController.signal // Add abort signal
        })
            .then(response => {
                console.log('HEAD Request Response:', {
                    status: response.status,
                    statusText: response.statusText,
                    contentType: response.headers.get('content-type'),
                    contentLength: response.headers.get('content-length')
                });
                
                if (response.ok) {
                    console.log('✓ URL is accessible');
                    
                    const contentType = response.headers.get('content-type');
                    const contentLength = response.headers.get('content-length');
                    
                    // Check if content-type is correct
                    if (!contentType || !contentType.includes('video')) {
                        const errorMsg = `Invalid Content-Type: ${contentType}`;
                        console.error('✗', errorMsg);
                        setVideoError(errorMsg);
                        return;
                    }
                    
                    // Check if file size is reasonable (> 1MB for 10min segment)
                    const fileSize = parseInt(contentLength || '0');
                    if (fileSize < 1024 * 1024) {
                        const errorMsg = `File too small: ${(fileSize / 1024).toFixed(2)} KB (expected > 1 MB)`;
                        console.error('✗', errorMsg);
                        setVideoError(errorMsg);
                        return;
                    }
                    
                    console.log('File size check passed:', (fileSize / 1024 / 1024).toFixed(2), 'MB');
                    
                    // Set video source (only after validation passed)
                    video.src = streamUrl;
                    video.load();
                    
                    console.log('Video src set to:', video.src);
                    
                } else {
                    const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
                    console.error('✗ URL returned error:', errorMsg);
                    setVideoError(errorMsg);
                }
            })
            .catch(error => {
                // Ignore AbortError - this is expected during cleanup
                if (error.name === 'AbortError') {
                    console.log('✓ Fetch aborted (cleanup)');
                    return;
                }
                
                const errorMsg = `Network error: ${error.message}`;
                console.error('✗ Failed to fetch URL:', error);
                setVideoError(errorMsg);
            });

        // Video event listeners for debugging
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
            
            // Only set error if it's not an "Empty src" error (which happens during cleanup)
            if (video.error && video.error.message && !video.error.message.includes('Empty src')) {
                // Map error codes to messages
                const errorMessages = {
                    1: 'MEDIA_ERR_ABORTED: Video loading aborted',
                    2: 'MEDIA_ERR_NETWORK: Network error while loading video',
                    3: 'MEDIA_ERR_DECODE: Video decoding failed',
                    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED: Video format not supported (old segment format)'
                };
                
                const errorMsg = errorMessages[video.error?.code] || 'Unknown video error';
                setVideoError(errorMsg);
            }
        };
        const handleStalled = () => console.warn('Video: stalled');
        const handleSuspend = () => console.log('Video: suspend');
        const handleAbort = () => {
            console.log('Video: abort (cleanup)');
            // Don't set error on abort - this is expected during cleanup
        };

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
            if (video.readyState >= 2) { // HAVE_CURRENT_DATA or better
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            console.log('✓ Video playing successfully');
                            setVideoError(null); // Clear any previous errors
                        })
                        .catch(error => {
                            console.error('✗ Play failed:', error.name, error.message);
                            if (error.name !== 'AbortError') {
                                setVideoError(`Play failed: ${error.message}`);
                            }
                        });
                }
            }
        }, 500);

        return () => {
            // CRITICAL: Abort fetch request to prevent 404 errors from old camera
            abortController.abort();
            
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
            
            // Proper cleanup
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
    }, [selectedSegment, selectedCamera]); // CRITICAL: Don't add segments to dependency - causes reload every 10s

    // Update current time and handle seeking
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
        const handleLoadedMetadata = () => setDuration(video.duration);
        
        // CRITICAL: Intercept seeking with smart limiter
        const handleSeeking = () => {
            const targetTime = video.currentTime;
            const previousTime = lastSeekTimeRef.current || 0;
            const seekDistance = Math.abs(targetTime - previousTime);
            
            console.log('[Seek] Target:', targetTime, 'Previous:', previousTime, 'Distance:', seekDistance);
            
            // If seek distance exceeds limit, apply limiter
            if (seekDistance > MAX_SEEK_DISTANCE) {
                const direction = targetTime > previousTime ? 1 : -1;
                const limitedTarget = previousTime + (MAX_SEEK_DISTANCE * direction);
                
                console.log('[Seek] Limited to:', limitedTarget);
                
                // Show warning - use callback to avoid re-render during seek
                setTimeout(() => {
                    setSeekWarning({ type: 'limit' });
                }, 0);
                
                // Force limited seek
                video.currentTime = limitedTarget;
                lastSeekTimeRef.current = limitedTarget;
            } else {
                // Normal seek - clear warning if it was a limit warning (use callback)
                if (seekWarning?.type === 'limit') {
                    setTimeout(() => setSeekWarning(null), 0);
                }
                
                // Update last seek position for next check
                lastSeekTimeRef.current = targetTime;
            }
            
            // Show seeking indicator
            setIsSeeking(true);
            setIsBuffering(true);
            setVideoError(null);
            
            // Clear any existing buffering timeout
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
            }
        };
        
        const handleSeeked = () => {
            console.log('[Seek] Seeked event fired, readyState:', video.readyState);
            setIsSeeking(false);
            
            // DON'T immediately clear buffering - wait for video to actually start playing
            // Set a timeout to clear buffering if video doesn't start playing
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
            }
            
            bufferingTimeoutRef.current = setTimeout(() => {
                console.log('[Seek] Buffering timeout - forcing clear');
                setIsBuffering(false);
            }, 5000); // 5 second timeout (increased from 3s)
            
            // CRITICAL: Only try to play if video was already playing before seek
            // Don't force play if user paused the video
            if (!video.paused && video.readyState >= 2) {
                // Video is already playing or ready to play, let it continue naturally
                console.log('[Seek] Video will continue playing naturally');
            } else if (!video.paused) {
                // Video wants to play but not ready yet, try to play
                console.log('[Seek] Attempting to resume playback');
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            console.log('[Seek] Play successful after seek');
                        })
                        .catch(error => {
                            console.error('[Video] Play after seek failed:', error);
                            // Don't retry - let user click play if needed
                            setIsBuffering(false);
                        });
                }
            } else {
                // Video is paused, clear buffering immediately
                console.log('[Seek] Video is paused, clearing buffering');
                setIsBuffering(false);
            }
        };
        
        const handleWaiting = () => {
            console.log('[Video] Waiting for data...');
            setIsBuffering(true);
        };
        
        const handlePlaying = () => {
            console.log('[Video] Playing');
            setIsBuffering(false);
            
            // Clear buffering timeout when video starts playing
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
                bufferingTimeoutRef.current = null;
            }
        };
        
        const handleCanPlay = () => {
            console.log('[Video] Can play');
            setIsBuffering(false);
            
            // Clear buffering timeout
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
                bufferingTimeoutRef.current = null;
            }
        };
        
        const handleStalled = () => {
            console.warn('[Video] Stalled at:', video.currentTime);
            setIsBuffering(true);
            
            // Try to recover from stall
            setTimeout(() => {
                if (video.readyState < 3 && video.networkState !== 3) {
                    const currentPos = video.currentTime;
                    const wasPaused = video.paused;
                    
                    video.load();
                    
                    const onLoadedMetadata = () => {
                        video.currentTime = currentPos;
                        if (!wasPaused) {
                            video.play().catch(e => console.error('[Video] Recovery play failed:', e));
                        }
                        video.removeEventListener('loadedmetadata', onLoadedMetadata);
                    };
                    
                    video.addEventListener('loadedmetadata', onLoadedMetadata);
                }
            }, 2000);
        };
        
        const handleProgress = () => {
            // Monitor buffer status
            if (video.buffered.length > 0) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                const bufferedSeconds = bufferedEnd - video.currentTime;
                
                if (bufferedSeconds < 5 && !video.paused) {
                    console.log('[Video] Low buffer:', bufferedSeconds.toFixed(1), 's');
                }
            }
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('seeking', handleSeeking);
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('stalled', handleStalled);
        video.addEventListener('progress', handleProgress);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('seeking', handleSeeking);
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('stalled', handleStalled);
            video.removeEventListener('progress', handleProgress);
            
            // Clear buffering timeout
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
                bufferingTimeoutRef.current = null;
            }
        };
    }, [selectedSegment]); // CRITICAL: Remove seekWarning from deps - it causes video reload!

    // CRITICAL: Smart Seek Handler with 3-minute limit
    const handleSmartSeek = (targetTime) => {
        if (!videoRef.current) return;
        
        const currentPos = videoRef.current.currentTime;
        const seekDistance = Math.abs(targetTime - currentPos);
        
        console.log('[SmartSeek] Target:', targetTime, 'Current:', currentPos, 'Distance:', seekDistance);
        
        // If seek distance is within safe range, allow direct seek
        if (seekDistance <= MAX_SEEK_DISTANCE) {
            videoRef.current.currentTime = targetTime;
            lastSeekTimeRef.current = targetTime;
            
            // Clear limit warning if exists
            if (seekWarning?.type === 'limit') {
                setSeekWarning(null);
            }
            return;
        }
        
        // Long seek detected - limit to MAX_SEEK_DISTANCE
        const direction = targetTime > currentPos ? 1 : -1;
        const limitedTarget = currentPos + (MAX_SEEK_DISTANCE * direction);
        
        console.log('[SmartSeek] Limited to:', limitedTarget);
        
        // Show simple warning
        setSeekWarning({ type: 'limit' });
        
        // Perform limited seek
        videoRef.current.currentTime = limitedTarget;
        lastSeekTimeRef.current = limitedTarget;
    };
    
    // Handle timeline click with smart seek
    const handleTimelineClick = (e) => {
        if (!videoRef.current || !timelineRef.current) return;
        
        const rect = timelineRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        const targetTime = percentage * duration;
        
        handleSmartSeek(targetTime);
    };

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
        // Clear states saat ganti segment
        setSeekWarning(null);
        setSeekProgress(null);
        setIsSeeking(false);
        setIsBuffering(false);
        lastSeekTimeRef.current = 0;
        if (bufferingTimeoutRef.current) {
            clearTimeout(bufferingTimeoutRef.current);
            bufferingTimeoutRef.current = null;
        }
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
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-2 sm:py-6 md:py-8 px-2 sm:px-4">
            <div className="max-w-7xl mx-auto space-y-3 sm:space-y-4 md:space-y-6">
                {/* Header */}
                <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6 shadow-lg space-y-3 sm:space-y-4">
                    <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Playback Recording</h1>
                    
                    {/* Camera Selector */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                            Pilih Kamera:
                        </label>
                        <select
                            value={selectedCamera?.id || ''}
                            onChange={(e) => {
                                const camera = cameras.find(c => c.id === parseInt(e.target.value));
                                setSelectedCamera(camera);
                            }}
                            className="flex-1 px-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                            {cameras.map(camera => (
                                <option key={camera.id} value={camera.id}>
                                    {camera.name} - {camera.location || 'No location'}
                                </option>
                            ))}
                        </select>
                    </div>
                    
                    {/* Camera Info - Compact header without codec details */}
                    {selectedCamera && (
                        <div className="p-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700/50">
                            {/* Location only */}
                            {selectedCamera.location && (
                                <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 text-sm">
                                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                                    </svg>
                                    <span>{selectedCamera.location}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Video Player */}
                <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl overflow-hidden shadow-lg">
                    {/* Seek Warning Toast - OUTSIDE video container to avoid being covered */}
                    {seekWarning && (
                        <div className="relative z-50 p-3 sm:p-4">
                            <div className="bg-blue-500 text-white px-4 sm:px-5 py-3 rounded-xl shadow-2xl border-2 border-blue-400">
                                <div className="flex items-start gap-3">
                                    <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-sm sm:text-base">Video maksimal lompat 3 menit</p>
                                    </div>
                                    <button
                                        onClick={() => setSeekWarning(null)}
                                        className="flex-shrink-0 text-white hover:text-blue-200 transition-colors"
                                        aria-label="Tutup"
                                    >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <div className="aspect-video bg-black relative">
                        <video
                            ref={videoRef}
                            className="w-full h-full object-contain"
                            controls
                            playsInline
                            preload="metadata"
                            crossOrigin="anonymous"
                        />
                        
                        {/* Buffering/Seeking Indicator with Better UX */}
                        {(isBuffering || isSeeking) && !videoError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none z-40">
                                <div className="text-center bg-black/80 px-8 py-6 rounded-xl">
                                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-white mb-4 mx-auto"></div>
                                    <p className="text-white text-lg font-medium mb-2">
                                        {isSeeking ? 'Memuat video...' : 'Buffering...'}
                                    </p>
                                    <p className="text-gray-300 text-sm">
                                        {isSeeking ? 'Mohon tunggu, video sedang dimuat' : 'Menunggu data video'}
                                    </p>
                                </div>
                            </div>
                        )}
                        
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
                        
                        {/* Speed Control Overlay - Visible on all devices */}
                        <div className="flex absolute top-2 sm:top-4 right-2 sm:right-4 gap-1 sm:gap-2 z-30">
                            {[0.5, 1, 1.5, 2].map(speed => (
                                <button
                                    key={speed}
                                    onClick={() => handleSpeedChange(speed)}
                                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all shadow-lg ${
                                        playbackSpeed === speed
                                            ? 'bg-primary-500 text-white scale-110'
                                            : 'bg-black/70 text-white hover:bg-black/90 hover:scale-105'
                                    }`}
                                    title={`Kecepatan ${speed}x`}
                                >
                                    {speed}x
                                </button>
                            ))}
                        </div>

                        {/* Current Segment Info - Hidden on mobile to not block controls */}
                        {selectedSegment && (
                            <div className="hidden sm:block absolute bottom-16 sm:bottom-4 right-2 sm:right-4 bg-black/70 text-white px-2 sm:px-4 py-1 sm:py-2 rounded text-xs sm:text-sm pointer-events-none">
                                <div className="font-medium">{formatTimestamp(selectedSegment.start_time)}</div>
                                <div className="text-xs text-gray-300">
                                    {formatTime(currentTime)} / {formatTime(duration)}
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {/* Codec Info Bar - Below video, consistent with Map/Grid view */}
                    {selectedCamera?.video_codec && (
                        <div className="p-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                            <div className="flex flex-wrap items-center gap-3">
                                {/* Codec Badge */}
                                <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    <span className="text-sm text-gray-600 dark:text-gray-400">
                                        Codec: <strong className="text-gray-900 dark:text-white">{selectedCamera.video_codec.toUpperCase()}</strong>
                                    </span>
                                    <CodecBadge codec={selectedCamera.video_codec} size="sm" showWarning={true} />
                                </div>
                                
                                {/* H265 Warning */}
                                {selectedCamera.video_codec === 'h265' && (() => {
                                    const warning = getCodecWarning(selectedCamera.video_codec);
                                    if (warning) {
                                        return (
                                            <>
                                                <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                                                    warning.severity === 'error' 
                                                        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' 
                                                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                                                }`}>
                                                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                                    </svg>
                                                    <span className="whitespace-nowrap">{warning.shortMessage}</span>
                                                </div>
                                            </>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                            
                            {/* Codec Description - Compact */}
                            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                                {selectedCamera.video_codec === 'h264' ? (
                                    <span>✓ Kompatibel dengan semua browser</span>
                                ) : (
                                    <span>⚠️ H.265 lebih hemat bandwidth, tapi hanya Safari yang full support</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Playback Info Box */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-blue-200 dark:border-blue-800">
                    <div className="flex items-start gap-3">
                        <div className="flex-shrink-0">
                            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="flex-1">
                            <h3 className="text-sm sm:text-base font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
                                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>Cara Menggunakan Playback</span>
                            </h3>
                            <ul className="space-y-1.5 text-xs sm:text-sm text-blue-800 dark:text-blue-200">
                                <li className="flex items-start gap-2">
                                    <span className="flex-shrink-0 mt-0.5">•</span>
                                    <span><strong>Skip Video:</strong> Maksimal lompat 3 menit per sekali skip untuk menghindari buffering lama</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="flex-shrink-0 mt-0.5">•</span>
                                    <span><strong>Timeline:</strong> Klik pada timeline untuk melompat ke waktu tertentu</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="flex-shrink-0 mt-0.5">•</span>
                                    <span><strong>Kecepatan:</strong> Klik tombol di pojok kanan atas video untuk mengatur kecepatan (0.5x - 2x)</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="flex-shrink-0 mt-0.5">•</span>
                                    <span><strong>Segment:</strong> Pilih segment di bawah untuk melihat recording pada waktu berbeda</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="flex-shrink-0 mt-0.5">•</span>
                                    <span><strong>Stuck Loading:</strong> Jika loading lebih dari 10 detik, coba skip video perlahan 30 detik - 1 menit untuk mengatasi stuck</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Timeline */}
                {timelineData.start && (
                    <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6 shadow-lg">
                        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">Timeline</h2>
                        
                        {/* Timeline Bar */}
                        <div className="mb-4 sm:mb-6">
                            <div className="flex justify-between text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-2">
                                <span>{timelineData.start.toLocaleTimeString('id-ID')}</span>
                                <span>{timelineData.end.toLocaleTimeString('id-ID')}</span>
                            </div>
                            
                            <div 
                                ref={timelineRef}
                                onClick={handleTimelineClick}
                                className="relative h-8 sm:h-10 md:h-12 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer"
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
                <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6 shadow-lg">
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">
                        Recording Segments ({segments.length})
                    </h2>
                    
                    {segments.length > 0 ? (
                        <div className="space-y-2 max-h-64 sm:max-h-80 md:max-h-96 overflow-y-auto">
                            {[...segments].sort((a, b) => 
                                new Date(b.start_time) - new Date(a.start_time)
                            ).map((segment) => {
                                // Segment is likely compatible if duration is reasonable (> 1 minute)
                                // Old format segments often have very short duration or very large file size relative to duration
                                const isLikelyCompatible = segment.duration >= 60; // At least 1 minute
                                
                                return (
                                    <button
                                        key={segment.id}
                                        onClick={() => handleSegmentClick(segment)}
                                        className={`w-full text-left p-2 sm:p-3 md:p-4 rounded-lg border-2 transition-all ${
                                            selectedSegment?.id === segment.id
                                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                                : 'border-gray-200 dark:border-gray-800 hover:border-primary-300 dark:hover:border-primary-700'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                                                <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                                    selectedSegment?.id === segment.id
                                                        ? 'bg-primary-500 text-white'
                                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                                                }`}>
                                                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M8 5v14l11-7z"/>
                                                    </svg>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <div className="font-medium text-sm sm:text-base text-gray-900 dark:text-white truncate">
                                                            {formatTimestamp(segment.start_time)} - {formatTimestamp(segment.end_time)}
                                                        </div>
                                                        {!isLikelyCompatible && (
                                                            <span className="px-1.5 sm:px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded flex-shrink-0">
                                                                May not play
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">
                                                        Duration: {Math.round(segment.duration / 60)} min • Size: {formatFileSize(segment.file_size)}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {selectedSegment?.id === segment.id && (
                                                <div className="flex items-center gap-1 sm:gap-2 text-primary-500 flex-shrink-0">
                                                    <svg className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                                                        <circle cx="12" cy="12" r="10"/>
                                                    </svg>
                                                    <span className="hidden sm:inline text-sm font-medium">Playing</span>
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center py-8 sm:py-12 text-gray-600 dark:text-gray-400">
                            <svg className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <p className="text-sm sm:text-base">Belum ada recording tersedia</p>
                            <p className="text-xs sm:text-sm mt-2">Recording akan muncul setelah kamera mulai merekam</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Playback;
