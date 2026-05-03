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
