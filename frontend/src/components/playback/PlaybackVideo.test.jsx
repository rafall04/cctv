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

/*
 * Reported from a phone: opening a link showed "Belum ada rekaman" while the segment list was still
 * being fetched. To the visitor that is indistinguishable from a page that has hung — they cannot
 * tell whether to wait or to give up. A verdict must not be announced before it is known.
 */
describe('PlaybackVideo waiting state', () => {
    it('says it is working while segments are still being fetched', () => {
        render(<PlaybackVideo {...baseProps} isLoadingSegments />);

        expect(screen.getByTestId('playback-loading-state')).toBeTruthy();
        expect(screen.getByText('Memuat rekaman...')).toBeTruthy();
        expect(screen.queryByText('Belum ada rekaman')).toBeNull();
    });

    it('delivers the verdict only once the fetch is done', () => {
        render(<PlaybackVideo {...baseProps} isLoadingSegments={false} />);

        expect(screen.getByText('Belum ada rekaman')).toBeTruthy();
        expect(screen.queryByText('Memuat rekaman...')).toBeNull();
    });

    it('shows neither once a segment is playing', () => {
        render(<PlaybackVideo {...baseProps} selectedSegment={{ id: 1, filename: 'a.mp4' }} isLoadingSegments />);

        expect(screen.queryByTestId('playback-loading-state')).toBeNull();
        expect(screen.queryByTestId('playback-empty-state')).toBeNull();
    });
});
