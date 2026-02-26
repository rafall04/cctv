import { useEffect, useRef, useState, useCallback } from 'react';
import { getHLSConfig } from '../utils/hlsConfig';
import { createErrorRecoveryHandler } from '../utils/errorRecovery';
import { createFallbackHandler } from '../utils/fallbackHandler';
import { preloadHls } from '../utils/preloadManager';
import { useStreamTimeout } from './useStreamTimeout';
import { LoadingStage, createStreamError } from '../utils/streamLoaderTypes';

export const useHlsPlayer = ({ streams, videoRef, deviceCapabilities, deviceTier }) => {
    const hlsRef = useRef(null);
    const errorRecoveryRef = useRef(null);
    const fallbackHandlerRef = useRef(null);
    const abortControllerRef = useRef(null);
    const bufferSpinnerTimeoutRef = useRef(null);

    const [status, setStatus] = useState('loading'); // loading, playing, paused, error, timeout
    const [loadingStage, setLoadingStage] = useState(LoadingStage.CONNECTING);
    const [error, setError] = useState(null);
    const [retryCount, setRetryCount] = useState(0);
    const [showSpinner, setShowSpinner] = useState(true);
    const maxRetries = 4;

    const [autoRetryCount, setAutoRetryCount] = useState(0);
    const [isAutoRetrying, setIsAutoRetrying] = useState(false);
    const [retryDelay, setRetryDelay] = useState(0);

    const [consecutiveFailures, setConsecutiveFailures] = useState(0);
    const [showTroubleshooting, setShowTroubleshooting] = useState(false);
    const [retryTrigger, setRetryTrigger] = useState(0);

    // Stream Timeout Hook
    const {
        startTimeout,
        clearTimeout: clearStreamTimeout,
        updateStage: updateStreamStage,
        resetFailures,
        getConsecutiveFailures,
    } = useStreamTimeout({
        deviceTier: deviceTier,
        onTimeout: (stage) => {
            cleanupResources();
            setStatus('timeout');
            setLoadingStage(LoadingStage.TIMEOUT);
            setError(`Loading timeout at ${stage} stage`);
            setShowSpinner(false);
            setConsecutiveFailures(getConsecutiveFailures());
        },
        onMaxFailures: (failures) => {
            setShowTroubleshooting(true);
            setConsecutiveFailures(failures);
        }
    });

    const cleanupResources = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.src = '';
            videoRef.current.load();
        }

        clearStreamTimeout();

        if (fallbackHandlerRef.current) {
            fallbackHandlerRef.current.clearPendingRetry();
        }

        if (bufferSpinnerTimeoutRef.current) {
            clearTimeout(bufferSpinnerTimeoutRef.current);
            bufferSpinnerTimeoutRef.current = null;
        }
    }, [clearStreamTimeout, videoRef]);

    const handleRetry = useCallback(() => {
        setRetryCount(0);
        setAutoRetryCount(0);
        setIsAutoRetrying(false);
        setError(null);
        setStatus('loading');
        setLoadingStage(LoadingStage.CONNECTING);
        setShowSpinner(true);
        setShowTroubleshooting(false);

        if (errorRecoveryRef.current) {
            errorRecoveryRef.current.reset();
        }
        if (fallbackHandlerRef.current) {
            fallbackHandlerRef.current.reset();
        }
        resetFailures();

        cleanupResources();

        setRetryTrigger(prev => prev + 1);
    }, [cleanupResources, resetFailures]);

    // Initialize error recovery handler
    useEffect(() => {
        errorRecoveryRef.current = createErrorRecoveryHandler({
            maxRetries,
            onRetry: (count, delay) => {
                setError(`Network error - retrying in ${delay / 1000}s...`);
                setRetryCount(count);
            },
            onRecovery: (type) => {
                if (type === 'network' || type === 'media') {
                    setError(null);
                    setStatus('playing');
                    setLoadingStage(LoadingStage.PLAYING);
                }
            },
            onFailed: (type, result) => {
                setStatus('error');
                setLoadingStage(LoadingStage.ERROR);
                setError(result.message || 'Recovery failed');
            },
        });

        return () => {
            if (errorRecoveryRef.current) {
                errorRecoveryRef.current.reset();
            }
        };
    }, []);

    // Initialize fallback handler
    useEffect(() => {
        fallbackHandlerRef.current = createFallbackHandler({
            maxAutoRetries: 3,
            onAutoRetry: ({ attempt, maxAttempts, delay, errorType }) => {
                setIsAutoRetrying(true);
                setAutoRetryCount(attempt);
                setRetryDelay(delay);
                setError(`Auto-retry ${attempt}/${maxAttempts} in ${delay / 1000}s...`);
            },
            onAutoRetryExhausted: ({ totalAttempts }) => {
                setIsAutoRetrying(false);
                setAutoRetryCount(totalAttempts);
            },
            onNetworkRestore: () => {
                if (status === 'error' || status === 'timeout') {
                    handleRetry();
                }
            },
            onManualRetryRequired: ({ errorType, message }) => {
                setIsAutoRetrying(false);
                setError(message);
            },
        });

        return () => {
            if (fallbackHandlerRef.current) {
                fallbackHandlerRef.current.destroy();
                fallbackHandlerRef.current = null;
            }
        };
    }, [status, handleRetry]);

    // Main HLS initialization effect
    useEffect(() => {
        if (!streams || !videoRef.current || !deviceCapabilities) return;

        const video = videoRef.current;
        let hls = null;
        let isDestroyed = false;

        abortControllerRef.current = new AbortController();

        const initPlayer = async () => {
            setStatus('loading');
            setLoadingStage(LoadingStage.CONNECTING);
            setError(null);
            setShowSpinner(true);

            startTimeout(LoadingStage.CONNECTING);

            try {
                const Hls = await preloadHls();

                if (isDestroyed) return;

                setLoadingStage(LoadingStage.LOADING);
                updateStreamStage(LoadingStage.LOADING);

                const hlsConfig = getHLSConfig(deviceTier, {
                    isMobile: deviceCapabilities.isMobile,
                    mobileDeviceType: deviceCapabilities.mobileDeviceType,
                });

                if (Hls.isSupported() && streams.hls) {
                    hls = new Hls(hlsConfig);
                    hlsRef.current = hls;

                    hls.loadSource(streams.hls);
                    hls.attachMedia(video);

                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        if (isDestroyed) return;

                        setLoadingStage(LoadingStage.BUFFERING);
                        updateStreamStage(LoadingStage.BUFFERING);
                    });

                    hls.on(Hls.Events.FRAG_BUFFERED, () => {
                        if (isDestroyed) return;

                        setLoadingStage(LoadingStage.STARTING);
                        updateStreamStage(LoadingStage.STARTING);

                        video.play().then(() => {
                            if (isDestroyed) return;

                            setStatus('playing');
                            setLoadingStage(LoadingStage.PLAYING);
                            setRetryCount(0);
                            setAutoRetryCount(0);
                            setShowSpinner(false);
                            setConsecutiveFailures(0);

                            clearStreamTimeout();
                            resetFailures();

                            if (fallbackHandlerRef.current) {
                                fallbackHandlerRef.current.reset();
                            }

                            if (errorRecoveryRef.current) {
                                errorRecoveryRef.current.reset();
                            }
                        }).catch((err) => {
                            if (isDestroyed) return;
                            console.error('Play error:', err);
                            setStatus('error');
                            setLoadingStage(LoadingStage.ERROR);
                            setError('Failed to play video');
                            setShowSpinner(false);
                        });
                    });

                    hls.on(Hls.Events.ERROR, async (event, data) => {
                        if (isDestroyed) return;
                        console.error('HLS error:', data);

                        if (data.fatal) {
                            clearStreamTimeout();

                            const errorType = data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' :
                                data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'unknown';

                            const streamError = createStreamError({
                                type: errorType,
                                message: data.details || 'Stream error',
                                stage: loadingStage,
                                deviceTier: deviceTier,
                                retryCount: autoRetryCount,
                            });

                            if (fallbackHandlerRef.current) {
                                const result = fallbackHandlerRef.current.handleError(streamError, () => {
                                    if (!isDestroyed && hls) {
                                        setLoadingStage(LoadingStage.CONNECTING);
                                        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                                            hls.startLoad();
                                        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                                            hls.recoverMediaError();
                                        }
                                    }
                                });

                                if (result.action === 'manual-retry-required') {
                                    setStatus('error');
                                    setLoadingStage(LoadingStage.ERROR);
                                    setShowSpinner(false);
                                }
                            } else {
                                if (errorRecoveryRef.current) {
                                    await errorRecoveryRef.current.handleError(hls, {
                                        fatal: true,
                                        type: data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'networkError' :
                                            data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'mediaError' : 'fatalError',
                                    });
                                } else {
                                    setStatus('error');
                                    setLoadingStage(LoadingStage.ERROR);
                                    setError('Fatal error occurred');
                                    setShowSpinner(false);
                                    hls.destroy();
                                }
                            }
                        }
                    });
                } else if (video.canPlayType('application/vnd.apple.mpegurl') && streams.hls) {
                    video.src = streams.hls;

                    video.addEventListener('loadedmetadata', () => {
                        if (isDestroyed) return;
                        setLoadingStage(LoadingStage.BUFFERING);
                    });

                    video.addEventListener('canplay', () => {
                        if (isDestroyed) return;
                        setLoadingStage(LoadingStage.STARTING);

                        video.play().then(() => {
                            if (isDestroyed) return;
                            setStatus('playing');
                            setLoadingStage(LoadingStage.PLAYING);
                            setShowSpinner(false);

                            clearStreamTimeout();
                            resetFailures();
                        }).catch((err) => {
                            if (isDestroyed) return;
                            console.error('Play error:', err);
                            setStatus('error');
                            setLoadingStage(LoadingStage.ERROR);
                            setError('Failed to play video');
                            setShowSpinner(false);
                        });
                    });

                    video.addEventListener('error', () => {
                        if (isDestroyed) return;
                        setStatus('error');
                        setLoadingStage(LoadingStage.ERROR);
                        setError('Video playback error');
                        setShowSpinner(false);
                    });
                } else {
                    setStatus('error');
                    setLoadingStage(LoadingStage.ERROR);
                    setError('HLS not supported in this browser');
                    setShowSpinner(false);
                }
            } catch (err) {
                if (isDestroyed) return;
                console.error('Failed to load HLS.js:', err);
                setStatus('error');
                setLoadingStage(LoadingStage.ERROR);
                setError('Failed to load video player');
                setShowSpinner(false);
            }
        };

        initPlayer();

        return () => {
            isDestroyed = true;
            cleanupResources();
            if (hls) {
                hls.destroy();
                hlsRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [streams, deviceCapabilities, deviceTier, cleanupResources, retryTrigger]);

    // Handle buffering events
    const handleWaiting = useCallback(() => {
        bufferSpinnerTimeoutRef.current = setTimeout(() => {
            if (status === 'playing') {
                setShowSpinner(true);
            }
        }, 2000);
    }, [status]);

    const handlePlaying = useCallback(() => {
        if (bufferSpinnerTimeoutRef.current) {
            clearTimeout(bufferSpinnerTimeoutRef.current);
            bufferSpinnerTimeoutRef.current = null;
        }
        setShowSpinner(false);
    }, []);

    // Attach video event listeners for buffering
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('canplay', handlePlaying);

        return () => {
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('canplay', handlePlaying);
            if (bufferSpinnerTimeoutRef.current) {
                clearTimeout(bufferSpinnerTimeoutRef.current);
            }
        };
    }, [handleWaiting, handlePlaying, videoRef]);

    return {
        hlsRef,
        status,
        setStatus,
        loadingStage,
        setLoadingStage,
        error,
        showSpinner,
        isAutoRetrying,
        autoRetryCount,
        retryDelay,
        consecutiveFailures,
        showTroubleshooting,
        handleRetry,
    };
};
