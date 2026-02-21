import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { cameraService } from '../services/cameraService';
import recordingService from '../services/recordingService';
import { useBranding } from '../contexts/BrandingContext';

import PlaybackHeader from '../components/playback/PlaybackHeader';
import PlaybackVideo from '../components/playback/PlaybackVideo';
import PlaybackTimeline from '../components/playback/PlaybackTimeline';
import PlaybackSegmentList from '../components/playback/PlaybackSegmentList';

const MAX_SEEK_DISTANCE = 180;

function Playback() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
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
    const [seekWarning, setSeekWarning] = useState(null);
    const [autoPlayNotification, setAutoPlayNotification] = useState(null);
    const [autoPlayEnabled, setAutoPlayEnabled] = useState(() => {
        const saved = localStorage.getItem('playback-autoplay-enabled');
        return saved !== null ? saved === 'true' : true;
    });
    
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const isInitialLoadRef = useRef(true);
    const lastSeekTimeRef = useRef(0);
    const bufferingTimeoutRef = useRef(null);
    
    // Refs to avoid stale closures in event handlers
    const selectedSegmentRef = useRef(selectedSegment);
    const segmentsRef = useRef(segments);
    const autoPlayEnabledRef = useRef(autoPlayEnabled);
    const selectedCameraRef = useRef(selectedCamera);
    
    // Keep refs in sync
    useEffect(() => {
        selectedSegmentRef.current = selectedSegment;
    }, [selectedSegment]);
    
    useEffect(() => {
        segmentsRef.current = segments;
    }, [segments]);
    
    useEffect(() => {
        autoPlayEnabledRef.current = autoPlayEnabled;
    }, [autoPlayEnabled]);
    
    useEffect(() => {
        selectedCameraRef.current = selectedCamera;
    }, [selectedCamera]);

    const handleAutoPlayToggle = useCallback(() => {
        const newValue = !autoPlayEnabled;
        setAutoPlayEnabled(newValue);
        localStorage.setItem('playback-autoplay-enabled', String(newValue));
        
        setAutoPlayNotification({
            type: newValue ? 'enabled' : 'disabled',
            message: newValue 
                ? 'Auto-play diaktifkan - segment berikutnya akan diputar otomatis' 
                : 'Auto-play dinonaktifkan - video akan berhenti di akhir segment'
        });
        
        setTimeout(() => {
            setAutoPlayNotification(null);
        }, 3000);
    }, [autoPlayEnabled]);

    const isInitialMountRef = useRef(true);

    // Fetch cameras effect
    useEffect(() => {
        const fetchCameras = async () => {
            try {
                const response = await cameraService.getActiveCameras();
                if (response.success) {
                    const recordingCameras = response.data.filter(cam => cam.enable_recording);
                    const uniqueCameras = recordingCameras.filter((cam, index, self) => 
                        index === self.findIndex(c => c.id === cam.id)
                    );
                    
                    setCameras(uniqueCameras);
                    
                    if (cameraIdFromUrl) {
                        const camera = uniqueCameras.find(c => c.id === parseInt(cameraIdFromUrl));
                        if (camera) {
                            setSelectedCamera(camera);
                        }
                    } else if (uniqueCameras.length > 0) {
                        setSelectedCamera(uniqueCameras[0]);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch cameras:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchCameras();
    }, []);

    // URL camera change effect
    useEffect(() => {
        if (!isInitialMountRef.current && cameraIdFromUrl && cameras.length > 0) {
            const camera = cameras.find(c => c.id === parseInt(cameraIdFromUrl));
            if (camera && camera.id !== selectedCamera?.id) {
                setSelectedCamera(camera);
            }
        }
        isInitialMountRef.current = false;
    }, [cameraIdFromUrl, cameras, selectedCamera]);

    // Effect to select segment from URL when segments are loaded
    useEffect(() => {
        if (segments.length === 0) return;
        
        const timestampFromUrl = searchParams.get('t');
        if (timestampFromUrl && !selectedSegment) {
            const targetTime = parseInt(timestampFromUrl);
            const segmentFromUrl = segments.find(s => {
                const startTime = new Date(s.start_time).getTime();
                const endTime = new Date(s.end_time).getTime();
                return targetTime >= startTime && targetTime <= endTime;
            });
            if (segmentFromUrl) {
                setSelectedSegment(segmentFromUrl);
            } else {
                const closestSegment = segments.reduce((prev, curr) => {
                    const prevDiff = Math.abs(new Date(prev.start_time).getTime() - targetTime);
                    const currDiff = Math.abs(new Date(curr.start_time).getTime() - targetTime);
                    return currDiff < prevDiff ? curr : prev;
                }, segments[0]);
                setSelectedSegment(closestSegment);
            }
        }
    }, [segments, selectedSegment, searchParams]);

    // Fetch segments effect
    useEffect(() => {
        if (!selectedCamera) {
            return;
        }

        setSelectedSegment(null);
        setSegments([]);
        setIsSeeking(false);
        setIsBuffering(false);
        setSeekWarning(null);
        setAutoPlayNotification(null);
        lastSeekTimeRef.current = 0;
        if (bufferingTimeoutRef.current) {
            clearTimeout(bufferingTimeoutRef.current);
            bufferingTimeoutRef.current = null;
        }

        const fetchSegments = async () => {
            try {
                const response = await recordingService.getSegments(selectedCamera.id);
                if (response.success && response.data) {
                    const segmentsArray = response.data.segments || [];
                    setSegments(segmentsArray);
                } else {
                    console.warn('API response not successful:', response);
                }
            } catch (error) {
                console.error('Failed to fetch segments:', error);
                setSegments([]);
                setSelectedSegment(null);
            }
        };

        fetchSegments();
        const interval = setInterval(fetchSegments, 10000);
        
        return () => {
            clearInterval(interval);
            setSegments([]);
            setSelectedSegment(null);
        };
    }, [selectedCamera]);

    useEffect(() => {
        if (!selectedSegment || !videoRef.current || !selectedCamera) return;

        if (!selectedSegment.filename || selectedSegment.filename.trim() === '') {
            return;
        }

        setVideoError(null);
        setErrorType(null);

        const streamUrl = recordingService.getSegmentStreamUrl(selectedCamera.id, selectedSegment.filename);
        const video = videoRef.current;
        video.pause();
        video.removeAttribute('src');
        video.load();

        const abortController = new AbortController();

        fetch(streamUrl, { method: 'HEAD', signal: abortController.signal })
            .then(response => {
                if (response.ok) {
                    const contentType = response.headers.get('content-type');
                    const contentLength = response.headers.get('content-length');
                    
                    if (!contentType || !contentType.includes('video')) {
                        setVideoError(`Invalid Content-Type: ${contentType}`);
                        return;
                    }
                    
                    const fileSize = parseInt(contentLength || '0');
                    if (fileSize < 1024 * 1024) {
                        setVideoError(`File too small: ${(fileSize / 1024).toFixed(2)} KB`);
                        return;
                    }
                    
                    video.src = streamUrl;
                    video.load();
                } else {
                    setVideoError(`HTTP ${response.status}: ${response.statusText}`);
                }
            })
            .catch(error => {
                if (error.name !== 'AbortError') {
                    setVideoError(`Network error: ${error.message}`);
                }
            });

        // Remove the handler here since we have a separate useEffect for playback speed
        const playTimeout = setTimeout(() => {
            if (video.readyState >= 2) {
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        if (error.name !== 'AbortError') {
                            setVideoError(`Play failed: ${error.message}`);
                        }
                    });
                }
            }
        }, 500);

        return () => {
            abortController.abort();
            clearTimeout(playTimeout);
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
    }, [selectedSegment, selectedCamera]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.playbackRate = playbackSpeed;
    }, [playbackSpeed]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
        const handleLoadedMetadata = () => setDuration(video.duration);
        
        const handleEnded = () => {
            if (!autoPlayEnabledRef.current) {
                setAutoPlayNotification({ type: 'stopped', message: 'Video selesai - Auto-play dinonaktifkan' });
                setTimeout(() => setAutoPlayNotification(null), 5000);
                return;
            }
            
            const currentSegment = selectedSegmentRef.current;
            const currentSegments = segmentsRef.current;
            
            if (!currentSegment || currentSegments.length === 0) return;
            
            const currentIndex = currentSegments.findIndex(s => s.id === currentSegment.id);
            if (currentIndex === -1) return;
            
            const nextSegment = currentSegments[currentIndex - 1];
            
            if (nextSegment) {
                const currentEnd = new Date(currentSegment.end_time);
                const nextStart = new Date(nextSegment.start_time);
                const gapSeconds = (nextStart - currentEnd) / 1000;
                
                if (gapSeconds > 30) {
                    const gapMinutes = Math.round(gapSeconds / 60);
                    setAutoPlayNotification({ type: 'gap', message: `Melewati ${gapMinutes} menit rekaman yang hilang` });
                } else {
                    setAutoPlayNotification({ type: 'next', message: 'Memutar segment berikutnya...' });
                }
                
                setTimeout(() => setAutoPlayNotification(null), 3000);
                setSelectedSegment(nextSegment);
                const timestamp = new Date(nextSegment.start_time).getTime();
                setSearchParams({ 
                    camera: selectedCameraRef.current?.id.toString(), 
                    t: timestamp.toString() 
                }, { replace: false });
            } else {
                setAutoPlayNotification({ type: 'complete', message: 'Playback selesai - tidak ada segment lagi' });
                setTimeout(() => setAutoPlayNotification(null), 5000);
            }
        };
        
        const handleSeeking = () => {
            const targetTime = video.currentTime;
            const previousTime = lastSeekTimeRef.current || 0;
            const seekDistance = Math.abs(targetTime - previousTime);
            
            if (seekDistance > MAX_SEEK_DISTANCE) {
                const direction = targetTime > previousTime ? 1 : -1;
                const limitedTarget = previousTime + (MAX_SEEK_DISTANCE * direction);
                video.currentTime = limitedTarget;
                lastSeekTimeRef.current = limitedTarget;
                setSeekWarning({ type: 'limit' });
            } else {
                lastSeekTimeRef.current = targetTime;
            }
            
            setIsSeeking(true);
            setIsBuffering(true);
            setVideoError(null);
            setErrorType(null);
        };
        
        const handleSeeked = () => {
            setIsSeeking(false);
            
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
            }
            
            bufferingTimeoutRef.current = setTimeout(() => {
                setIsBuffering(false);
            }, 5000);
        };
        
        const handleWaiting = () => setIsBuffering(true);
        const handlePlaying = () => {
            setIsBuffering(false);
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
            }
        };
        
        const handleCanPlay = () => setIsBuffering(false);
        
        const handleStalled = () => {
            setIsBuffering(true);
            setTimeout(() => {
                if (video.readyState < 3) {
                    video.load();
                }
            }, 2000);
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('ended', handleEnded);
        video.addEventListener('seeking', handleSeeking);
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('stalled', handleStalled);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('seeking', handleSeeking);
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('stalled', handleStalled);
            
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
            }
        };
    }, []);

    const handleSpeedChange = (speed) => {
        setPlaybackSpeed(speed);
        if (videoRef.current) {
            videoRef.current.playbackRate = speed;
        }
    };

    const handleSegmentClick = (segment) => {
        const timestamp = new Date(segment.start_time).getTime();
        setSearchParams({ 
            camera: selectedCamera?.id.toString(), 
            t: timestamp.toString() 
        }, { replace: false });
        setSelectedSegment(segment);
        setSeekWarning(null);
        setAutoPlayNotification(null);
        setIsSeeking(false);
        setIsBuffering(false);
        lastSeekTimeRef.current = 0;
        if (bufferingTimeoutRef.current) {
            clearTimeout(bufferingTimeoutRef.current);
            bufferingTimeoutRef.current = null;
        }
    };

    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

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

    const takeSnapshot = async () => {
        if (!videoRef.current || videoRef.current.paused || videoRef.current.readyState < 2) {
            setSnapshotNotification({ type: 'error', message: 'Video belum siap untuk snapshot' });
            setTimeout(() => setSnapshotNotification(null), 3000);
            return;
        }

        const cameraName = selectedCameraRef.current?.name || 'camera';
        
        try {
            const video = videoRef.current;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const watermarkHeight = Math.max(40, canvas.height * 0.08);
            const padding = watermarkHeight * 0.3;
            const fontSize = watermarkHeight * 0.4;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(canvas.width - (watermarkHeight * 4) - padding, canvas.height - watermarkHeight - padding, watermarkHeight * 4, watermarkHeight);

            const logoSize = watermarkHeight * 0.6;
            const logoX = canvas.width - (watermarkHeight * 3.5) - padding;
            const logoY = canvas.height - (watermarkHeight / 2) - padding;
            
            ctx.fillStyle = '#0ea5e9';
            ctx.beginPath();
            ctx.arc(logoX, logoY, logoSize / 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${logoSize * 0.6}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(branding.logo_text || 'R', logoX, logoY);

            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(branding.company_name || 'RAF NET', logoX + logoSize / 2 + padding / 2, logoY - fontSize / 3);

            ctx.font = `${fontSize * 0.7}px Arial`;
            ctx.fillStyle = '#94a3b8';
            const timestamp = new Date().toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            ctx.fillText(timestamp, logoX + logoSize / 2 + padding / 2, logoY + fontSize / 2);

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    setSnapshotNotification({ type: 'error', message: 'Gagal membuat snapshot' });
                    setTimeout(() => setSnapshotNotification(null), 3000);
                    return;
                }

                const filename = `${cameraName}-${Date.now()}.png`;

                if (navigator.share && navigator.canShare) {
                    try {
                        const file = new File([blob], filename, { type: 'image/png' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({ files: [file], title: `Snapshot - ${cameraName}` });
                            setSnapshotNotification({ type: 'success', message: 'Snapshot berhasil dibagikan!' });
                            setTimeout(() => setSnapshotNotification(null), 3000);
                            return;
                        }
                    } catch (err) {
                        if (err.name !== 'AbortError') console.warn('Share failed:', err);
                    }
                }

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

    const handleTimelineClick = (targetTime) => {
        if (!videoRef.current) return;
        
        const currentPos = videoRef.current.currentTime;
        const seekDistance = Math.abs(targetTime - currentPos);
        
        if (seekDistance > MAX_SEEK_DISTANCE) {
            const direction = targetTime > currentPos ? 1 : -1;
            const limitedTarget = currentPos + (MAX_SEEK_DISTANCE * direction);
            videoRef.current.currentTime = limitedTarget;
            lastSeekTimeRef.current = limitedTarget;
            setSeekWarning({ type: 'limit' });
        } else {
            videoRef.current.currentTime = targetTime;
            lastSeekTimeRef.current = targetTime;
        }
    };

    // Handle camera change and update URL for shareable links
    const handleCameraChange = useCallback((camera) => {
        setSelectedCamera(camera);
        if (camera) {
            const timestamp = selectedSegment ? new Date(selectedSegment.start_time).getTime().toString() : '';
            setSearchParams({ 
                camera: camera.id.toString(),
                t: timestamp || '' 
            }, { replace: false });
        }
    }, [setSearchParams, selectedSegment]);

    // Handle share playback link - use timestamp instead of segment ID
    const handleShare = useCallback(async () => {
        const baseUrl = `${window.location.origin}/playback`;
        const params = new URLSearchParams();
        if (selectedCamera?.id) params.set('camera', selectedCamera.id.toString());
        if (selectedSegment?.start_time) {
            const timestamp = new Date(selectedSegment.start_time).getTime();
            params.set('t', timestamp.toString());
        }
        const shareUrl = `${baseUrl}?${params.toString()}`;

        const shareData = {
            title: `Playback - ${selectedCamera?.name || 'CCTV'}`,
            text: `Lihat rekaman dari kamera ${selectedCamera?.name || 'CCTV'}`,
            url: shareUrl
        };

        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    await navigator.clipboard.writeText(shareUrl);
                    setSnapshotNotification({ type: 'success', message: 'Tautan disalin ke clipboard!' });
                    setTimeout(() => setSnapshotNotification(null), 3000);
                }
            }
        } else {
            try {
                await navigator.clipboard.writeText(shareUrl);
                setSnapshotNotification({ type: 'success', message: 'Tautan disalin ke clipboard!' });
                setTimeout(() => setSnapshotNotification(null), 3000);
            } catch (err) {
                setSnapshotNotification({ type: 'error', message: 'Gagal menyalin tautan' });
                setTimeout(() => setSnapshotNotification(null), 3000);
            }
        }
    }, [selectedCamera, selectedSegment]);

    // Handle back to live stream
    const handleBackToLive = useCallback(() => {
        if (selectedCamera) {
            navigate(`/?camera=${selectedCamera.id}`);
        } else {
            navigate('/');
        }
    }, [navigate, selectedCamera]);

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
                    <a href="/" className="inline-flex items-center gap-2 text-primary-500 hover:text-primary-600 font-medium">
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
                <PlaybackHeader
                    cameras={cameras}
                    selectedCamera={selectedCamera}
                    onCameraChange={handleCameraChange}
                    autoPlayEnabled={autoPlayEnabled}
                    onAutoPlayToggle={handleAutoPlayToggle}
                    onShare={handleShare}
                    onBackToLive={handleBackToLive}
                />

                <PlaybackVideo
                    videoRef={videoRef}
                    containerRef={containerRef}
                    selectedCamera={selectedCamera}
                    selectedSegment={selectedSegment}
                    playbackSpeed={playbackSpeed}
                    onSpeedChange={handleSpeedChange}
                    onSnapshot={takeSnapshot}
                    onToggleFullscreen={toggleFullscreen}
                    isFullscreen={isFullscreen}
                    isBuffering={isBuffering}
                    isSeeking={isSeeking}
                    videoError={videoError}
                    errorType={errorType}
                    currentTime={currentTime}
                    duration={duration}
                    autoPlayNotification={autoPlayNotification}
                    onAutoPlayNotificationClose={() => setAutoPlayNotification(null)}
                    seekWarning={seekWarning}
                    onSeekWarningClose={() => setSeekWarning(null)}
                    snapshotNotification={snapshotNotification}
                    formatTimestamp={formatTimestamp}
                />

                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-blue-200 dark:border-blue-800">
                    <div className="flex items-start gap-3">
                        <svg className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                            <h3 className="text-sm sm:text-base font-semibold text-blue-900 dark:text-blue-100 mb-2">Cara Menggunakan Playback</h3>
                            <ul className="space-y-1.5 text-xs sm:text-sm text-blue-800 dark:text-blue-200">
                                <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">•</span><span><strong>Skip Video:</strong> Maksimal lompat 3 menit per sekali skip</span></li>
                                <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">•</span><span><strong>Timeline:</strong> Klik pada timeline untuk melompat ke waktu tertentu</span></li>
                                <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">•</span><span><strong>Kecepatan:</strong> Klik tombol di pojok kanan atas video (0.5x - 2x)</span></li>
                                <li className="flex items-start gap-2"><span className="flex-shrink-0 mt-0.5">•</span><span><strong>Segment:</strong> Pilih segment di bawah untuk melihat recording waktu berbeda</span></li>
                            </ul>
                        </div>
                    </div>
                </div>

                <PlaybackTimeline
                    segments={segments}
                    selectedSegment={selectedSegment}
                    onSegmentClick={handleSegmentClick}
                    onTimelineClick={handleTimelineClick}
                    formatTimestamp={formatTimestamp}
                />

                <PlaybackSegmentList
                    segments={segments}
                    selectedSegment={selectedSegment}
                    onSegmentClick={handleSegmentClick}
                    formatTimestamp={formatTimestamp}
                />
            </div>
        </div>
    );
}

export default Playback;
