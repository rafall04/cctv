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
            onCleared?.();
        } catch (error) {
            setTokenMessage(error?.response?.data?.message || 'Gagal membersihkan token');
        } finally {
            setIsTokenBusy(false);
        }
    }, [enabled, onCleared]);

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

    useEffect(() => {
        if (!enabled || !tokenStatus) {
            return undefined;
        }

        let isActive = true;
        const heartbeat = async () => {
            try {
                await playbackTokenService.heartbeatToken(cameraId);
            } catch (error) {
                if (!isActive) {
                    return;
                }

                setTokenStatus(null);
                setTokenMessage(error?.response?.data?.message || 'Session token playback berakhir');
                onCleared?.();
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
