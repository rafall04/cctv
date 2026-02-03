import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { fetchCsrfToken, clearCsrfToken } from '../services/apiClient';

/**
 * Security Context
 * 
 * Manages CSRF token lifecycle and security state for the application.
 * Fetches CSRF token on app load and provides refresh functionality.
 * 
 * Requirements: 1.6
 */

const SecurityContext = createContext(null);

export function SecurityProvider({ children }) {
    const [csrfReady, setCsrfReady] = useState(false);
    const [csrfError, setCsrfError] = useState(null);
    const initializingRef = useRef(false);

    /**
     * Initialize CSRF token on app load
     */
    const initializeCsrf = useCallback(async () => {
        // Prevent double initialization (React StrictMode causes double mount)
        if (initializingRef.current) {
            return;
        }
        
        initializingRef.current = true;
        
        try {
            setCsrfError(null);
            const token = await fetchCsrfToken();
            if (token) {
                setCsrfReady(true);
            } else {
                // CSRF fetch failed but don't block the app
                // The apiClient will retry on state-changing requests
                setCsrfReady(true);
                // Don't log warning - it's expected on first load
                // The token will be fetched automatically on first POST/PUT/DELETE request
            }
        } catch (error) {
            // Silently handle error - CSRF will be fetched on demand
            setCsrfError(null); // Don't set error to avoid blocking UI
            setCsrfReady(true);
        } finally {
            initializingRef.current = false;
        }
    }, []);

    /**
     * Refresh CSRF token manually
     */
    const refreshCsrf = useCallback(async () => {
        clearCsrfToken();
        await initializeCsrf();
    }, [initializeCsrf]);

    /**
     * Clear security state (call on logout)
     */
    const clearSecurity = useCallback(() => {
        clearCsrfToken();
        setCsrfReady(false);
        setCsrfError(null);
    }, []);

    // Initialize CSRF on mount
    useEffect(() => {
        initializeCsrf();
    }, [initializeCsrf]);

    const value = {
        csrfReady,
        csrfError,
        refreshCsrf,
        clearSecurity,
    };

    return (
        <SecurityContext.Provider value={value}>
            {children}
        </SecurityContext.Provider>
    );
}

/**
 * Hook to access security context
 * @returns {Object} Security context value
 */
export function useSecurity() {
    const context = useContext(SecurityContext);
    if (!context) {
        throw new Error('useSecurity must be used within a SecurityProvider');
    }
    return context;
}

export default SecurityContext;
