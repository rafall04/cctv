/*
 * Purpose: Coordinate public playback token/share-key activation from URL/manual input and cleanup.
 * Caller: Playback page.
 * Deps: React hooks and playbackTokenService.
 * MainFuncs: usePlaybackTokenAccess.
 * SideEffects: Activates HttpOnly playback token/session cookies, sends session heartbeat, and rewrites URL token parameter.
 */

import { useCallback, useEffect, useState } from 'react';
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

    const activateToken = useCallback(async (rawToken, { silent = false, mode = 'token' } = {}) => {
        const token = String(rawToken || '').trim();
        if (!enabled || !token) {
            return false;
        }

        setIsTokenBusy(true);
        setTokenMessage(silent ? '' : 'Mengaktifkan token...');
        try {
            const response = mode === 'share'
                ? await playbackTokenService.activateShareKey(token, cameraId, getOrCreateClientId())
                : await playbackTokenService.activateToken(token, cameraId, getOrCreateClientId());
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
    }, [cameraId, enabled, onActivated]);

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
        if (!accessValue) {
            return;
        }

        activateToken(accessValue, { silent: true, mode: urlShareKey ? 'share' : 'token' }).then(() => {
            setSearchParams((current) => {
                const next = new URLSearchParams(current);
                next.delete('token');
                next.delete('share');
                return next;
            }, { replace: true });
        });
    }, [activateToken, enabled, searchParams, setSearchParams]);

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
