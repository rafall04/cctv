import { describe, expect, it } from 'vitest';
import {
    buildPublicCameraShareUrl,
    buildPublicPlaybackShareUrl,
    getPublicLayoutMode,
    getPublicLiveView,
} from './publicShareUrl';

describe('publicShareUrl', () => {
    it('builds canonical live camera links without layout params', () => {
        const url = buildPublicCameraShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=simple&view=grid'),
            camera: '1-lobby',
        });

        expect(url).toBe('https://cctv.example.com/?camera=1-lobby');
    });

    it('builds the public landing URL when no camera is selected', () => {
        const url = buildPublicCameraShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=full&view=map'),
            camera: null,
        });

        expect(url).toBe('https://cctv.example.com/');
    });

    it('builds canonical playback links on the playback route', () => {
        const url = buildPublicPlaybackShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=full&view=playback'),
            camera: '1-lobby',
            timestamp: 1710000000000,
        });

        expect(url).toBe('https://cctv.example.com/playback?cam=1-lobby&t=1710000000000');
    });

    it('omits empty playback params from the canonical playback route', () => {
        const url = buildPublicPlaybackShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=simple&view=playback'),
            camera: null,
            timestamp: null,
        });

        expect(url).toBe('https://cctv.example.com/playback');
    });

    it('keeps legacy layout parsing for URL compatibility', () => {
        expect(getPublicLayoutMode(new URLSearchParams('mode=simple'))).toBe('simple');
        expect(getPublicLayoutMode(new URLSearchParams('mode=playback'))).toBe('full');
    });

    it('keeps legacy live view parsing for URL compatibility', () => {
        expect(getPublicLiveView(new URLSearchParams('view=grid'))).toBe('grid');
        expect(getPublicLiveView(new URLSearchParams('view=playback'))).toBe('map');
    });
});
