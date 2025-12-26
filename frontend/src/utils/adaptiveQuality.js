/**
 * AdaptiveQuality Module
 * Monitors bandwidth and adjusts video quality based on network conditions
 * 
 * **Property 12: Bandwidth-based Quality Adaptation**
 * For any bandwidth measurement:
 * - When bandwidth < 500kbps, quality level SHALL be reduced
 * - When bandwidth > 2Mbps (stable), higher quality levels SHALL be allowed
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
 */

/**
 * Bandwidth thresholds in bits per second
 */
export const BANDWIDTH_THRESHOLDS = {
    LOW: 500000,      // 500kbps - switch to lower quality
    HIGH: 2000000,    // 2Mbps - allow higher quality
    VERY_LOW: 200000, // 200kbps - force lowest quality
};

/**
 * Quality adjustment settings
 */
export const QUALITY_SETTINGS = {
    // Minimum stable samples before allowing quality increase
    MIN_STABLE_SAMPLES: 3,
    // Bandwidth sampling interval in ms
    SAMPLE_INTERVAL: 2000,
    // Maximum quality oscillation prevention window in ms
    OSCILLATION_WINDOW: 10000,
    // Maximum quality changes within oscillation window
    MAX_OSCILLATIONS: 2,
};

/**
 * Network types and their characteristics
 */
export const NETWORK_TYPES = {
    'slow-2g': { maxQuality: 0, expectedBandwidth: 50000 },
    '2g': { maxQuality: 0, expectedBandwidth: 150000 },
    '3g': { maxQuality: 1, expectedBandwidth: 750000 },
    '4g': { maxQuality: -1, expectedBandwidth: 4000000 },
    'wifi': { maxQuality: -1, expectedBandwidth: 10000000 },
    'unknown': { maxQuality: -1, expectedBandwidth: 1000000 },
};

/**
 * Quality adjustment actions
 */
export const QualityAction = {
    DECREASE: 'decrease',
    INCREASE: 'increase',
    MAINTAIN: 'maintain',
    FORCE_LOWEST: 'force_lowest',
};

/**
 * Determine quality action based on bandwidth
 * @param {number} bandwidth - Current bandwidth in bps
 * @param {number} stableSamples - Number of consecutive stable samples
 * @returns {{action: string, reason: string}}
 */
export const determineQualityAction = (bandwidth, stableSamples = 0) => {
    // Validate input
    if (typeof bandwidth !== 'number' || isNaN(bandwidth) || bandwidth < 0) {
        return {
            action: QualityAction.MAINTAIN,
            reason: 'Invalid bandwidth value',
        };
    }

    // Very low bandwidth - force lowest quality
    if (bandwidth < BANDWIDTH_THRESHOLDS.VERY_LOW) {
        return {
            action: QualityAction.FORCE_LOWEST,
            reason: `Bandwidth ${formatBandwidth(bandwidth)} below ${formatBandwidth(BANDWIDTH_THRESHOLDS.VERY_LOW)}`,
        };
    }

    // Low bandwidth - decrease quality
    if (bandwidth < BANDWIDTH_THRESHOLDS.LOW) {
        return {
            action: QualityAction.DECREASE,
            reason: `Bandwidth ${formatBandwidth(bandwidth)} below ${formatBandwidth(BANDWIDTH_THRESHOLDS.LOW)}`,
        };
    }

    // High bandwidth with stability - allow increase
    if (bandwidth > BANDWIDTH_THRESHOLDS.HIGH && stableSamples >= QUALITY_SETTINGS.MIN_STABLE_SAMPLES) {
        return {
            action: QualityAction.INCREASE,
            reason: `Bandwidth ${formatBandwidth(bandwidth)} above ${formatBandwidth(BANDWIDTH_THRESHOLDS.HIGH)} (stable for ${stableSamples} samples)`,
        };
    }

    // Normal bandwidth - maintain current quality
    return {
        action: QualityAction.MAINTAIN,
        reason: `Bandwidth ${formatBandwidth(bandwidth)} within normal range`,
    };
};

/**
 * Format bandwidth for display
 * @param {number} bps - Bandwidth in bits per second
 * @returns {string} Formatted bandwidth string
 */
export const formatBandwidth = (bps) => {
    if (bps >= 1000000) {
        return `${(bps / 1000000).toFixed(2)}Mbps`;
    }
    if (bps >= 1000) {
        return `${(bps / 1000).toFixed(0)}kbps`;
    }
    return `${bps}bps`;
};

/**
 * Get current network connection type
 * @returns {string} Network type
 */
export const getNetworkType = () => {
    if (typeof navigator === 'undefined') return 'unknown';
    
    const connection = navigator.connection || 
                       navigator.mozConnection || 
                       navigator.webkitConnection;
    
    if (!connection) return 'unknown';
    
    return connection.effectiveType || connection.type || 'unknown';
};

/**
 * Get maximum quality level for network type
 * @param {string} networkType - Network connection type
 * @returns {number} Maximum quality level (-1 for auto/unlimited)
 */
export const getMaxQualityForNetwork = (networkType) => {
    // Check if networkType is a valid key in NETWORK_TYPES (not inherited property)
    if (Object.prototype.hasOwnProperty.call(NETWORK_TYPES, networkType)) {
        return NETWORK_TYPES[networkType].maxQuality;
    }
    return NETWORK_TYPES.unknown.maxQuality;
};

/**
 * Check if quality oscillation is occurring
 * @param {Array<{timestamp: number, level: number}>} history - Quality change history
 * @returns {boolean} True if oscillating
 */
export const isOscillating = (history) => {
    if (!Array.isArray(history) || history.length < QUALITY_SETTINGS.MAX_OSCILLATIONS) {
        return false;
    }

    const now = Date.now();
    const recentChanges = history.filter(
        entry => now - entry.timestamp < QUALITY_SETTINGS.OSCILLATION_WINDOW
    );

    return recentChanges.length >= QUALITY_SETTINGS.MAX_OSCILLATIONS;
};

/**
 * Calculate recommended quality level based on bandwidth and current level
 * @param {number} bandwidth - Current bandwidth in bps
 * @param {number} currentLevel - Current quality level
 * @param {number} maxLevel - Maximum available quality level
 * @param {Object} options - Additional options
 * @param {number} options.stableSamples - Number of stable bandwidth samples
 * @param {Array} options.history - Quality change history
 * @returns {{level: number, action: string, reason: string}}
 */
export const calculateRecommendedLevel = (bandwidth, currentLevel, maxLevel, options = {}) => {
    const { stableSamples = 0, history = [] } = options;
    
    // Get quality action based on bandwidth
    const { action, reason } = determineQualityAction(bandwidth, stableSamples);
    
    // Check for oscillation
    if (isOscillating(history) && action !== QualityAction.FORCE_LOWEST) {
        return {
            level: currentLevel,
            action: QualityAction.MAINTAIN,
            reason: 'Preventing quality oscillation',
        };
    }
    
    let newLevel = currentLevel;
    
    switch (action) {
        case QualityAction.FORCE_LOWEST:
            newLevel = 0;
            break;
        case QualityAction.DECREASE:
            newLevel = Math.max(0, currentLevel - 1);
            break;
        case QualityAction.INCREASE:
            newLevel = Math.min(maxLevel, currentLevel + 1);
            break;
        case QualityAction.MAINTAIN:
        default:
            newLevel = currentLevel;
            break;
    }
    
    // Ensure level never exceeds maxLevel (handles case where currentLevel > maxLevel)
    newLevel = Math.min(newLevel, maxLevel);
    
    // Apply network type constraints
    const networkType = getNetworkType();
    const maxForNetwork = getMaxQualityForNetwork(networkType);
    if (maxForNetwork >= 0 && newLevel > maxForNetwork) {
        newLevel = maxForNetwork;
    }
    
    return {
        level: newLevel,
        action: newLevel !== currentLevel ? action : QualityAction.MAINTAIN,
        reason,
    };
};

/**
 * Create an AdaptiveQuality controller
 * @param {Object} hls - HLS.js instance
 * @param {Object} options - Configuration options
 * @param {Function} options.onQualityChange - Callback when quality changes
 * @param {Function} options.onBandwidthUpdate - Callback when bandwidth is measured
 * @param {Function} options.onNetworkChange - Callback when network type changes
 * @returns {Object} AdaptiveQuality controller
 */
export const createAdaptiveQuality = (hls, options = {}) => {
    const {
        onQualityChange = null,
        onBandwidthUpdate = null,
        onNetworkChange = null,
    } = options;
    
    let isRunning = false;
    let samplingInterval = null;
    let bandwidthSamples = [];
    let stableSamples = 0;
    let qualityHistory = [];
    let lastNetworkType = getNetworkType();
    let networkChangeCleanup = null;
    
    /**
     * Get current bandwidth estimate from HLS
     */
    const getCurrentBandwidth = () => {
        if (!hls || !hls.bandwidthEstimate) {
            return 0;
        }
        return hls.bandwidthEstimate;
    };
    
    /**
     * Get current quality level
     */
    const getCurrentLevel = () => {
        if (!hls) return 0;
        return hls.currentLevel >= 0 ? hls.currentLevel : 0;
    };
    
    /**
     * Get maximum quality level
     */
    const getMaxLevel = () => {
        if (!hls || !hls.levels) return 0;
        return hls.levels.length - 1;
    };
    
    /**
     * Set quality level
     */
    const setLevel = (level) => {
        if (!hls) return;
        
        const currentLevel = getCurrentLevel();
        if (level !== currentLevel) {
            hls.currentLevel = level;
            
            // Record in history
            qualityHistory.push({
                timestamp: Date.now(),
                level,
                previousLevel: currentLevel,
            });
            
            // Keep history limited
            if (qualityHistory.length > 10) {
                qualityHistory = qualityHistory.slice(-10);
            }
            
            if (typeof onQualityChange === 'function') {
                onQualityChange(level, currentLevel);
            }
        }
    };
    
    /**
     * Process bandwidth sample
     */
    const processBandwidthSample = () => {
        const bandwidth = getCurrentBandwidth();
        
        if (bandwidth <= 0) return;
        
        // Add to samples
        bandwidthSamples.push(bandwidth);
        if (bandwidthSamples.length > 5) {
            bandwidthSamples = bandwidthSamples.slice(-5);
        }
        
        // Calculate average bandwidth
        const avgBandwidth = bandwidthSamples.reduce((a, b) => a + b, 0) / bandwidthSamples.length;
        
        // Check stability
        const isStable = bandwidthSamples.every(
            sample => Math.abs(sample - avgBandwidth) / avgBandwidth < 0.3
        );
        
        if (isStable && avgBandwidth > BANDWIDTH_THRESHOLDS.HIGH) {
            stableSamples++;
        } else if (avgBandwidth < BANDWIDTH_THRESHOLDS.LOW) {
            stableSamples = 0;
        }
        
        if (typeof onBandwidthUpdate === 'function') {
            onBandwidthUpdate(avgBandwidth, isStable);
        }
        
        // Calculate and apply recommended level
        const currentLevel = getCurrentLevel();
        const maxLevel = getMaxLevel();
        
        const recommendation = calculateRecommendedLevel(
            avgBandwidth,
            currentLevel,
            maxLevel,
            { stableSamples, history: qualityHistory }
        );
        
        if (recommendation.level !== currentLevel) {
            setLevel(recommendation.level);
        }
    };
    
    /**
     * Handle network type change
     */
    const handleNetworkChange = () => {
        const newNetworkType = getNetworkType();
        
        if (newNetworkType !== lastNetworkType) {
            lastNetworkType = newNetworkType;
            
            // Reset stability tracking on network change
            stableSamples = 0;
            bandwidthSamples = [];
            
            if (typeof onNetworkChange === 'function') {
                onNetworkChange(newNetworkType);
            }
            
            // Apply network-specific constraints
            const maxForNetwork = getMaxQualityForNetwork(newNetworkType);
            const currentLevel = getCurrentLevel();
            
            if (maxForNetwork >= 0 && currentLevel > maxForNetwork) {
                setLevel(maxForNetwork);
            }
        }
    };
    
    /**
     * Set up network change listener
     */
    const setupNetworkListener = () => {
        if (typeof navigator === 'undefined') return;
        
        const connection = navigator.connection || 
                           navigator.mozConnection || 
                           navigator.webkitConnection;
        
        if (connection) {
            connection.addEventListener('change', handleNetworkChange);
            networkChangeCleanup = () => {
                connection.removeEventListener('change', handleNetworkChange);
            };
        }
    };
    
    return {
        /**
         * Start adaptive quality monitoring
         */
        start: () => {
            if (isRunning) return;
            
            isRunning = true;
            bandwidthSamples = [];
            stableSamples = 0;
            qualityHistory = [];
            lastNetworkType = getNetworkType();
            
            // Set up network listener
            setupNetworkListener();
            
            // Start bandwidth sampling
            samplingInterval = setInterval(processBandwidthSample, QUALITY_SETTINGS.SAMPLE_INTERVAL);
            
            // Initial sample
            processBandwidthSample();
        },
        
        /**
         * Stop adaptive quality monitoring
         */
        stop: () => {
            if (!isRunning) return;
            
            isRunning = false;
            
            if (samplingInterval) {
                clearInterval(samplingInterval);
                samplingInterval = null;
            }
            
            if (networkChangeCleanup) {
                networkChangeCleanup();
                networkChangeCleanup = null;
            }
        },
        
        /**
         * Check if monitoring is running
         */
        isRunning: () => isRunning,
        
        /**
         * Get current bandwidth estimate
         */
        getBandwidth: getCurrentBandwidth,
        
        /**
         * Get current quality level
         */
        getLevel: getCurrentLevel,
        
        /**
         * Get quality change history
         */
        getHistory: () => [...qualityHistory],
        
        /**
         * Get current network type
         */
        getNetworkType: () => lastNetworkType,
        
        /**
         * Force a specific quality level
         */
        forceLevel: (level) => {
            const maxLevel = getMaxLevel();
            const clampedLevel = Math.max(0, Math.min(level, maxLevel));
            setLevel(clampedLevel);
        },
        
        /**
         * Reset to auto quality selection
         */
        resetToAuto: () => {
            if (hls) {
                hls.currentLevel = -1;
            }
            stableSamples = 0;
            bandwidthSamples = [];
        },
    };
};

export default {
    createAdaptiveQuality,
    determineQualityAction,
    calculateRecommendedLevel,
    formatBandwidth,
    getNetworkType,
    getMaxQualityForNetwork,
    isOscillating,
    BANDWIDTH_THRESHOLDS,
    QUALITY_SETTINGS,
    NETWORK_TYPES,
    QualityAction,
};
