import { useCallback, useEffect, useRef } from 'react';
import { getApiUrl } from '../../config/config.js';
import { testBackendReachability } from '../../utils/connectionTester';

function resolveHealthUrl() {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
        return '/api/health';
    }

    if (protocol === 'https:') {
        const frontendDomain = import.meta.env.VITE_FRONTEND_DOMAIN || hostname;
        if (hostname === frontendDomain) {
            return `${getApiUrl().replace(/\/$/, '')}/health`;
        }
        return `${protocol}//${hostname.replace('cctv.', 'api-cctv.')}/health`;
    }

    return `${getApiUrl().replace(/\/$/, '')}/health`;
}

export function useLandingReachability() {
    const mountedRef = useRef(true);
    const inFlightRef = useRef(false);
    const lastCheckRef = useRef(0);

    const checkReachability = useCallback(async ({ force = false } = {}) => {
        const now = Date.now();
        if (!force && now - lastCheckRef.current < 3000) {
            return;
        }

        if (inFlightRef.current) {
            return;
        }

        inFlightRef.current = true;
        lastCheckRef.current = now;

        try {
            const result = await testBackendReachability(resolveHealthUrl());
            if (mountedRef.current && !result.reachable) {
                console.warn('[LandingPage] Backend health check unreachable');
            }
        } catch (err) {
            if (mountedRef.current) {
                console.warn('[LandingPage] Backend health check failed:', err);
            }
        } finally {
            inFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        checkReachability({ force: true });

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkReachability();
            }
        };

        const handleFocus = () => {
            checkReachability();
        };

        const handleOnline = () => {
            checkReachability({ force: true });
        };

        window.addEventListener('focus', handleFocus);
        window.addEventListener('online', handleOnline);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            mountedRef.current = false;
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('online', handleOnline);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [checkReachability]);

    return checkReachability;
}

export default useLandingReachability;
