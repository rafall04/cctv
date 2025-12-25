/**
 * StreamController Module
 * Manages video stream lifecycle with visibility awareness
 * Handles init, pause, resume, destroy operations
 * 
 * **Validates: Requirements 4.2, 4.3**
 */

import { createVisibilityObserver } from './visibilityObserver';

/**
 * Stream status constants
 */
export const StreamStatus = {
    IDLE: 'idle',
    LOADING: 'loading',
    PLAYING: 'playing',
    PAUSED: 'paused',
    ERROR: 'error',
    DESTROYED: 'destroyed',
};

/**
 * Default configuration for stream controller
 */
const DEFAULT_CONFIG = {
    // Delay before pausing when element becomes invisible (ms)
    pauseDelay: 5000,
    // Whether to auto-resume when element becomes visible
    autoResume: true,
    // Visibility threshold for observer
    visibilityThreshold: 0.1,
};

/**
 * Create a stream controller instance
 * @param {HTMLVideoElement} videoElement - Video element to control
 * @param {string} streamUrl - HLS stream URL
 * @param {Object} options - Controller options
 * @param {Function} options.onStatusChange - Called when status changes
 * @param {Function} options.onError - Called on error
 * @param {string} options.deviceTier - Device tier for configuration
 * @param {number} options.pauseDelay - Delay before pausing (default 5000ms)
 * @param {boolean} options.autoResume - Auto-resume on visibility (default true)
 * @returns {Object} Stream controller instance
 */
export const createStreamController = (videoElement, streamUrl, options = {}) => {
    const {
        onStatusChange = () => {},
        onError = () => {},
        deviceTier = 'medium',
        pauseDelay = DEFAULT_CONFIG.pauseDelay,
        autoResume = DEFAULT_CONFIG.autoResume,
        visibilityThreshold = DEFAULT_CONFIG.visibilityThreshold,
    } = options;
    
    // Internal state
    let state = {
        status: StreamStatus.IDLE,
        isVisible: true,
        pausedAt: null,
        hlsInstance: null,
        pauseTimeoutId: null,
        lastActivityAt: Date.now(),
    };
    
    // Visibility observer
    let visibilityObserver = null;
    
    /**
     * Update status and notify listener
     */
    const setStatus = (newStatus) => {
        if (state.status !== newStatus) {
            state.status = newStatus;
            state.lastActivityAt = Date.now();
            onStatusChange(newStatus, state);
        }
    };
    
    /**
     * Handle visibility change
     */
    const handleVisibilityChange = (isVisible) => {
        state.isVisible = isVisible;
        
        if (isVisible) {
            // Clear any pending pause timeout
            if (state.pauseTimeoutId) {
                clearTimeout(state.pauseTimeoutId);
                state.pauseTimeoutId = null;
            }
            
            // Auto-resume if enabled and was playing
            if (autoResume && state.status === StreamStatus.PAUSED && state.pausedAt) {
                controller.resume();
            }
        } else {
            // Schedule pause after delay
            if (state.status === StreamStatus.PLAYING && !state.pauseTimeoutId) {
                state.pauseTimeoutId = setTimeout(() => {
                    if (!state.isVisible && state.status === StreamStatus.PLAYING) {
                        controller.pause();
                        state.pausedAt = Date.now();
                    }
                    state.pauseTimeoutId = null;
                }, pauseDelay);
            }
        }
    };
    
    const controller = {
        /**
         * Initialize the stream (attach HLS instance)
         * @param {Object} hlsInstance - HLS.js instance
         */
        initialize: (hlsInstance) => {
            if (state.status === StreamStatus.DESTROYED) {
                return;
            }
            
            state.hlsInstance = hlsInstance;
            setStatus(StreamStatus.LOADING);
            
            // Setup visibility observer
            if (videoElement && typeof IntersectionObserver !== 'undefined') {
                visibilityObserver = createVisibilityObserver({
                    threshold: visibilityThreshold,
                });
                visibilityObserver.observe(videoElement, handleVisibilityChange);
            }
        },
        
        /**
         * Mark stream as playing
         */
        setPlaying: () => {
            if (state.status !== StreamStatus.DESTROYED) {
                setStatus(StreamStatus.PLAYING);
                state.pausedAt = null;
            }
        },
        
        /**
         * Pause the stream
         */
        pause: () => {
            if (state.status === StreamStatus.DESTROYED) {
                return;
            }
            
            if (videoElement && !videoElement.paused) {
                videoElement.pause();
            }
            
            setStatus(StreamStatus.PAUSED);
            state.pausedAt = Date.now();
        },
        
        /**
         * Resume the stream
         */
        resume: () => {
            if (state.status === StreamStatus.DESTROYED) {
                return;
            }
            
            if (videoElement && videoElement.paused) {
                videoElement.play().catch(() => {
                    // Autoplay might be blocked, ignore
                });
            }
            
            setStatus(StreamStatus.PLAYING);
            state.pausedAt = null;
        },
        
        /**
         * Set error state
         * @param {Error} error - Error object
         */
        setError: (error) => {
            setStatus(StreamStatus.ERROR);
            onError(error);
        },
        
        /**
         * Destroy the stream controller and clean up resources
         */
        destroy: () => {
            // Clear pause timeout
            if (state.pauseTimeoutId) {
                clearTimeout(state.pauseTimeoutId);
                state.pauseTimeoutId = null;
            }
            
            // Disconnect visibility observer
            if (visibilityObserver) {
                visibilityObserver.disconnect();
                visibilityObserver = null;
            }
            
            // Destroy HLS instance
            if (state.hlsInstance) {
                state.hlsInstance.destroy();
                state.hlsInstance = null;
            }
            
            // Clear video source
            if (videoElement) {
                videoElement.pause();
                videoElement.src = '';
                videoElement.load();
            }
            
            setStatus(StreamStatus.DESTROYED);
        },
        
        /**
         * Get current state
         * @returns {Object} Current state
         */
        getState: () => ({ ...state }),
        
        /**
         * Get current status
         * @returns {string} Current status
         */
        getStatus: () => state.status,
        
        /**
         * Check if stream is visible
         * @returns {boolean} Visibility state
         */
        isVisible: () => state.isVisible,
        
        /**
         * Check if stream is active (not destroyed)
         * @returns {boolean} Whether stream is active
         */
        isActive: () => state.status !== StreamStatus.DESTROYED,
        
        /**
         * Manually trigger visibility change (for testing)
         * @param {boolean} isVisible - New visibility state
         */
        setVisibility: (isVisible) => {
            handleVisibilityChange(isVisible);
        },
    };
    
    return controller;
};

/**
 * Calculate pause delay based on device tier
 * @param {'low' | 'medium' | 'high'} tier - Device tier
 * @returns {number} Pause delay in milliseconds
 */
export const getPauseDelayForTier = (tier) => {
    switch (tier) {
        case 'low':
            return 3000; // Faster pause for low-end devices
        case 'high':
            return 8000; // Longer delay for high-end devices
        default:
            return 5000; // Default 5 seconds
    }
};

export default {
    createStreamController,
    getPauseDelayForTier,
    StreamStatus,
};
