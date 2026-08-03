/*
 * Purpose: Coordinate public playback token/share-key activation from URL/manual input.
 * Caller: Playback page.
 * Deps: React hooks and playbackTokenService.
 * MainFuncs: usePlaybackTokenAccess.
 * SideEffects: Activates HttpOnly playback token/session cookies and sends session heartbeat.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import playbackTokenService from '../../services/playbackTokenService.js';

const PLAYBACK_CLIENT_ID_KEY = 'raf_playback_client_id';
const HEARTBEAT_INTERVAL_MS = 30_000;

function getOrCreateClientId() {
    if (typeof window === 'undefined') {
        return '';
    }

    const existing = window.localStorage.getItem(PLAYBACK_CLIENT_ID_KEY);
    if (existing) {
        return existing;
    }

    const generated = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(PLAYBACK_CLIENT_ID_KEY, generated);
    return generated;
}

export function usePlaybackTokenAccess({
    enabled,
    searchParams,
    setSearchParams,
    cameraId,
    onActivated,
    onCleared,
}) {
    const [tokenInput, setTokenInput] = useState('');
    const [tokenStatus, setTokenStatus] = useState(null);
    const [tokenMessage, setTokenMessage] = useState('');
    const [isTokenBusy, setIsTokenBusy] = useState(false);
    /** The URL credential already activated, so a re-render cannot fire a second attempt. */
    const activatedCredentialRef = useRef(null);
    /** The cookie has been asked about once; asking again on every render would be a request storm. */
    const hydratedRef = useRef(false);

    const activateToken = useCallback(async (rawToken, { silent = false, mode = 'token', cameraIdOverride = null } = {}) => {
        const token = String(rawToken || '').trim();
        if (!enabled || !token) {
            return false;
        }

        setIsTokenBusy(true);
        setTokenMessage(silent ? '' : 'Mengaktifkan token...');
        try {
            const response = mode === 'share'
                ? await playbackTokenService.activateShareKey(token, cameraIdOverride, getOrCreateClientId())
                : await playbackTokenService.activateToken(token, cameraIdOverride, getOrCreateClientId());
            if (!response?.success) {
                setTokenMessage(response?.message || 'Token tidak valid');
                return false;
            }

            const tokenData = response.data || null;
            setTokenStatus(tokenData);
            setTokenInput('');
            setTokenMessage('Token playback aktif');
            onActivated?.(tokenData);
            return true;
        } catch (error) {
            setTokenMessage(error?.response?.data?.message || 'Token tidak valid atau sudah kedaluwarsa');
            return false;
        } finally {
            setIsTokenBusy(false);
        }
    }, [enabled, onActivated]);

    const clearToken = useCallback(async () => {
        if (!enabled) {
            return;
        }

        setIsTokenBusy(true);
        try {
            await playbackTokenService.clearToken();
            setTokenStatus(null);
            setTokenMessage('Token playback dibersihkan');

            /*
             * The credential has to leave the URL as well, or signing out does not survive a reload.
             * The share key is deliberately kept in the address bar so a link stays self-sufficient —
             * which means that on the next load it would activate again, undoing the sign-out the
             * visitor just asked for. Dropping the param here is what makes "Keluar" mean it.
             *
             * activatedCredentialRef is left as-is on purpose: it still names the credential handled
             * in this mount, so nothing re-fires before the strip lands.
             */
            setSearchParams?.((previous) => {
                const next = new URLSearchParams(previous);
                next.delete('share');
                next.delete('token');
                return next;
            }, { replace: true });

            onCleared?.();
        } catch (error) {
            setTokenMessage(error?.response?.data?.message || 'Gagal membersihkan token');
        } finally {
            setIsTokenBusy(false);
        }
    }, [enabled, onCleared, setSearchParams]);

    useEffect(() => {
        if (!enabled) {
            return;
        }

        const urlToken = searchParams.get('token');
        const urlShareKey = searchParams.get('share');
        const accessValue = urlShareKey || urlToken;
        if (!accessValue || activatedCredentialRef.current === accessValue) {
            return;
        }
        activatedCredentialRef.current = accessValue;

        /*
         * Deliberately WITHOUT a camera.
         *
         * A share link grants the token's whole set of cameras; it is not a claim about the camera
         * that happens to be selected when the page loads. Passing one made the backend check scope
         * against it (validateRawTokenForCamera throws "tidak mencakup kamera ini" for cameraId > 0),
         * so an area-scoped link opened on a camera outside that area was rejected outright — the
         * visitor fell back to the 10-minute public preview holding a perfectly valid link.
         *
         * Worse, this effect depended on `cameraId`: it re-ran once the camera list loaded, so the
         * second attempt's failure overwrote the first attempt's success in the UI. That is the
         * paired activated_share + activation_failed at the same second in the audit log.
         *
         * Nothing is loosened by dropping it — every segment and stream request re-checks the
         * camera against the token independently.
         */
        activateToken(accessValue, { silent: true, mode: urlShareKey ? 'share' : 'token' });
    }, [activateToken, enabled, searchParams]);

    /*
     * Ask the cookie who it is, once per mount.
     *
     * tokenStatus was only ever filled by an activation performed on THIS page load. A visitor
     * arriving without a key in the URL — the landing page, a second visit, any internal navigation
     * — therefore held a perfectly valid token the UI knew nothing about: no label, no coverage, no
     * expiry, and the "Coba gratis" pitch shown to someone who had already paid. The heartbeat
     * endpoint already returns the whole token for whatever cookie the request carries.
     *
     * A failure here means no cookie, or a dead one. That is an anonymous visitor, not an error, so
     * it stays silent. The functional update refuses to overwrite a live activation that raced us.
     */
    useEffect(() => {
        if (!enabled || hydratedRef.current) {
            return undefined;
        }
        hydratedRef.current = true;

        let isActive = true;
        (async () => {
            try {
                const response = await playbackTokenService.heartbeatToken();
                if (isActive && response?.success && response.data) {
                    setTokenStatus((current) => current || response.data);
                }
            } catch {
                // No cookie, or a dead one. Nothing to say and nobody to say it to.
            }
        })();

        return () => {
            isActive = false;
        };
    }, [enabled]);

    useEffect(() => {
        if (!enabled || !tokenStatus) {
            return undefined;
        }

        let isActive = true;
        const clear = (message) => {
            setTokenStatus(null);
            setTokenMessage(message || 'Session token playback berakhir');
            onCleared?.();
        };

        const heartbeat = async () => {
            try {
                const response = await playbackTokenService.heartbeatToken(cameraId);
                if (!isActive) {
                    return;
                }
                // The cookie can also disappear outright (cleared, or expired past its
                // Max-Age), which the backend answers 200 + `data: null` rather than 401.
                // That is still "your session is over" and must clear the UI the same way.
                if (!response?.data) {
                    clear();
                }
            } catch (error) {
                if (!isActive) {
                    return;
                }

                clear(error?.response?.data?.message);
            }
        };

        const intervalId = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
        return () => {
            isActive = false;
            window.clearInterval(intervalId);
        };
    }, [cameraId, enabled, onCleared, tokenStatus]);

    return {
        tokenInput,
        setTokenInput,
        tokenStatus,
        allowedCameraIds: tokenStatus?.allowed_camera_ids || null,
        cameraRules: tokenStatus?.camera_rules || [],
        defaultCameraId: tokenStatus?.default_camera_id || null,
        tokenMessage,
        isTokenBusy,
        activateToken,
        clearToken,
    };
}
