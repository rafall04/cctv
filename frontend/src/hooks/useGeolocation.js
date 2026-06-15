/*
 * Purpose: Reusable one-shot browser geolocation hook for public "near me" features.
 * Caller: MapView public map GPS button (reusable by any opt-in geolocation UI).
 * Deps: Browser navigator.geolocation only.
 * MainFuncs: useGeolocation.
 * SideEffects: Requests the device location on demand, which triggers a browser permission prompt.
 *
 * NOTE: navigator.geolocation requires a secure context — HTTPS, or http://localhost / 127.0.0.1
 * (browsers treat localhost as secure). `npm run dev` on localhost works; testing "near me" from a
 * real phone over a plain-http LAN IP (e.g. http://192.168.x.x:5173) will fail with PERMISSION_DENIED.
 * Production behind HTTPS is unaffected.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Indonesian messages mirror components/LocationPicker.jsx so GPS UX stays consistent.
const MESSAGES = {
    unsupported: 'GPS tidak didukung di browser ini',
    insecure: 'GPS hanya aktif di koneksi aman (HTTPS).',
    denied: 'Akses GPS ditolak. Izinkan akses lokasi di browser.',
    unavailable: 'Lokasi tidak tersedia',
    timeout: 'Timeout mendapatkan lokasi',
    generic: 'Gagal mendapatkan lokasi GPS',
};

// enableHighAccuracy:false → faster + less battery; coarse accuracy is fine for "CCTV near me".
const DEFAULT_OPTIONS = {
    enableHighAccuracy: false,
    timeout: 10000,
    maximumAge: 30000,
};

const isSupported = () => typeof navigator !== 'undefined'
    && 'geolocation' in navigator
    && !!navigator.geolocation;

const resolveErrorMessage = (error) => {
    if (!error) {
        return MESSAGES.generic;
    }
    // Match by the W3C numeric constants when present, falling back to literals so the hook works
    // with hand-built error objects in tests (jsdom has no GeolocationPositionError constructor).
    if (error.code === error.PERMISSION_DENIED || error.code === 1) {
        return MESSAGES.denied;
    }
    if (error.code === error.POSITION_UNAVAILABLE || error.code === 2) {
        return MESSAGES.unavailable;
    }
    if (error.code === error.TIMEOUT || error.code === 3) {
        return MESSAGES.timeout;
    }
    return MESSAGES.generic;
};

export function useGeolocation() {
    const [position, setPosition] = useState(null); // { latitude, longitude, accuracy } | null
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const clear = useCallback(() => {
        setError(null);
    }, []);

    const clearPosition = useCallback(() => {
        setPosition(null);
        setError(null);
    }, []);

    const requestLocation = useCallback((overrides = {}) => {
        if (!isSupported()) {
            setError(MESSAGES.unsupported);
            return;
        }
        // Plain-http LAN origins reject geolocation with PERMISSION_DENIED, which the user cannot
        // fix via browser settings — surface the real cause instead of a misleading "denied".
        if (typeof window !== 'undefined' && window.isSecureContext === false) {
            setError(MESSAGES.insecure);
            return;
        }

        setLoading(true);
        setError(null);

        // Whitelist only the known geolocation option keys so an accidental click-event argument
        // (or any stray object) can never corrupt the request options.
        const safeOverrides = overrides && typeof overrides === 'object' ? overrides : {};
        const options = { ...DEFAULT_OPTIONS };
        if (typeof safeOverrides.enableHighAccuracy === 'boolean') {
            options.enableHighAccuracy = safeOverrides.enableHighAccuracy;
        }
        if (Number.isFinite(safeOverrides.timeout)) {
            options.timeout = safeOverrides.timeout;
        }
        if (Number.isFinite(safeOverrides.maximumAge)) {
            options.maximumAge = safeOverrides.maximumAge;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (!isMountedRef.current) return;
                setPosition({
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                });
                setLoading(false);
            },
            (err) => {
                if (!isMountedRef.current) return;
                setError(resolveErrorMessage(err));
                setLoading(false);
            },
            options,
        );
    }, []);

    return {
        position,
        loading,
        error,
        supported: isSupported(),
        requestLocation,
        clear,
        clearPosition,
    };
}

export default useGeolocation;
