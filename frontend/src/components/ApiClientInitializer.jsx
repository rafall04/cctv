import { useEffect, useRef } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { setNotificationCallback, setTimeoutRetryCallback } from '../services/apiClient';

/**
 * ApiClientInitializer Component
 * 
 * Initializes the apiClient with notification callbacks for error handling.
 * This component should be rendered inside the NotificationProvider.
 * 
 * Requirements: 10.3 (timeout handling with retry option)
 */
export function ApiClientInitializer({ children }) {
    const { showNotification, warning } = useNotification();
    const retryFnRef = useRef(null);

    useEffect(() => {
        // Set up notification callback for apiClient
        setNotificationCallback((type, title, message) => {
            showNotification({ type, title, message });
        });

        // Set up timeout retry callback
        // This allows the apiClient to offer retry option on timeout
        setTimeoutRetryCallback((retryFn, originalRequest) => {
            retryFnRef.current = retryFn;
            
            // Show warning notification with retry action
            showNotification({
                type: 'warning',
                title: 'Request Timeout',
                message: 'The request took too long. Would you like to retry?',
                duration: 10000, // Show for 10 seconds
                action: {
                    label: 'Retry',
                    onClick: async () => {
                        if (retryFnRef.current) {
                            try {
                                await retryFnRef.current();
                            } catch (error) {
                                // Error will be handled by the interceptor
                                console.error('Retry failed:', error);
                            }
                        }
                    },
                },
            });
        });

        // Cleanup on unmount
        return () => {
            setNotificationCallback(null);
            setTimeoutRetryCallback(null);
        };
    }, [showNotification, warning]);

    return children;
}

export default ApiClientInitializer;
