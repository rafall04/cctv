/**
 * StreamLoader Types and Constants
 * 
 * Defines loading stages, messages, and error types for stream loading system.
 * Used for progressive loading feedback and error handling.
 * 
 * @module streamLoaderTypes
 */

/**
 * Loading stage enum values
 * Represents the different stages of stream loading process
 */
export const LoadingStage = {
    CONNECTING: 'connecting',
    LOADING: 'loading',
    BUFFERING: 'buffering',
    STARTING: 'starting',
    PLAYING: 'playing',
    ERROR: 'error',
    TIMEOUT: 'timeout',
};

/**
 * Valid loading stages array for validation
 */
export const VALID_LOADING_STAGES = Object.values(LoadingStage);

/**
 * Loading stage messages mapping
 * Maps each loading stage to a user-friendly message
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export const LOADING_STAGE_MESSAGES = {
    [LoadingStage.CONNECTING]: 'Connecting to server...',
    [LoadingStage.LOADING]: 'Loading stream data...',
    [LoadingStage.BUFFERING]: 'Buffering video...',
    [LoadingStage.STARTING]: 'Starting playback...',
    [LoadingStage.PLAYING]: 'Live',
    [LoadingStage.ERROR]: 'Connection failed',
    [LoadingStage.TIMEOUT]: 'Loading timeout',
};

/**
 * Successful loading stage progression order
 * For a successful stream load, stages must progress in this order
 * 
 * Property 5: Loading Stage Progression
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */
export const LOADING_STAGE_ORDER = [
    LoadingStage.CONNECTING,
    LoadingStage.LOADING,
    LoadingStage.BUFFERING,
    LoadingStage.STARTING,
    LoadingStage.PLAYING,
];

/**
 * Error type enum values
 */
export const ErrorType = {
    TIMEOUT: 'timeout',
    NETWORK: 'network',
    SERVER: 'server',
    MEDIA: 'media',
    UNKNOWN: 'unknown',
};

/**
 * Valid error types array for validation
 */
export const VALID_ERROR_TYPES = Object.values(ErrorType);

/**
 * Creates a StreamError object
 * 
 * @param {Object} params - Error parameters
 * @param {string} params.type - Error type (timeout, network, server, media, unknown)
 * @param {string} params.message - Error message
 * @param {string} params.stage - Loading stage where error occurred
 * @param {string} params.deviceTier - Device tier (low, medium, high)
 * @param {number} [params.retryCount=0] - Number of retry attempts
 * @param {Object} [params.details] - Additional error details
 * @returns {Object} StreamError object
 * 
 * Requirements: 8.1, 8.2, 8.3
 */
export const createStreamError = ({
    type,
    message,
    stage,
    deviceTier,
    retryCount = 0,
    details = null,
}) => {
    // Validate error type
    if (!VALID_ERROR_TYPES.includes(type)) {
        type = ErrorType.UNKNOWN;
    }

    // Validate stage
    if (!VALID_LOADING_STAGES.includes(stage)) {
        stage = LoadingStage.ERROR;
    }

    return {
        type,
        message: message || 'Unknown error',
        stage,
        deviceTier: deviceTier || 'medium',
        timestamp: Date.now(),
        retryCount,
        details,
    };
};

/**
 * Gets the message for a loading stage
 * 
 * @param {string} stage - Loading stage
 * @returns {string} User-friendly message for the stage
 */
export const getStageMessage = (stage) => {
    // Use Object.hasOwn to avoid returning inherited Object prototype properties
    if (Object.hasOwn(LOADING_STAGE_MESSAGES, stage)) {
        return LOADING_STAGE_MESSAGES[stage];
    }
    return 'Loading...';
};

/**
 * Checks if a stage is a valid loading stage
 * 
 * @param {string} stage - Stage to validate
 * @returns {boolean} True if valid stage
 */
export const isValidStage = (stage) => {
    return VALID_LOADING_STAGES.includes(stage);
};

/**
 * Checks if a stage transition is valid (follows correct order)
 * 
 * @param {string} fromStage - Current stage
 * @param {string} toStage - Target stage
 * @returns {boolean} True if transition is valid
 */
export const isValidStageTransition = (fromStage, toStage) => {
    // Error and timeout can be reached from any stage
    if (toStage === LoadingStage.ERROR || toStage === LoadingStage.TIMEOUT) {
        return true;
    }

    // From error/timeout, can only go back to connecting (retry)
    if (fromStage === LoadingStage.ERROR || fromStage === LoadingStage.TIMEOUT) {
        return toStage === LoadingStage.CONNECTING;
    }

    const fromIndex = LOADING_STAGE_ORDER.indexOf(fromStage);
    const toIndex = LOADING_STAGE_ORDER.indexOf(toStage);

    // Invalid stages
    if (fromIndex === -1 || toIndex === -1) {
        return false;
    }

    // Can only progress forward in the order (or stay same)
    return toIndex >= fromIndex;
};

/**
 * Gets the next expected stage in the loading progression
 * 
 * @param {string} currentStage - Current loading stage
 * @returns {string|null} Next stage or null if at end/error
 */
export const getNextStage = (currentStage) => {
    const currentIndex = LOADING_STAGE_ORDER.indexOf(currentStage);
    
    if (currentIndex === -1 || currentIndex >= LOADING_STAGE_ORDER.length - 1) {
        return null;
    }

    return LOADING_STAGE_ORDER[currentIndex + 1];
};

/**
 * Checks if the stage indicates loading is complete (playing or error states)
 * 
 * @param {string} stage - Loading stage
 * @returns {boolean} True if loading is complete
 */
export const isLoadingComplete = (stage) => {
    return stage === LoadingStage.PLAYING || 
           stage === LoadingStage.ERROR || 
           stage === LoadingStage.TIMEOUT;
};

/**
 * Checks if the stage indicates an error state
 * 
 * @param {string} stage - Loading stage
 * @returns {boolean} True if error state
 */
export const isErrorStage = (stage) => {
    return stage === LoadingStage.ERROR || stage === LoadingStage.TIMEOUT;
};

/**
 * Gets the stage index in the progression order
 * 
 * @param {string} stage - Loading stage
 * @returns {number} Index in progression order, -1 if not found
 */
export const getStageIndex = (stage) => {
    return LOADING_STAGE_ORDER.indexOf(stage);
};
