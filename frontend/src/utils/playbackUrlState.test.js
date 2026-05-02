/*
 * Purpose: Validate playback URL search param parsing and updates.
 * Caller: Vitest frontend suite before changing Playback route URL behavior.
 * Deps: playbackUrlState utility.
 * MainFuncs: getPlaybackUrlState, buildPlaybackSearchParams.
 * SideEffects: None; pure URLSearchParams tests only.
 */
import { describe, expect, it } from 'vitest';
import {
    buildPlaybackSearchParams,
    getPlaybackUrlState,
} from './playbackUrlState.js';

describe('playbackUrlState', () => {
    it('reads playback camera and timestamp params without using live camera param', () => {
        const state = getPlaybackUrlState(new URLSearchParams('camera=99&cam=area-cam-7&t=1777716000000'));

        expect(state.cameraParam).toBe('area-cam-7');
        expect(state.timestampParam).toBe('1777716000000');
    });

    it('builds playback params with cam and t only for playback selection', () => {
        const params = buildPlaybackSearchParams({
            currentParams: new URLSearchParams('utm_source=share&camera=99'),
            camera: 'jalan-raya-7',
            timestamp: 1777716000000,
        });

        expect(params.get('cam')).toBe('jalan-raya-7');
        expect(params.get('t')).toBe('1777716000000');
        expect(params.has('camera')).toBe(false);
        expect(params.get('utm_source')).toBe('share');
    });

    it('removes timestamp when selecting a camera without a segment', () => {
        const params = buildPlaybackSearchParams({
            currentParams: new URLSearchParams('cam=old&t=1777716000000'),
            camera: 'new-camera',
            timestamp: null,
        });

        expect(params.get('cam')).toBe('new-camera');
        expect(params.has('t')).toBe(false);
    });

    it('does not serialize admin scope into public playback params', () => {
        const params = buildPlaybackSearchParams({
            currentParams: new URLSearchParams('scope=admin_full&cam=old'),
            camera: 'public-camera',
            timestamp: 1777716000000,
        });

        expect(params.get('cam')).toBe('public-camera');
        expect(params.get('t')).toBe('1777716000000');
        expect(params.has('scope')).toBe(false);
    });
});
