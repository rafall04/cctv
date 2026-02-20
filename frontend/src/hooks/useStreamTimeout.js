import { useRef, useCallback, useEffect } from 'react';

/**
 * Timeout configuration constants
 */
export const TIMEOUT_CONFIG = {
    LOW_END_TIMEOUT: 15000,    // 15 seconds for low-end devices
    HIGH_END_TIMEOUT: 10000,   // 10 seconds for medium/high-end devices
    MAX_CONSECUTIVE_FAILURES: 3, // Suggest troubleshooting after 3 failures
};

/**
 * Get timeout duration based on device tier.
 */
export const getTimeoutDuration = (deviceTier) => {
    return deviceTier === 'low' ? TIMEOUT_CONFIG.LOW_END_TIMEOUT : TIMEOUT_CONFIG.HIGH_END_TIMEOUT;
};

/**
 * Custom hook to handle stream loading timeouts and consecutive failure tracking.
 * Replaces the old class-based LoadingTimeoutHandler utility.
 * 
 * @param {Object} options Configuration options
 * @param {string} options.deviceTier Device tier ('low', 'medium', 'high')
 * @param {Function} options.onTimeout Callback when timeout occurs
 * @param {Function} options.onMaxFailures Callback when max consecutive failures reached
 */
export const useStreamTimeout = ({ deviceTier = 'medium', onTimeout, onMaxFailures }) => {
    const timeoutIdRef = useRef(null);
    const consecutiveFailuresRef = useRef(0);
    const currentStageRef = useRef('connecting');
    const isActiveRef = useRef(false);
    const startTimeRef = useRef(null);

    // Keep latest callbacks to avoid dependency cycles in setTimeout
    const callbacksRef = useRef({ onTimeout, onMaxFailures });

    useEffect(() => {
        callbacksRef.current = { onTimeout, onMaxFailures };
    }, [onTimeout, onMaxFailures]);

    const clearTimeoutTimer = useCallback(() => {
        if (timeoutIdRef.current !== null) {
            clearTimeout(timeoutIdRef.current);
            timeoutIdRef.current = null;
        }
        isActiveRef.current = false;
    }, []);

    const handleTimeout = useCallback(() => {
        isActiveRef.current = false;
        timeoutIdRef.current = null;
        consecutiveFailuresRef.current += 1;

        if (callbacksRef.current.onTimeout) {
            callbacksRef.current.onTimeout(currentStageRef.current);
        }

        if (consecutiveFailuresRef.current >= TIMEOUT_CONFIG.MAX_CONSECUTIVE_FAILURES) {
            if (callbacksRef.current.onMaxFailures) {
                callbacksRef.current.onMaxFailures(consecutiveFailuresRef.current);
            }
        }
    }, []);

    const startTimeout = useCallback((stage = 'connecting') => {
        clearTimeoutTimer();

        currentStageRef.current = stage;
        isActiveRef.current = true;
        startTimeRef.current = performance.now();

        const duration = getTimeoutDuration(deviceTier);
        timeoutIdRef.current = setTimeout(handleTimeout, duration);
    }, [deviceTier, clearTimeoutTimer, handleTimeout]);

    const updateStage = useCallback((stage) => {
        currentStageRef.current = stage;
        if (isActiveRef.current && !['playing', 'error', 'timeout'].includes(stage)) {
            startTimeout(stage);
        }
    }, [startTimeout]);

    const resetFailures = useCallback(() => {
        consecutiveFailuresRef.current = 0;
    }, []);

    const recordFailure = useCallback(() => {
        consecutiveFailuresRef.current += 1;
        return consecutiveFailuresRef.current;
    }, []);

    const getConsecutiveFailures = useCallback(() => {
        return consecutiveFailuresRef.current;
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            clearTimeoutTimer();
        };
    }, [clearTimeoutTimer]);

    return {
        startTimeout,
        clearTimeout: clearTimeoutTimer,
        updateStage,
        resetFailures,
        recordFailure,
        getConsecutiveFailures,
    };
};
