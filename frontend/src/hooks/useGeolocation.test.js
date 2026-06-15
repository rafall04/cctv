/*
 * Purpose: Verify the one-shot geolocation hook (support detection, success, error mapping, unmount safety).
 * Caller: Frontend hooks test gate.
 * Deps: Vitest, @testing-library/react renderHook, mocked navigator.geolocation.
 * MainFuncs: useGeolocation tests.
 * SideEffects: Stubs navigator.geolocation per test.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGeolocation } from './useGeolocation.js';

function setGeolocation(value) {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value });
}

describe('useGeolocation', () => {
    afterEach(() => {
        setGeolocation(undefined);
        vi.restoreAllMocks();
    });

    it('reports unsupported and surfaces a message when geolocation is absent', () => {
        setGeolocation(undefined);
        const { result } = renderHook(() => useGeolocation());

        expect(result.current.supported).toBe(false);

        act(() => result.current.requestLocation());

        expect(result.current.error).toBe('GPS tidak didukung di browser ini');
        expect(result.current.loading).toBe(false);
        expect(result.current.position).toBeNull();
    });

    it('sets position and clears loading on success', async () => {
        const getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: -7.15, longitude: 111.88, accuracy: 25 } }));
        setGeolocation({ getCurrentPosition });

        const { result } = renderHook(() => useGeolocation());
        expect(result.current.supported).toBe(true);

        act(() => result.current.requestLocation());

        await waitFor(() => {
            expect(result.current.position).toEqual({ latitude: -7.15, longitude: 111.88, accuracy: 25 });
        });
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(getCurrentPosition).toHaveBeenCalledTimes(1);
        // Default options favour speed/battery for "near me".
        expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false });
    });

    it.each([
        [1, 'Akses GPS ditolak. Izinkan akses lokasi di browser.'],
        [2, 'Lokasi tidak tersedia'],
        [3, 'Timeout mendapatkan lokasi'],
        [99, 'Gagal mendapatkan lokasi GPS'],
    ])('maps error code %i to its Indonesian message', async (code, message) => {
        const getCurrentPosition = vi.fn((_ok, err) => err({ code }));
        setGeolocation({ getCurrentPosition });

        const { result } = renderHook(() => useGeolocation());
        act(() => result.current.requestLocation());

        await waitFor(() => {
            expect(result.current.error).toBe(message);
        });
        expect(result.current.loading).toBe(false);
    });

    it('surfaces a distinct message on an insecure (non-HTTPS) context without calling the API', () => {
        const getCurrentPosition = vi.fn();
        setGeolocation({ getCurrentPosition });
        const originalSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
        Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });

        try {
            const { result } = renderHook(() => useGeolocation());
            act(() => result.current.requestLocation());

            expect(result.current.error).toBe('GPS hanya aktif di koneksi aman (HTTPS).');
            expect(result.current.loading).toBe(false);
            expect(getCurrentPosition).not.toHaveBeenCalled();
        } finally {
            if (originalSecure) {
                Object.defineProperty(window, 'isSecureContext', originalSecure);
            } else {
                delete window.isSecureContext;
            }
        }
    });

    it('resets position and error via clearPosition()', async () => {
        const getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: -7.15, longitude: 111.88, accuracy: 10 } }));
        setGeolocation({ getCurrentPosition });

        const { result } = renderHook(() => useGeolocation());
        act(() => result.current.requestLocation());
        await waitFor(() => expect(result.current.position).not.toBeNull());

        act(() => result.current.clearPosition());
        expect(result.current.position).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it('ignores a stray (event-like) argument and keeps default options', async () => {
        const getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: 1, longitude: 2, accuracy: 5 } }));
        setGeolocation({ getCurrentPosition });

        const { result } = renderHook(() => useGeolocation());
        // Simulate onClick={requestLocation} passing a synthetic-event-like object.
        act(() => result.current.requestLocation({ nativeEvent: {}, target: {}, timeStamp: 123 }));

        await waitFor(() => expect(result.current.position).not.toBeNull());
        const opts = getCurrentPosition.mock.calls[0][2];
        expect(opts).toEqual({ enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 });
    });

    it('clears the error via clear()', async () => {
        const getCurrentPosition = vi.fn((_ok, err) => err({ code: 1 }));
        setGeolocation({ getCurrentPosition });

        const { result } = renderHook(() => useGeolocation());
        act(() => result.current.requestLocation());
        await waitFor(() => expect(result.current.error).toBeTruthy());

        act(() => result.current.clear());
        expect(result.current.error).toBeNull();
    });

    it('does not set state after unmount', () => {
        let fireSuccess;
        const getCurrentPosition = vi.fn((ok) => {
            fireSuccess = () => ok({ coords: { latitude: 1, longitude: 2, accuracy: 5 } });
        });
        setGeolocation({ getCurrentPosition });

        const { result, unmount } = renderHook(() => useGeolocation());
        act(() => result.current.requestLocation());
        unmount();

        // Fire the async callback after unmount — must be a no-op, not throw or warn.
        expect(() => act(() => fireSuccess())).not.toThrow();
    });
});
