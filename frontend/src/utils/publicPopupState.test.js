import { describe, expect, it } from 'vitest';
import {
    getPublicPopupErrorType,
    getPublicPopupInitialStatus,
    getPublicPopupOverlayState,
    getPublicPopupStatusDisplay,
    isPublicPopupPlaybackLocked,
    shouldShowPublicPopupRetry,
} from './publicPopupState.js';

describe('publicPopupState', () => {
    it('menghitung status awal dari kamera non-playable', () => {
        expect(getPublicPopupInitialStatus({ status: 'maintenance', is_online: 1 })).toBe('maintenance');
        expect(getPublicPopupInitialStatus({ status: 'active', is_online: 0 })).toBe('offline');
        expect(getPublicPopupInitialStatus({ status: 'active', is_online: 1 })).toBe('connecting');
    });

    it('mengklasifikasikan error HLS publik dengan konsisten', () => {
        expect(getPublicPopupErrorType({
            hlsError: { type: 'networkError', details: 'manifestLoadError' },
            streamSource: 'external',
        })).toBe('cors');

        expect(getPublicPopupErrorType({
            hlsError: { type: 'mediaError', details: 'manifestIncompatibleCodecsError' },
            streamSource: 'mediamtx',
        })).toBe('codec');

        expect(getPublicPopupErrorType({
            hlsError: { type: 'networkError', details: 'manifestLoadError' },
            streamSource: 'mediamtx',
        })).toBe('network');

        expect(getPublicPopupErrorType({
            hlsError: { type: 'mediaError', details: 'bufferStalledError' },
            streamSource: 'mediamtx',
        })).toBe('media');
    });

    it('menghasilkan overlay dan retry rules yang sesuai untuk state non-live', () => {
        const timeoutState = getPublicPopupOverlayState({ status: 'timeout', loadingStage: 'timeout', errorType: 'timeout' });
        expect(timeoutState.title).toBe('Loading Timeout');
        expect(timeoutState.canRetry).toBe(true);
        expect(shouldShowPublicPopupRetry({ status: 'timeout', errorType: 'timeout' })).toBe(true);

        const corsState = getPublicPopupOverlayState({ status: 'error', loadingStage: 'error', errorType: 'cors' });
        expect(corsState.title).toBe('Stream Eksternal Diblokir');
        expect(corsState.canRetry).toBe(false);
        expect(shouldShowPublicPopupRetry({ status: 'error', errorType: 'cors' })).toBe(false);
        expect(isPublicPopupPlaybackLocked('error')).toBe(true);
    });

    it('menghasilkan badge status yang sama untuk live dan maintenance', () => {
        expect(getPublicPopupStatusDisplay({
            status: 'live',
            loadingStage: 'playing',
            isTunnel: false,
        }).label).toBe('LIVE');

        expect(getPublicPopupStatusDisplay({
            status: 'maintenance',
            loadingStage: 'error',
            isTunnel: false,
        }).label).toBe('PERBAIKAN');
    });
});
