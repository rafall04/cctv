import { describe, expect, it } from 'vitest';
import {
    buildPublicCameraShareUrl,
    getPublicLayoutMode,
} from './publicShareUrl';

describe('publicShareUrl', () => {
    it('preserves simple grid mode for live share links', () => {
        const url = buildPublicCameraShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=simple&view=grid'),
            camera: '1-lobby',
        });

        expect(url).toBe('https://cctv.example.com/?mode=simple&view=grid&camera=1-lobby');
    });

    it('preserves simple map mode for live share links', () => {
        const url = buildPublicCameraShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=simple&view=map'),
            camera: '1-lobby',
        });

        expect(url).toBe('https://cctv.example.com/?mode=simple&view=map&camera=1-lobby');
    });

    it('preserves full map mode for live share links', () => {
        const url = buildPublicCameraShareUrl({
            origin: 'https://cctv.example.com',
            searchParams: new URLSearchParams('mode=full&view=map'),
            camera: '1-lobby',
        });

        expect(url).toBe('https://cctv.example.com/?mode=full&view=map&camera=1-lobby');
    });

    it('falls back to full layout when the current mode is invalid', () => {
        expect(getPublicLayoutMode(new URLSearchParams('mode=playback'))).toBe('full');
    });
});
