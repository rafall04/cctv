/**
 * DiagnosticInfo Component
 * 
 * Displays diagnostic information for stream loading errors.
 * Includes error type, device tier, loading stage, and copy functionality.
 * 
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
 */

import { useState, useCallback, useMemo } from 'react';
import { getRetryDelay } from '../utils/fallbackHandler';
import { getStageMessage } from '../utils/streamLoaderTypes';

/**
 * Format error type for display
 * @param {string} errorType - Error type
 * @returns {string} Formatted error type
 */
export const formatErrorType = (errorType) => {
    const typeMap = {
        timeout: 'Timeout',
        network: 'Network Error',
        server: 'Server Error',
        media: 'Media Error',
        unknown: 'Unknown Error',
    };
    // Use Object.hasOwn to avoid returning inherited properties like valueOf, toString
    return Object.hasOwn(typeMap, errorType) ? typeMap[errorType] : 'Unknown Error';
};

/**
 * Format device tier for display
 * @param {string} deviceTier - Device tier
 * @returns {string} Formatted device tier
 */
export const formatDeviceTier = (deviceTier) => {
    const tierMap = {
        low: 'Low-End',
        medium: 'Medium',
        high: 'High-End',
    };
    // Use Object.hasOwn to avoid returning inherited properties like valueOf, toString
    return Object.hasOwn(tierMap, deviceTier) ? tierMap[deviceTier] : 'Unknown';
};

/**
 * Get estimated retry time based on error type
 * Returns -1 if no auto-retry available
 * 
 * @param {string} errorType - Error type
 * @param {boolean} canAutoRetry - Whether auto-retry is available
 * @returns {number} Estimated retry time in milliseconds, -1 if not available
 * 
 * **Validates: Requirements 8.5**
 */
export const getEstimatedRetryTime = (errorType, canAutoRetry = true) => {
    if (!canAutoRetry) {
        return -1;
    }
    return getRetryDelay(errorType);
};

/**
 * Format retry time for display
 * @param {number} retryTimeMs - Retry time in milliseconds
 * @returns {string} Formatted retry time
 */
export const formatRetryTime = (retryTimeMs) => {
    if (retryTimeMs < 0) {
        return 'Manual retry required';
    }
    const seconds = Math.ceil(retryTimeMs / 1000);
    return `~${seconds}s`;
};

/**
 * Create diagnostic info object
 * 
 * @param {Object} params - Diagnostic parameters
 * @param {string} params.errorType - Error type (timeout, network, server, media, unknown)
 * @param {string} params.deviceTier - Device tier (low, medium, high)
 * @param {string} params.stage - Loading stage where error occurred
 * @param {number} [params.retryCount=0] - Number of retry attempts
 * @param {number} [params.consecutiveFailures=0] - Number of consecutive failures
 * @param {string} [params.errorMessage=''] - Error message
 * @param {boolean} [params.canAutoRetry=true] - Whether auto-retry is available
 * @returns {Object} Diagnostic info object
 * 
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */
export const createDiagnosticInfo = ({
    errorType,
    deviceTier,
    stage,
    retryCount = 0,
    consecutiveFailures = 0,
    errorMessage = '',
    canAutoRetry = true,
}) => {
    return {
        errorType: errorType || 'unknown',
        deviceTier: deviceTier || 'medium',
        stage: stage || 'error',
        retryCount,
        consecutiveFailures,
        errorMessage,
        canAutoRetry,
        timestamp: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
        estimatedRetryTime: getEstimatedRetryTime(errorType, canAutoRetry),
    };
};

/**
 * Format diagnostic info as copyable text
 * 
 * @param {Object} diagnosticInfo - Diagnostic info object
 * @returns {string} Formatted diagnostic text
 * 
 * **Validates: Requirements 8.4**
 */
export const formatDiagnosticText = (diagnosticInfo) => {
    const lines = [
        '=== Stream Diagnostic Info ===',
        `Error Type: ${formatErrorType(diagnosticInfo.errorType)}`,
        `Device Tier: ${formatDeviceTier(diagnosticInfo.deviceTier)}`,
        `Loading Stage: ${diagnosticInfo.stage}`,
        `Stage Message: ${getStageMessage(diagnosticInfo.stage)}`,
        `Retry Count: ${diagnosticInfo.retryCount}`,
        `Consecutive Failures: ${diagnosticInfo.consecutiveFailures}`,
        `Error Message: ${diagnosticInfo.errorMessage || 'N/A'}`,
        `Estimated Retry: ${formatRetryTime(diagnosticInfo.estimatedRetryTime)}`,
        `Timestamp: ${diagnosticInfo.timestamp}`,
        `User Agent: ${diagnosticInfo.userAgent}`,
        '==============================',
    ];
    return lines.join('\n');
};

/**
 * DiagnosticInfo Component
 * 
 * Displays error diagnostic information with copy functionality.
 * 
 * @param {Object} props - Component props
 * @param {string} props.errorType - Error type
 * @param {string} props.deviceTier - Device tier
 * @param {string} props.stage - Loading stage
 * @param {number} [props.retryCount=0] - Retry count
 * @param {number} [props.consecutiveFailures=0] - Consecutive failures
 * @param {string} [props.errorMessage=''] - Error message
 * @param {boolean} [props.canAutoRetry=true] - Whether auto-retry is available
 * @param {boolean} [props.showCopyButton=true] - Whether to show copy button
 * @param {boolean} [props.showRetryEstimate=true] - Whether to show retry estimate
 * @param {boolean} [props.compact=false] - Use compact display mode
 * 
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
 */
const DiagnosticInfo = ({
    errorType,
    deviceTier,
    stage,
    retryCount = 0,
    consecutiveFailures = 0,
    errorMessage = '',
    canAutoRetry = true,
    showCopyButton = true,
    showRetryEstimate = true,
    compact = false,
}) => {
    const [copied, setCopied] = useState(false);

    // Create diagnostic info object
    const diagnosticInfo = useMemo(() => createDiagnosticInfo({
        errorType,
        deviceTier,
        stage,
        retryCount,
        consecutiveFailures,
        errorMessage,
        canAutoRetry,
    }), [errorType, deviceTier, stage, retryCount, consecutiveFailures, errorMessage, canAutoRetry]);

    // Handle copy to clipboard
    // **Validates: Requirements 8.4**
    const handleCopy = useCallback(async () => {
        const text = formatDiagnosticText(diagnosticInfo);
        
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }
        } catch (err) {
            console.error('Failed to copy diagnostic info:', err);
        }
    }, [diagnosticInfo]);

    // Compact mode - single line display
    if (compact) {
        return (
            <div className="flex items-center gap-2 text-dark-500 text-[9px]">
                <span>Type: {formatErrorType(errorType)}</span>
                <span>|</span>
                <span>Device: {formatDeviceTier(deviceTier)}</span>
                <span>|</span>
                <span>Stage: {stage}</span>
                {showCopyButton && (
                    <button
                        onClick={handleCopy}
                        className="ml-1 text-dark-400 hover:text-dark-300 transition-colors"
                        title="Copy diagnostic info"
                    >
                        {copied ? (
                            <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        )}
                    </button>
                )}
            </div>
        );
    }

    // Full display mode
    return (
        <div className="bg-dark-800/50 rounded-lg p-3 text-left">
            <div className="flex items-center justify-between mb-2">
                <p className="text-dark-300 text-[10px] font-medium">Diagnostic Info</p>
                {showCopyButton && (
                    <button
                        onClick={handleCopy}
                        className="flex items-center gap-1 text-dark-400 hover:text-dark-300 text-[9px] transition-colors"
                        title="Copy diagnostic info"
                    >
                        {copied ? (
                            <>
                                <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <span className="text-green-500">Copied!</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                <span>Copy</span>
                            </>
                        )}
                    </button>
                )}
            </div>
            
            <div className="space-y-1.5">
                {/* Error Type - Requirement 8.1 */}
                <div className="flex justify-between text-[9px]">
                    <span className="text-dark-500">Error Type:</span>
                    <span className="text-dark-300 font-medium">{formatErrorType(errorType)}</span>
                </div>
                
                {/* Device Tier - Requirement 8.2 */}
                <div className="flex justify-between text-[9px]">
                    <span className="text-dark-500">Device:</span>
                    <span className="text-dark-300 font-medium">{formatDeviceTier(deviceTier)}</span>
                </div>
                
                {/* Loading Stage - Requirement 8.3 */}
                <div className="flex justify-between text-[9px]">
                    <span className="text-dark-500">Stage:</span>
                    <span className="text-dark-300 font-medium">{stage}</span>
                </div>
                
                {/* Retry Count */}
                {retryCount > 0 && (
                    <div className="flex justify-between text-[9px]">
                        <span className="text-dark-500">Retries:</span>
                        <span className="text-dark-300 font-medium">{retryCount}</span>
                    </div>
                )}
                
                {/* Consecutive Failures */}
                {consecutiveFailures > 0 && (
                    <div className="flex justify-between text-[9px]">
                        <span className="text-dark-500">Failures:</span>
                        <span className="text-dark-300 font-medium">{consecutiveFailures}</span>
                    </div>
                )}
                
                {/* Retry Time Estimate - Requirement 8.5 */}
                {showRetryEstimate && (
                    <div className="flex justify-between text-[9px]">
                        <span className="text-dark-500">Est. Retry:</span>
                        <span className={`font-medium ${canAutoRetry ? 'text-yellow-400' : 'text-dark-400'}`}>
                            {formatRetryTime(diagnosticInfo.estimatedRetryTime)}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

DiagnosticInfo.displayName = 'DiagnosticInfo';

export default DiagnosticInfo;
