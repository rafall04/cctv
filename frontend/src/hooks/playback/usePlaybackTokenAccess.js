/*
 * Purpose: Coordinate public playback token/share-key activation from URL/manual input and cleanup.
 * Caller: Playback page.
 * Deps: React hooks and playbackTokenService.
 * MainFuncs: usePlaybackTokenAccess.
 * SideEffects: Activates HttpOnly playback token cookie and rewrites URL token parameter.
 */

import { useCallback, useEffect, useState } from 'react';
import playbackTokenService from '../../services/playbackTokenService.js';

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
                ? await playbackTokenService.activateShareKey(token, cameraId)
                : await playbackTokenService.activateToken(token, cameraId);
            if (!response?.success) {
                setTokenMessage(response?.message || 'Token tidak valid');
                return false;
            }

            setTokenStatus(response.data || null);
            setTokenInput('');
            setTokenMessage('Token playback aktif');
            onActivated?.();
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

    return {
        tokenInput,
        setTokenInput,
        tokenStatus,
        tokenMessage,
        isTokenBusy,
        activateToken,
        clearToken,
    };
}
