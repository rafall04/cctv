import { useCallback, useEffect, useRef } from 'react';

export function useAdminReconnectRefresh(refresh, options = {}) {
    const {
        enabled = true,
        cooldownMs = 2000,
    } = options;

    const refreshRef = useRef(refresh);
    const inFlightPromiseRef = useRef(null);
    const requestIdRef = useRef(0);
    const lastTriggerAtRef = useRef(0);

    useEffect(() => {
        refreshRef.current = refresh;
    }, [refresh]);

    const triggerRefresh = useCallback((reason = 'manual') => {
        if (!enabled || typeof refreshRef.current !== 'function') {
            return Promise.resolve();
        }

        const now = Date.now();
        if (now - lastTriggerAtRef.current < cooldownMs) {
            return inFlightPromiseRef.current || Promise.resolve();
        }

        if (inFlightPromiseRef.current) {
            return inFlightPromiseRef.current;
        }

        lastTriggerAtRef.current = now;
        const requestId = ++requestIdRef.current;

        const refreshPromise = Promise.resolve(
            refreshRef.current({
                reason,
                requestId,
                isReconnectRefresh: reason !== 'manual',
            })
        ).finally(() => {
            if (requestIdRef.current === requestId) {
                inFlightPromiseRef.current = null;
            }
        });

        inFlightPromiseRef.current = refreshPromise;
        return refreshPromise;
    }, [cooldownMs, enabled]);

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }

        const handleFocus = () => {
            triggerRefresh('focus');
        };

        const handleOnline = () => {
            triggerRefresh('online');
        };

        const handleReconnect = () => {
            triggerRefresh('network-reconnected');
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                triggerRefresh('visibilitychange');
            }
        };

        window.addEventListener('focus', handleFocus);
        window.addEventListener('online', handleOnline);
        window.addEventListener('network-reconnected', handleReconnect);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('network-reconnected', handleReconnect);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [enabled, triggerRefresh]);

    return triggerRefresh;
}

export default useAdminReconnectRefresh;
