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
    const mountedRef = useRef(true);

    /**
     * Initialize CSRF token on app load
     */
    const initializeCsrf = useCallback(async () => {
        if (import.meta.env.MODE === 'test') {
            if (mountedRef.current) {
                setCsrfError(null);
                setCsrfReady(true);
            }
            return;
        }

        // Prevent double initialization (React StrictMode causes double mount)
        if (initializingRef.current) {
            return;
        }
        
        initializingRef.current = true;
        
        try {
            if (mountedRef.current) {
                setCsrfError(null);
            }
            const token = await fetchCsrfToken();
            if (!mountedRef.current) {
                return;
            }
            if (token) {
                setCsrfReady(true);
            } else {
                // CSRF fetch failed but don't block the app
                // The apiClient will retry on state-changing requests
                setCsrfReady(true);
            }
        } catch (error) {
            if (!mountedRef.current) {
                return;
            }
            setCsrfError(error.message);
            // Still mark as ready to not block the app
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
        mountedRef.current = true;
        initializeCsrf();
        return () => {
            mountedRef.current = false;
        };
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
