import { useState, useEffect, useCallback } from 'react';
import { useNetworkStatus, NETWORK_STATUS } from '../../hooks/useNetworkStatus';

/**
 * NetworkStatusBanner Component
 * 
 * Displays a persistent banner when offline and a brief success notification
 * when the connection is restored.
 * 
 * Requirements: 10.1, 10.2
 */

// Icon components
const WifiOffIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
    </svg>
);

const WifiIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
    </svg>
);

const CloseIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M6 18L18 6M6 6l12 12" />
    </svg>
);

// Duration for showing the "back online" success message
const ONLINE_SUCCESS_DURATION = 3000; // 3 seconds

/**
 * NetworkStatusBanner component
 * 
 * @param {Object} props
 * @param {Function} [props.onOnline] - Callback when network comes online
 * @param {Function} [props.onOffline] - Callback when network goes offline
 * @param {boolean} [props.showSuccessOnReconnect=true] - Whether to show success message on reconnect
 * @param {string} [props.className] - Additional CSS classes
 */
export function NetworkStatusBanner({
    onOnline,
    onOffline,
    showSuccessOnReconnect = true,
    className = '',
}) {
    const [showOnlineSuccess, setShowOnlineSuccess] = useState(false);
    const [wasOffline, setWasOffline] = useState(false);
    
    // Handle online callback
    const handleOnline = useCallback(() => {
        // Only show success if we were previously offline
        if (wasOffline && showSuccessOnReconnect) {
            setShowOnlineSuccess(true);
            
            // Auto-hide after duration
            setTimeout(() => {
                setShowOnlineSuccess(false);
            }, ONLINE_SUCCESS_DURATION);
        }
        
        setWasOffline(false);
        
        if (onOnline) {
            onOnline();
        }
    }, [wasOffline, showSuccessOnReconnect, onOnline]);
    
    // Handle offline callback
    const handleOffline = useCallback(() => {
        setWasOffline(true);
        setShowOnlineSuccess(false);
        
        if (onOffline) {
            onOffline();
        }
    }, [onOffline]);
    
    const { isOffline } = useNetworkStatus({
        onOnline: handleOnline,
        onOffline: handleOffline,
    });
    
    // Track if we started offline
    useEffect(() => {
        if (isOffline) {
            setWasOffline(true);
        }
    }, [isOffline]);
    
    // Dismiss the online success message
    const dismissOnlineSuccess = useCallback(() => {
        setShowOnlineSuccess(false);
    }, []);
    
    // Show offline banner
    if (isOffline) {
        return (
            <div
                className={`
                    fixed top-0 left-0 right-0 z-50
                    bg-red-600 text-white
                    px-4 py-3
                    shadow-lg
                    ${className}
                `}
                role="alert"
                aria-live="assertive"
            >
                <div className="flex items-center justify-center gap-3 max-w-7xl mx-auto">
                    <WifiOffIcon />
                    <div className="flex-1 text-center">
                        <span className="font-medium">You are offline</span>
                        <span className="hidden sm:inline ml-2 text-red-100">
                            — Please check your internet connection
                        </span>
                    </div>
                </div>
            </div>
        );
    }
    
    // Show brief success message when back online
    if (showOnlineSuccess) {
        return (
            <div
                className={`
                    fixed top-0 left-0 right-0 z-50
                    bg-emerald-600 text-white
                    px-4 py-3
                    shadow-lg
                    animate-fade-in
                    ${className}
                `}
                role="status"
                aria-live="polite"
            >
                <div className="flex items-center justify-center gap-3 max-w-7xl mx-auto">
                    <WifiIcon />
                    <div className="flex-1 text-center">
                        <span className="font-medium">Back online</span>
                        <span className="hidden sm:inline ml-2 text-emerald-100">
                            — Connection restored
                        </span>
                    </div>
                    <button
                        onClick={dismissOnlineSuccess}
                        className="p-1 rounded hover:bg-emerald-500 transition-colors"
                        aria-label="Dismiss"
                    >
                        <CloseIcon />
                    </button>
                </div>
            </div>
        );
    }
    
    // Nothing to show when online and no success message
    return null;
}

/**
 * Get banner configuration for a given network status
 * Useful for testing and external styling
 * 
 * @param {string} status - Network status ('online' or 'offline')
 * @returns {Object} Banner configuration
 */
export function getBannerConfig(status) {
    if (status === NETWORK_STATUS.OFFLINE) {
        return {
            visible: true,
            type: 'offline',
            bgColor: 'bg-red-600',
            textColor: 'text-white',
            message: 'You are offline',
            description: 'Please check your internet connection',
        };
    }
    
    return {
        visible: false,
        type: 'online',
        bgColor: 'bg-emerald-600',
        textColor: 'text-white',
        message: 'Back online',
        description: 'Connection restored',
    };
}

export default NetworkStatusBanner;
