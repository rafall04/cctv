/*
 * Purpose: Check landing-page backend reachability and re-check on browser visibility/network events.
 * Caller: Public landing page bootstrapping and connectivity recovery flows.
 * Deps: React hooks, runtime API config, connectionTester reachability helper.
 * MainFuncs: resolveHealthUrl, useLandingReachability.
 * SideEffects: Issues health-check requests and logs reachability warnings.
 */

import { useCallback, useEffect, useRef } from 'react';
import { getApiUrl } from '../../config/config.js';
import { testBackendReachability } from '../../utils/connectionTester';

function resolveHealthUrl() {
    const apiBaseUrl = getApiUrl().replace(/\/$/, '');
    return apiBaseUrl ? `${apiBaseUrl}/health` : '/health';
}

export { resolveHealthUrl };

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
            const isReachable = result?.reachable === true;

            if (mountedRef.current && !isReachable) {
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
