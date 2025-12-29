/**
 * LoadingTimeoutHandler Module
 * 
 * Modul untuk mendeteksi dan menangani stuck loading pada stream CCTV.
 * Implements device-adaptive timeout dengan consecutive failure tracking.
 * 
 * Features:
 * - Device-adaptive timeout (15s low-end, 10s high-end)
 * - Consecutive failure tracking
 * - Timeout callback system
 * - Resource cleanup coordination
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 5.3
 */

/**
 * Loading stage types
 * @typedef {'connecting' | 'loading' | 'buffering' | 'starting' | 'playing' | 'error' | 'timeout'} LoadingStage
 */

/**
 * Device tier types
 * @typedef {'low' | 'medium' | 'high'} DeviceTier
 */

/**
 * Timeout configuration constants
 */
export const TIMEOUT_CONFIG = {
    LOW_END_TIMEOUT: 30000,    // 30 seconds for low-end devices (increased from 15s)
    HIGH_END_TIMEOUT: 20000,   // 20 seconds for medium/high-end devices (increased from 10s)
    MAX_CONSECUTIVE_FAILURES: 3, // Suggest troubleshooting after 3 failures
};

/**
 * Get timeout duration based on device tier.
 * Low-end devices get longer timeout (15s) to accommodate slower processing.
 * Medium and high-end devices get standard timeout (10s).
 * 
 * @param {DeviceTier} deviceTier - Device tier ('low', 'medium', 'high')
 * @returns {number} Timeout duration in milliseconds
 * 
 * **Validates: Requirements 1.1, 5.3**
 * **Property 1: Device-Adaptive Timeout Duration**
 */
export const getTimeoutDuration = (deviceTier) => {
    if (deviceTier === 'low') {
        return TIMEOUT_CONFIG.LOW_END_TIMEOUT;
    }
    return TIMEOUT_CONFIG.HIGH_END_TIMEOUT;
};

/**
 * Create a LoadingTimeoutHandler instance.
 * Manages timeout detection and consecutive failure tracking for stream loading.
 * 
 * @param {Object} options - Configuration options
 * @param {DeviceTier} [options.deviceTier='medium'] - Device tier for timeout calculation
 * @param {Function} [options.onTimeout] - Callback when timeout occurs
 * @param {Function} [options.onMaxFailures] - Callback when max consecutive failures reached
 * @returns {Object} LoadingTimeoutHandler instance
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 5.3**
 */
export const createLoadingTimeoutHandler = (options = {}) => {
    const {
        deviceTier = 'medium',
        onTimeout = null,
        onMaxFailures = null,
    } = options;

    // Internal state
    let timeoutId = null;
    let consecutiveFailures = 0;
    let currentStage = 'connecting';
    let isActive = false;
    let startTime = null;

    // Callbacks
    let timeoutCallback = onTimeout;
    let maxFailuresCallback = onMaxFailures;

    /**
     * Start the loading timeout timer.
     * Clears any existing timeout before starting a new one.
     * 
     * @param {LoadingStage} [stage='connecting'] - Current loading stage
     * @returns {void}
     * 
     * **Validates: Requirements 1.1, 5.3**
     */
    const startTimeout = (stage = 'connecting') => {
        // Clear any existing timeout
        clearTimeoutTimer();

        currentStage = stage;
        isActive = true;
        startTime = performance.now();

        const duration = getTimeoutDuration(deviceTier);

        timeoutId = setTimeout(() => {
            handleTimeout();
        }, duration);
    };

    /**
     * Clear the current timeout timer.
     * 
     * @returns {void}
     */
    const clearTimeoutTimer = () => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        isActive = false;
    };

    /**
     * Handle timeout event.
     * Increments consecutive failures and triggers callbacks.
     * 
     * @returns {void}
     * 
     * **Validates: Requirements 1.2, 1.4**
     */
    const handleTimeout = () => {
        isActive = false;
        timeoutId = null;
        consecutiveFailures++;

        // Trigger timeout callback with current stage
        if (timeoutCallback) {
            timeoutCallback(currentStage);
        }

        // Check if max consecutive failures reached
        if (consecutiveFailures >= TIMEOUT_CONFIG.MAX_CONSECUTIVE_FAILURES) {
            if (maxFailuresCallback) {
                maxFailuresCallback(consecutiveFailures);
            }
        }
    };

    /**
     * Register a callback for timeout events.
     * 
     * @param {Function} callback - Callback function (receives LoadingStage)
     * @returns {void}
     */
    const onTimeoutEvent = (callback) => {
        timeoutCallback = callback;
    };

    /**
     * Register a callback for max failures reached.
     * 
     * @param {Function} callback - Callback function (receives failure count)
     * @returns {void}
     */
    const onMaxFailuresReached = (callback) => {
        maxFailuresCallback = callback;
    };

    /**
     * Get the current consecutive failure count.
     * 
     * @returns {number} Number of consecutive failures
     * 
     * **Validates: Requirements 1.4**
     * **Property 9: Consecutive Failure Tracking**
     */
    const getConsecutiveFailures = () => {
        return consecutiveFailures;
    };

    /**
     * Reset the consecutive failure counter.
     * Should be called after successful stream load.
     * 
     * @returns {void}
     */
    const resetFailures = () => {
        consecutiveFailures = 0;
    };

    /**
     * Record a failure (timeout or error).
     * Increments consecutive failure counter.
     * 
     * @returns {number} New consecutive failure count
     * 
     * **Validates: Requirements 1.4**
     */
    const recordFailure = () => {
        consecutiveFailures++;
        return consecutiveFailures;
    };

    /**
     * Check if troubleshooting should be suggested.
     * Returns true after 3 consecutive failures.
     * 
     * @returns {boolean} True if troubleshooting should be suggested
     * 
     * **Validates: Requirements 1.4**
     */
    const shouldSuggestTroubleshooting = () => {
        return consecutiveFailures >= TIMEOUT_CONFIG.MAX_CONSECUTIVE_FAILURES;
    };

    /**
     * Update the current loading stage.
     * Restarts the timeout timer with the new stage.
     * 
     * @param {LoadingStage} stage - New loading stage
     * @returns {void}
     */
    const updateStage = (stage) => {
        currentStage = stage;
        // Restart timeout when stage changes (still loading)
        if (isActive && stage !== 'playing' && stage !== 'error' && stage !== 'timeout') {
            startTimeout(stage);
        }
    };

    /**
     * Get the current loading stage.
     * 
     * @returns {LoadingStage} Current loading stage
     */
    const getCurrentStage = () => {
        return currentStage;
    };

    /**
     * Check if timeout is currently active.
     * 
     * @returns {boolean} True if timeout timer is running
     */
    const isTimeoutActive = () => {
        return isActive;
    };

    /**
     * Get elapsed time since timeout started.
     * 
     * @returns {number} Elapsed time in milliseconds (-1 if not started)
     */
    const getElapsedTime = () => {
        if (startTime === null) {
            return -1;
        }
        return performance.now() - startTime;
    };

    /**
     * Get the configured timeout duration for current device tier.
     * 
     * @returns {number} Timeout duration in milliseconds
     */
    const getConfiguredTimeout = () => {
        return getTimeoutDuration(deviceTier);
    };

    /**
     * Destroy the handler and clean up resources.
     * 
     * @returns {void}
     * 
     * **Validates: Requirements 1.3, 7.4**
     */
    const destroy = () => {
        clearTimeoutTimer();
        timeoutCallback = null;
        maxFailuresCallback = null;
        consecutiveFailures = 0;
        currentStage = 'connecting';
        startTime = null;
    };

    return {
        startTimeout,
        clearTimeout: clearTimeoutTimer,
        onTimeout: onTimeoutEvent,
        onMaxFailuresReached,
        getConsecutiveFailures,
        resetFailures,
        recordFailure,
        shouldSuggestTroubleshooting,
        updateStage,
        getCurrentStage,
        isTimeoutActive,
        getElapsedTime,
        getConfiguredTimeout,
        destroy,
    };
};

/**
 * Reset state for testing purposes.
 * Creates a fresh handler with default options.
 * 
 * @param {Object} options - Configuration options
 * @returns {Object} Fresh LoadingTimeoutHandler instance
 */
export const createFreshHandler = (options = {}) => {
    return createLoadingTimeoutHandler(options);
};

export default {
    getTimeoutDuration,
    createLoadingTimeoutHandler,
    createFreshHandler,
    TIMEOUT_CONFIG,
};
