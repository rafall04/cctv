// @vitest-environment jsdom

/*
 * Purpose: Prove the embedded playback panel does not add a second mobile dock.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * Found in production: the landing playback view carried TWO docks at the identical position, both
 * `fixed bottom-3 z-dock`. LandingPage renders one built from buttons (SPA view switching) and
 * Playback rendered its own built from links. The buttons won the taps by DOM order, so nothing
 * looked broken — but five dead links sat underneath, and a screen reader announced the whole
 * navigation twice.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPlaybackPanel from './LandingPlaybackPanel';

/** Stands in for the real page: reports back what it was told about the dock. */
const PlaybackStub = vi.fn(({ showMobileDock }) => (
    <div data-testid="playback">{String(showMobileDock)}</div>
));

describe('LandingPlaybackPanel', () => {
    it('tells Playback to leave the dock to the landing page', () => {
        render(<LandingPlaybackPanel Playback={PlaybackStub} cameras={[]} selectedCamera={null} />);

        expect(screen.getByTestId('playback').textContent).toBe('false');
    });

    it('still forwards the cameras and scope it was given', () => {
        const cameras = [{ id: 1, name: 'Lobby' }];
        render(
            <LandingPlaybackPanel
                Playback={PlaybackStub}
                cameras={cameras}
                selectedCamera={cameras[0]}
                accessScope="public_preview"
            />,
        );

        expect(PlaybackStub.mock.calls.at(-1)[0]).toMatchObject({
            cameras,
            selectedCamera: cameras[0],
            accessScope: 'public_preview',
        });
    });
});
