/*
 * Purpose: Pin how a reported wall-clock moment becomes a playback link.
 * Caller: Vitest frontend suite.
 * Deps: playbackUrlState.
 * SideEffects: None.
 *
 * The parsing is the whole risk here. `occurredAt` is what someone typed into a phone's
 * datetime-local field: a clock reading with no timezone. Getting that wrong moves an incident by
 * hours and sends the operator to the wrong footage.
 */

import { describe, expect, it } from 'vitest';
import { buildPlaybackMomentPath } from './playbackUrlState';

describe('buildPlaybackMomentPath', () => {
    it('points at the camera and the moment, in epoch milliseconds', () => {
        const path = buildPlaybackMomentPath({ camera: 16, occurredAt: '2026-08-02T14:30' });

        const params = new URLSearchParams(path.split('?')[1]);
        expect(path.startsWith('/playback?')).toBe(true);
        expect(params.get('cam')).toBe('16');
        // Read as a wall clock in the reader's own zone — the reporter meant the clock beside them.
        expect(Number(params.get('t'))).toBe(new Date('2026-08-02T14:30').getTime());
    });

    it('can aim at admin playback so staff land with full reach', () => {
        const path = buildPlaybackMomentPath({
            camera: 16, occurredAt: '2026-08-02T14:30', basePath: '/admin/playback',
        });

        expect(path.startsWith('/admin/playback?')).toBe(true);
    });

    /* A link that cannot place the moment is worse than no link — it lands somewhere arbitrary. */
    it('returns nothing when the moment cannot be placed on a clock', () => {
        expect(buildPlaybackMomentPath({ camera: 16, occurredAt: 'kemarin sore' })).toBeNull();
        expect(buildPlaybackMomentPath({ camera: 16, occurredAt: null })).toBeNull();
        expect(buildPlaybackMomentPath({ camera: null, occurredAt: '2026-08-02T14:30' })).toBeNull();
    });
});
