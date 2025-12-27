import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useNetworkStatus Hook
 * 
 * Custom hook for detecting online/offline network status and triggering
 * callbacks on status changes.
 * 
 * Requirements: 10.1, 10.2
 */

/**
 * Network status constants
 */
export const NETWORK_STATUS = {
    ONLINE: 'online',
    OFFLINE: 'offline',
};

/**
 * Get current network status
 * @returns {string} Current network status ('online' or 'offline')
 */
export function getNetworkStatus() {
    // navigator.onLine is the standard way to check network status
    // Returns true if browser is online, false if offline
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
        return navigator.onLine ? NETWORK_STATUS.ONLINE : NETWORK_STATUS.OFFLINE;
    }
    // Default to online if navigator.onLine is not available (SSR)
    return NETWORK_STATUS.ONLINE;
}

/**
 * Check if currently online
 * @returns {boolean} True if online
 */
export function isOnline() {
    return getNetworkStatus() === NETWORK_STATUS.ONLINE;
}

/**
 * Check if currently offline
 * @returns {boolean} True if offline
 */
export function isOffline() {
    return getNetworkStatus() === NETWORK_STATUS.OFFLINE;
}

/**
 * useNetworkStatus Hook
 * 
 * Detects online/offline status and triggers callbacks on status change.
 * 
 * @param {Object} options - Hook options
 * @param {Function} [options.onOnline] - Callback when network comes online
 * @param {Function} [options.onOffline] - Callback when network goes offline
 * @param {Function} [options.onStatusChange] - Callback on any status change (receives new status)
 * @returns {Object} Network status information and methods
 */
export function useNetworkStatus(options = {}) {
    const { onOnline, onOffline, onStatusChange } = options;
    
    const [status, setStatus] = useState(getNetworkStatus);
    const [lastOnlineTime, setLastOnlineTime] = useState(
        () => isOnline() ? Date.now() : null
    );
    const [lastOfflineTime, setLastOfflineTime] = useState(null);
    
    // Store previous status to detect changes
    const previousStatusRef = useRef(status);
    
    // Store callbacks in refs to avoid re-registering event listeners
    const onOnlineRef = useRef(onOnline);
    const onOfflineRef = useRef(onOffline);
    const onStatusChangeRef = useRef(onStatusChange);
    
    // Update refs when callbacks change
    useEffect(() => {
        onOnlineRef.current = onOnline;
        onOfflineRef.current = onOffline;
        onStatusChangeRef.current = onStatusChange;
    }, [onOnline, onOffline, onStatusChange]);

    /**
     * Handle online event
     */
    const handleOnline = useCallback(() => {
        const newStatus = NETWORK_STATUS.ONLINE;
        const previousStatus = previousStatusRef.current;
        
        setStatus(newStatus);
        setLastOnlineTime(Date.now());
        previousStatusRef.current = newStatus;
        
        // Only trigger callbacks if status actually changed
        if (previousStatus !== newStatus) {
            if (onOnlineRef.current) {
                onOnlineRef.current();
            }
            if (onStatusChangeRef.current) {
                onStatusChangeRef.current(newStatus, previousStatus);
            }
        }
    }, []);

    /**
     * Handle offline event
     */
    const handleOffline = useCallback(() => {
        const newStatus = NETWORK_STATUS.OFFLINE;
        const previousStatus = previousStatusRef.current;
        
        setStatus(newStatus);
        setLastOfflineTime(Date.now());
        previousStatusRef.current = newStatus;
        
        // Only trigger callbacks if status actually changed
        if (previousStatus !== newStatus) {
            if (onOfflineRef.current) {
                onOfflineRef.current();
            }
            if (onStatusChangeRef.current) {
                onStatusChangeRef.current(newStatus, previousStatus);
            }
        }
    }, []);

    /**
     * Manually refresh network status
     * Useful for checking status after a failed request
     */
    const refresh = useCallback(() => {
        const currentStatus = getNetworkStatus();
        if (currentStatus === NETWORK_STATUS.ONLINE) {
            handleOnline();
        } else {
            handleOffline();
        }
    }, [handleOnline, handleOffline]);

    // Set up event listeners
    useEffect(() => {
        // Add event listeners for online/offline events
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        
        // Initial status check
        const initialStatus = getNetworkStatus();
        if (initialStatus !== status) {
            if (initialStatus === NETWORK_STATUS.ONLINE) {
                handleOnline();
            } else {
                handleOffline();
            }
        }
        
        // Cleanup
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [handleOnline, handleOffline, status]);

    return {
        // Current status
        status,
        isOnline: status === NETWORK_STATUS.ONLINE,
        isOffline: status === NETWORK_STATUS.OFFLINE,
        
        // Timestamps
        lastOnlineTime,
        lastOfflineTime,
        
        // Methods
        refresh,
    };
}

/**
 * Create a network status observer (non-hook version)
 * Useful for use outside of React components
 * 
 * @param {Object} options - Observer options
 * @param {Function} [options.onOnline] - Callback when network comes online
 * @param {Function} [options.onOffline] - Callback when network goes offline
 * @param {Function} [options.onStatusChange] - Callback on any status change
 * @returns {Object} Observer with start, stop, and getStatus methods
 */
export function createNetworkStatusObserver(options = {}) {
    const { onOnline, onOffline, onStatusChange } = options;
    
    let currentStatus = getNetworkStatus();
    let isActive = false;
    
    const handleOnline = () => {
        const previousStatus = currentStatus;
        currentStatus = NETWORK_STATUS.ONLINE;
        
        if (previousStatus !== currentStatus) {
            if (onOnline) onOnline();
            if (onStatusChange) onStatusChange(currentStatus, previousStatus);
        }
    };
    
    const handleOffline = () => {
        const previousStatus = currentStatus;
        currentStatus = NETWORK_STATUS.OFFLINE;
        
        if (previousStatus !== currentStatus) {
            if (onOffline) onOffline();
            if (onStatusChange) onStatusChange(currentStatus, previousStatus);
        }
    };
    
    return {
        /**
         * Start observing network status
         */
        start() {
            if (isActive) return;
            
            window.addEventListener('online', handleOnline);
            window.addEventListener('offline', handleOffline);
            isActive = true;
            
            // Check initial status
            const initialStatus = getNetworkStatus();
            if (initialStatus !== currentStatus) {
                if (initialStatus === NETWORK_STATUS.ONLINE) {
                    handleOnline();
                } else {
                    handleOffline();
                }
            }
        },
        
        /**
         * Stop observing network status
         */
        stop() {
            if (!isActive) return;
            
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            isActive = false;
        },
        
        /**
         * Get current network status
         * @returns {string} Current status
         */
        getStatus() {
            return currentStatus;
        },
        
        /**
         * Check if observer is active
         * @returns {boolean} True if active
         */
        isActive() {
            return isActive;
        },
        
        /**
         * Refresh status manually
         */
        refresh() {
            const newStatus = getNetworkStatus();
            if (newStatus === NETWORK_STATUS.ONLINE) {
                handleOnline();
            } else {
                handleOffline();
            }
        },
    };
}

export default useNetworkStatus;
