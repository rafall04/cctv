// @vitest-environment jsdom

/**
 * Purpose: Verifies playback usage guide copy for public and admin playback scopes.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library and PlaybackUsageGuide.
 * MainFuncs: PlaybackUsageGuide render states.
 * SideEffects: None; renders into jsdom only.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PlaybackUsageGuide from './PlaybackUsageGuide';

describe('PlaybackUsageGuide', () => {
    it('shows public preview limit when public playback policy provides minutes', () => {
        render(
            <PlaybackUsageGuide
                isAdminPlayback={false}
                playbackPolicy={{ previewMinutes: 5 }}
            />
        );

        expect(screen.getByText('Cara Menggunakan Playback')).toBeTruthy();
        expect(screen.getByText(/Skip Video:/)).toBeTruthy();
        expect(screen.getByText(/Preview Publik:/)).toBeTruthy();
        expect(screen.getByText(/Hanya 5 menit awal/)).toBeTruthy();
    });

    it('hides public preview limit for admin playback', () => {
        render(
            <PlaybackUsageGuide
                isAdminPlayback
                playbackPolicy={{ previewMinutes: 5 }}
            />
        );

        expect(screen.queryByText(/Preview Publik:/)).toBeNull();
    });
});

/*
 * The responsible-use warning no longer lives here — it moved directly under the player, where it
 * is actually read. See PlaybackResponsibleUseNotice.test.jsx.
 */
describe('PlaybackUsageGuide responsible use', () => {
    it('leaves the warning to the notice under the player instead of repeating it', () => {
        render(<PlaybackUsageGuide isAdminPlayback={false} playbackPolicy={null} />);

        expect(screen.queryByText('Gunakan dengan bijak')).toBeNull();
        expect(screen.queryByText(/Jangan disebarkan ulang/)).toBeNull();
    });
});

/*
 * "Pilih segment di bawah" was accurate until the segment list moved ABOVE this guide. Left alone it
 * would have pointed viewers at the bottom of the page — which is now the guide itself.
 */
describe('PlaybackUsageGuide segment directions', () => {
    it('points at the controls where they actually are now', () => {
        render(<PlaybackUsageGuide isAdminPlayback={false} playbackPolicy={null} />);

        expect(screen.getByText(/Sebelumnya\/Berikutnya di bawah video/)).toBeTruthy();
        expect(screen.queryByText(/Pilih segment di bawah untuk/)).toBeNull();
    });
});
