// @vitest-environment jsdom

/**
 * Purpose: Verifies playback video empty/error presentation without blocking page controls.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library and PlaybackVideo.
 * MainFuncs: PlaybackVideo render states.
 * SideEffects: None; renders into jsdom only.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackVideo from './PlaybackVideo';

vi.mock('../CodecBadge', () => ({
    default: ({ codec }) => <span>{codec}</span>,
}));

const baseProps = {
    videoRef: { current: null },
    containerRef: { current: null },
    selectedCamera: { id: 1, name: 'Lobby' },
    selectedSegment: null,
    playbackSpeed: 1,
    onSpeedChange: vi.fn(),
    onSnapshot: vi.fn(),
    onToggleFullscreen: vi.fn(),
    isFullscreen: false,
    isBuffering: false,
    isSeeking: false,
    videoError: null,
    errorType: null,
    currentTime: 0,
    duration: 0,
    autoPlayNotification: null,
    onAutoPlayNotificationClose: vi.fn(),
    seekWarning: null,
    onSeekWarningClose: vi.fn(),
    snapshotNotification: null,
    formatTimestamp: (value) => value,
};

describe('PlaybackVideo', () => {
    it('shows a compact empty recording state inside the video panel', () => {
        render(<PlaybackVideo {...baseProps} />);

        expect(screen.getByText('Belum ada rekaman')).toBeTruthy();
        expect(screen.getByText('Pilih kamera lain atau coba lagi nanti.')).toBeTruthy();
        expect(screen.getByTestId('playback-empty-state').className).toContain('pointer-events-none');
    });
});
