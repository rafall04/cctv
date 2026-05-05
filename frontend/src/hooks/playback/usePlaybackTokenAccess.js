/*
 * Purpose: Coordinate public playback token activation from URL/manual input and cleanup.
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

    const activateToken = useCallback(async (rawToken, { silent = false } = {}) => {
        const token = String(rawToken || '').trim();
        if (!enabled || !token) {
            return false;
        }

        setIsTokenBusy(true);
        setTokenMessage(silent ? '' : 'Mengaktifkan token...');
        try {
            const response = await playbackTokenService.activateToken(token, cameraId);
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
        if (!urlToken) {
            return;
        }

        activateToken(urlToken, { silent: true }).then(() => {
            setSearchParams((current) => {
                const next = new URLSearchParams(current);
                next.delete('token');
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
