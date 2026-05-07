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

    it('reads canonical playback params from cam and t', () => {
        const state = getPlaybackUrlState(new URLSearchParams('cam=1-lobby&t=1710000000000'));

        expect(state).toEqual({
            cameraParam: '1-lobby',
            timestampParam: '1710000000000',
            isLegacyRootPlayback: false,
        });
    });

    it('detects legacy root playback URLs using view=playback', () => {
        const state = getPlaybackUrlState(new URLSearchParams('mode=full&view=playback&cam=1-lobby&t=1710000000000'));

        expect(state).toEqual({
            cameraParam: '1-lobby',
            timestampParam: '1710000000000',
            isLegacyRootPlayback: true,
        });
    });

    it('detects legacy root playback URLs using mode=playback', () => {
        const state = getPlaybackUrlState(new URLSearchParams('mode=playback&cam=1-lobby&t=1710000000000'));

        expect(state).toEqual({
            cameraParam: '1-lobby',
            timestampParam: '1710000000000',
            isLegacyRootPlayback: true,
        });
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

    it('removes live and legacy playback-only params when building playback params', () => {
        const next = buildPlaybackSearchParams({
            currentParams: new URLSearchParams('camera=2-live&mode=full&view=playback&scope=admin_full&accessScope=admin_full'),
            camera: '1-lobby',
            timestamp: 1710000000000,
        });

        expect(next.toString()).toBe('cam=1-lobby&t=1710000000000');
    });
});
