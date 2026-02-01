import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cameraService } from '../services/cameraService';
import recordingService from '../services/recordingService';
import CodecBadge from '../components/CodecBadge';
import { getCodecWarning, getCodecDescription } from '../utils/codecSupport';
import { useBranding } from '../contexts/BrandingContext';

// CRITICAL: Maximum safe seek distance (3 minutes = 180 seconds)
// Seeking beyond this may cause buffering issues due to keyframe intervals
const MAX_SEEK_DISTANCE = 180;

function Playback() {
    const [searchParams] = useSearchParams();
    const cameraIdFromUrl = searchParams.get('camera');
    const { branding } = useBranding();
    
    const [cameras, setCameras] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);
    const [segments, setSegments] = useState([]);
    const [selectedSegment, setSelectedSegment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [videoError, setVideoError] = useState(null);
    const [errorType, setErrorType] = useState(null);
    const [isSeeking, setIsSeeking] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [snapshotNotification, setSnapshotNotification] = useState(null);

    // Error message mapping - konsisten dengan MapView/GridView
    const getErrorInfo = () => {
        const errors = {
            codec: { 
                title: 'Codec Tidak Didukung', 
                desc: 'Browser Anda tidak mendukung codec H.265/HEVC yang digunakan kamera ini. Coba gunakan browser lain seperti Safari.',
                color: 'yellow',
                icon: (
                    <svg className="w-10 h-10 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                )
            },
            network: { 
                title: 'Koneksi Gagal', 
                desc: 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.',
                color: 'orange',
                icon: (
                    <svg className="w-10 h-10 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"/>
                    </svg>
                )
            },
            default: { 
                title: 'Video Tidak Tersedia', 
                desc: 'Terjadi kesalahan saat memuat video. Silakan coba lagi.',
                color: 'red',
                icon: (
                    <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                )
            }
        };
        return errors[errorType] || errors.default;
    };

    const errorColorClasses = {
        yellow: 'bg-yellow-500/20',
        orange: 'bg-orange-500/20',
        red: 'bg-red-500/20'
    };
    const [seekWarning, setSeekWarning] = useState(null); // Warning toast for long seeks
    const [seekProgress, setSeekProgress] = useState(null); // Progress info for seeking
    const [autoPlayNotification, setAutoPlayNotification] = useState(null); // Notification for auto-play next segment
    
    // Auto-play toggle state with localStorage persistence
    const [autoPlayEnabled, setAutoPlayEnabled] = useState(() => {
        // Load from localStorage, default to true if not set
        const saved = localStorage.getItem('playback-autoplay-enabled');
        return saved !== null ? saved === 'true' : true;
    });
    
    // Handle auto-play toggle with localStorage persistence
    const handleAutoPlayToggle = () => {
        const newValue = !autoPlayEnabled;
        setAutoPlayEnabled(newValue);
        localStorage.setItem('playback-autoplay-enabled', String(newValue));
        
        // Show feedback notification
        setAutoPlayNotification({
            type: newValue ? 'enabled' : 'disabled',
            message: newValue 
                ? 'Auto-play diaktifkan - segment berikutnya akan diputar otomatis' 
                : 'Auto-play dinonaktifkan - video akan berhenti di akhir segment'
        });
        
        // Auto-hide notification after 3 seconds
        setTimeout(() => {
            setAutoPlayNotification(null);
        }, 3000);
    };
    
    const videoRef = useRef(null);
    const timelineRef = useRef(null);
    const containerRef = useRef(null);
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
        setAutoPlayNotification(null); // Clear auto-play notification
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
            setAutoPlayNotification(null); // Clear auto-play notification
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
        setErrorType(null);

        // Use getSegmentStreamUrl from recordingService (handles IP and domain)
        const streamUrl = recordingService.getSegmentStreamUrl(selectedCamera.id, selectedSegment.filename);
        
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
                // Map error codes to messages and types
                const errorMessages = {
                    1: 'MEDIA_ERR_ABORTED: Video loading aborted',
                    2: 'MEDIA_ERR_NETWORK: Network error while loading video',
                    3: 'MEDIA_ERR_DECODE: Video decoding failed',
                    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED: Video format not supported (old segment format)'
                };
                
                const errorMsg = errorMessages[video.error?.code] || 'Unknown video error';
                setVideoError(errorMsg);
                
                // Detect error type for better error display
                if (video.error?.code === 4) {
                    // Check if it's codec issue (H.265 not supported)
                    if (selectedCamera?.video_codec === 'h265') {
                        setErrorType('codec');
                    } else {
                        setErrorType('default');
                    }
                } else if (video.error?.code === 2) {
                    setErrorType('network');
                } else {
                    setErrorType('default');
                }
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

        // CRITICAL: Apply playback speed after video loads
        const handleLoadedMetadataForSpeed = () => {
            console.log('[Speed] Applying playback speed:', playbackSpeed);
            video.playbackRate = playbackSpeed;
        };
        
        video.addEventListener('loadedmetadata', handleLoadedMetadataForSpeed);
        
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
            video.removeEventListener('loadedmetadata', handleLoadedMetadataForSpeed); // Cleanup speed listener
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
    }, [selectedSegment, selectedCamera]); // CRITICAL: Don't add playbackSpeed - causes video reload!

    // CRITICAL: Separate useEffect for playback speed changes (without reloading video)
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        
        // Apply speed change immediately without reloading video
        console.log('[Speed] Applying speed change:', playbackSpeed);
        video.playbackRate = playbackSpeed;
    }, [playbackSpeed]); // Only depend on playbackSpeed

    // Update current time and handle seeking
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
        const handleLoadedMetadata = () => setDuration(video.duration);
        
        // CRITICAL: Auto-play next segment when current video ends
        const handleEnded = () => {
            console.log('[Video] Ended - looking for next segment');
            
            // Check if auto-play is enabled
            if (!autoPlayEnabled) {
                console.log('[Video] Auto-play disabled by user - stopping playback');
                
                // Show notification that playback stopped
                setAutoPlayNotification({
                    type: 'stopped',
                    message: 'Video selesai - Auto-play dinonaktifkan'
                });
                
                // Auto-hide after 5 seconds
                setTimeout(() => {
                    setAutoPlayNotification(null);
                }, 5000);
                
                return; // Early return - don't auto-play
            }
            
            if (!selectedSegment || segments.length === 0) {
                console.log('[Video] No segment selected or no segments available');
                return;
            }
            
            // Find current segment index
            // IMPORTANT: Segments are sorted DESC (newest first) in the array
            const currentIndex = segments.findIndex(s => s.id === selectedSegment.id);
            
            if (currentIndex === -1) {
                console.log('[Video] Current segment not found in segments array');
                return;
            }
            
            // Next segment chronologically is at currentIndex - 1 (because DESC order)
            // Example: [segment3, segment2, segment1] - if playing segment2 (index 1), next is segment3 (index 0)
            const nextSegment = segments[currentIndex - 1];
            
            if (nextSegment) {
                // Check for gap between segments
                const currentEnd = new Date(selectedSegment.end_time);
                const nextStart = new Date(nextSegment.start_time);
                const gapSeconds = (nextStart - currentEnd) / 1000;
                
                console.log('[Video] Next segment found:', {
                    nextSegmentId: nextSegment.id,
                    currentEnd: currentEnd.toISOString(),
                    nextStart: nextStart.toISOString(),
                    gapSeconds: gapSeconds
                });
                
                // Show gap warning if gap > 30 seconds
                if (gapSeconds > 30) {
                    const gapMinutes = Math.round(gapSeconds / 60);
                    console.log(`[Video] Gap detected: ${gapMinutes} minutes missing`);
                    
                    // Show notification about gap
                    setAutoPlayNotification({
                        type: 'gap',
                        message: `Melewati ${gapMinutes} menit rekaman yang hilang`
                    });
                } else {
                    // Show normal auto-play notification
                    setAutoPlayNotification({
                        type: 'next',
                        message: 'Memutar segment berikutnya...'
                    });
                }
                
                // Auto-hide notification after 3 seconds
                setTimeout(() => {
                    setAutoPlayNotification(null);
                }, 3000);
                
                // Auto-play next segment
                console.log('[Video] Auto-playing next segment:', nextSegment.id);
                setSelectedSegment(nextSegment);
                
                // Clear any existing warnings/errors for smooth transition
                setVideoError(null);
                setErrorType(null);
                setSeekWarning(null);
                setSeekProgress(null);
            } else {
                console.log('[Video] No more segments - playback complete');
                
                // Show completion notification
                setAutoPlayNotification({
                    type: 'complete',
                    message: 'Playback selesai - tidak ada segment lagi'
                });
                
                // Auto-hide after 5 seconds
                setTimeout(() => {
                    setAutoPlayNotification(null);
                }, 5000);
            }
        };
        
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
            setErrorType(null);
            
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
        video.addEventListener('ended', handleEnded); // CRITICAL: Auto-play next segment
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
            video.removeEventListener('ended', handleEnded); // CRITICAL: Cleanup
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
    }, [selectedSegment, autoPlayEnabled]); // FIX: Hapus 'segments' dari deps - menyebabkan re-register event listener yang rusak autoplay

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
        
        // REMOVED: Tidak perlu reset speed di sini
        // Speed akan di-apply otomatis oleh useEffect saat video load
        // Biarkan user mempertahankan speed preference mereka
        
        // Clear states saat ganti segment
        setSeekWarning(null);
        setSeekProgress(null);
        setAutoPlayNotification(null); // Clear auto-play notification
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

    // Fullscreen handling
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullscreen = async () => {
        try {
            if (!document.fullscreenElement) {
                await containerRef.current?.requestFullscreen?.();
            } else {
                await document.exitFullscreen?.();
            }
        } catch (err) {
            console.error('Fullscreen error:', err);
        }
    };

    // Snapshot with watermark (client-side Canvas API)
    const takeSnapshot = async () => {
        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
            setSnapshotNotification({ type: 'error', message: 'Video belum siap untuk snapshot' });
            setTimeout(() => setSnapshotNotification(null), 3000);
            return;
        }

        try {
            const video = videoRef.current;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');

            // Draw video frame
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Add watermark (bottom-right corner)
            const watermarkHeight = Math.max(40, canvas.height * 0.08);
            const padding = watermarkHeight * 0.3;
            const fontSize = watermarkHeight * 0.4;
            
            // Semi-transparent background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(
                canvas.width - (watermarkHeight * 4) - padding,
                canvas.height - watermarkHeight - padding,
                watermarkHeight * 4,
                watermarkHeight
            );

            // Logo circle
            const logoSize = watermarkHeight * 0.6;
            const logoX = canvas.width - (watermarkHeight * 3.5) - padding;
            const logoY = canvas.height - (watermarkHeight / 2) - padding;
            
            ctx.fillStyle = '#0ea5e9';
            ctx.beginPath();
            ctx.arc(logoX, logoY, logoSize / 2, 0, Math.PI * 2);
            ctx.fill();

            // Logo text
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${logoSize * 0.6}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(branding.logo_text || 'R', logoX, logoY);

            // Company name
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(
                branding.company_name || 'RAF NET',
                logoX + logoSize / 2 + padding / 2,
                logoY - fontSize / 3
            );

            // Timestamp
            ctx.font = `${fontSize * 0.7}px Arial`;
            ctx.fillStyle = '#94a3b8';
            const timestamp = new Date().toLocaleString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            ctx.fillText(
                timestamp,
                logoX + logoSize / 2 + padding / 2,
                logoY + fontSize / 2
            );

            // Convert to blob
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    setSnapshotNotification({ type: 'error', message: 'Gagal membuat snapshot' });
                    setTimeout(() => setSnapshotNotification(null), 3000);
                    return;
                }

                const filename = `${selectedCamera?.name || 'camera'}-${Date.now()}.png`;

                // Try Web Share API first (mobile-friendly)
                if (navigator.share && navigator.canShare) {
                    try {
                        const file = new File([blob], filename, { type: 'image/png' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file],
                                title: `Snapshot - ${selectedCamera?.name || 'Camera'}`,
                                text: `Snapshot dari ${branding.company_name} CCTV`
                            });
                            setSnapshotNotification({ type: 'success', message: 'Snapshot berhasil dibagikan!' });
                            setTimeout(() => setSnapshotNotification(null), 3000);
                            return;
                        }
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            console.log('Share cancelled or failed:', err);
                        }
                    }
                }

                // Fallback: Download
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                link.click();
                URL.revokeObjectURL(url);

                setSnapshotNotification({ type: 'success', message: 'Snapshot berhasil diunduh!' });
                setTimeout(() => setSnapshotNotification(null), 3000);
            }, 'image/png', 0.95);

        } catch (error) {
            console.error('Snapshot error:', error);
            setSnapshotNotification({ type: 'error', message: 'Gagal mengambil snapshot' });
            setTimeout(() => setSnapshotNotification(null), 3000);
        }
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
                    
                    {/* Camera Info - Compact header with codec badge */}
                    {selectedCamera && (
                        <div className="p-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700/50">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {selectedCamera.name}
                                </span>
                                {selectedCamera.video_codec && (
                                    <CodecBadge codec={selectedCamera.video_codec} size="sm" showWarning={false} />
                                )}
                            </div>
                            {/* Location */}
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
                    
                    {/* Auto-Play Toggle - Modern toggle switch */}
                    <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-1">
                                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                                </svg>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                        Auto-play Segment Berikutnya
                                    </div>
                                    <div className="text-xs text-gray-600 dark:text-gray-400">
                                        {autoPlayEnabled 
                                            ? 'Video akan otomatis lanjut ke segment berikutnya' 
                                            : 'Video akan berhenti di akhir segment'}
                                    </div>
                                </div>
                            </div>
                            
                            {/* Toggle Switch */}
                            <button
                                onClick={handleAutoPlayToggle}
                                className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                    autoPlayEnabled 
                                        ? 'bg-blue-600' 
                                        : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                                role="switch"
                                aria-checked={autoPlayEnabled}
                                aria-label="Toggle auto-play"
                            >
                                <span
                                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                        autoPlayEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Video Player */}
                <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl overflow-hidden shadow-lg">
                    {/* Auto-Play Notification - OUTSIDE video container to avoid being covered */}
                    {autoPlayNotification && (
                        <div className="relative z-50 p-3 sm:p-4">
                            <div className={`px-4 sm:px-5 py-3 rounded-xl shadow-2xl border-2 ${
                                autoPlayNotification.type === 'complete' 
                                    ? 'bg-green-500 border-green-400'
                                    : autoPlayNotification.type === 'gap'
                                    ? 'bg-yellow-500 border-yellow-400'
                                    : autoPlayNotification.type === 'enabled'
                                    ? 'bg-green-500 border-green-400'
                                    : autoPlayNotification.type === 'disabled'
                                    ? 'bg-gray-500 border-gray-400'
                                    : autoPlayNotification.type === 'stopped'
                                    ? 'bg-gray-500 border-gray-400'
                                    : 'bg-blue-500 border-blue-400'
                            } text-white`}>
                                <div className="flex items-start gap-3">
                                    {autoPlayNotification.type === 'complete' || autoPlayNotification.type === 'enabled' ? (
                                        <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                    ) : autoPlayNotification.type === 'gap' ? (
                                        <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                    ) : autoPlayNotification.type === 'disabled' || autoPlayNotification.type === 'stopped' ? (
                                        <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                                        </svg>
                                    ) : (
                                        <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-sm sm:text-base">{autoPlayNotification.message}</p>
                                    </div>
                                    <button
                                        onClick={() => setAutoPlayNotification(null)}
                                        className="flex-shrink-0 text-white hover:text-gray-200 transition-colors"
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
                    
                    <div className="aspect-video bg-black relative" ref={containerRef}>
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
                        
                        {/* Error Overlay - Konsisten dengan MapView/GridView */}
                        {videoError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-8">
                                <div className="text-center max-w-md">
                                    {(() => {
                                        const info = getErrorInfo();
                                        const colorClass = errorColorClasses[info.color] || errorColorClasses.red;
                                        return (
                                            <>
                                                <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${colorClass} flex items-center justify-center`}>
                                                    {info.icon}
                                                </div>
                                                <h3 className="text-white font-semibold text-lg mb-2">{info.title}</h3>
                                                <p className="text-gray-400 text-sm mb-4">{info.desc}</p>
                                            </>
                                        );
                                    })()}
                                    <button
                                        onClick={() => {
                                            setVideoError(null);
                                            setErrorType(null);
                                            if (videoRef.current) {
                                                videoRef.current.load();
                                            }
                                        }}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium transition-colors"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        Coba Lagi
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

                        {/* Snapshot & Fullscreen Controls - Bottom Right */}
                        {!isFullscreen && (
                            <div className="absolute bottom-16 sm:bottom-20 right-2 sm:right-4 flex flex-col gap-2 z-30">
                                {/* Snapshot Button */}
                                <button
                                    onClick={takeSnapshot}
                                    disabled={!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2}
                                    className="p-2 sm:p-2.5 bg-black/70 hover:bg-black/90 disabled:bg-black/40 disabled:cursor-not-allowed text-white rounded-lg transition-all shadow-lg hover:scale-110 disabled:scale-100"
                                    title="Ambil Snapshot & Share"
                                >
                                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </button>
                                
                                {/* Fullscreen Button */}
                                <button
                                    onClick={toggleFullscreen}
                                    className="p-2 sm:p-2.5 bg-black/70 hover:bg-black/90 text-white rounded-lg transition-all shadow-lg hover:scale-110"
                                    title="Fullscreen"
                                >
                                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                    </svg>
                                </button>
                            </div>
                        )}

                        {/* Fullscreen Mode Controls */}
                        {isFullscreen && (
                            <div className="absolute inset-0 z-50 pointer-events-none">
                                {/* Top bar with camera name and exit */}
                                <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <h2 className="text-white font-bold text-lg">{selectedCamera?.name}</h2>
                                            {selectedCamera?.video_codec && (
                                                <CodecBadge codec={selectedCamera.video_codec} size="sm" showWarning={false} />
                                            )}
                                        </div>
                                        <button onClick={toggleFullscreen} className="p-2 hover:bg-white/20 rounded-xl text-white bg-white/10">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>

                                {/* Bottom right controls */}
                                <div className="absolute bottom-20 right-4 flex flex-col gap-2 pointer-events-auto">
                                    <button
                                        onClick={takeSnapshot}
                                        disabled={!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2}
                                        className="p-3 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:cursor-not-allowed text-white rounded-xl transition-all shadow-lg"
                                        title="Ambil Snapshot & Share"
                                    >
                                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Snapshot Notification */}
                        {snapshotNotification && (
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                                <div className={`px-5 py-3 rounded-xl shadow-2xl border-2 ${
                                    snapshotNotification.type === 'success'
                                        ? 'bg-green-500 border-green-400'
                                        : 'bg-red-500 border-red-400'
                                } text-white animate-slide-down`}>
                                    <div className="flex items-center gap-3">
                                        {snapshotNotification.type === 'success' ? (
                                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                        ) : (
                                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                        <p className="font-semibold text-sm">{snapshotNotification.message}</p>
                                    </div>
                                </div>
                            </div>
                        )}

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
                    
                    {/* Codec Info Bar - Simpel dan Elegan (konsisten dengan Map/Grid view) */}
                    {selectedCamera?.video_codec && selectedCamera.video_codec === 'h265' && (
                        <div className="p-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                            <div className="flex items-start gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <div className="flex-1 text-xs text-yellow-400 dark:text-yellow-400">
                                    <strong>Codec H.265:</strong> Terbaik di Safari. Chrome/Edge tergantung hardware device.
                                </div>
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
