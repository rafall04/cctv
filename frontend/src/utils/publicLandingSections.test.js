/*
 * Purpose: Verify public landing discovery section shaping, especially the honesty filter on "Sedang Ramai".
 * Caller: Frontend focused public landing test gate.
 * Deps: Vitest and publicLandingSections utilities.
 * MainFuncs: buildLandingDiscoverySections tests.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { buildLandingDiscoverySections } from './publicLandingSections';

describe('buildLandingDiscoverySections', () => {
    it('keeps only genuinely busy cameras under "Sedang Ramai"', () => {
        const sections = buildLandingDiscoverySections({
            live_now: [
                { id: 1, name: 'Ramai', live_viewers: 4 },
                { id: 2, name: 'Sepi', live_viewers: 0 },
                { id: 3, name: 'Tidak diketahui' },
            ],
        });

        const liveNow = sections.find((section) => section.key === 'live_now');
        expect(liveNow.items.map((camera) => camera.name)).toEqual(['Ramai']);
    });

    it('drops the "Sedang Ramai" tab entirely when nothing is actually busy', () => {
        // The backend list used to arrive full of zero-viewer cameras, which rendered a
        // "Sedang Ramai" heading above six cards each reading "0 penonton".
        const sections = buildLandingDiscoverySections({
            live_now: [
                { id: 1, name: 'Sepi', live_viewers: 0 },
                { id: 2, name: 'Sepi juga', live_viewers: 0 },
            ],
            top_cameras: [{ id: 3, name: 'Top', total_views: 90 }],
        });

        expect(sections.map((section) => section.key)).toEqual(['top_cameras']);
    });

    it('returns no sections when the discovery payload is empty', () => {
        expect(buildLandingDiscoverySections()).toEqual([]);
        expect(buildLandingDiscoverySections({})).toEqual([]);
    });
});
