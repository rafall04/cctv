// @vitest-environment jsdom

/**
 * Purpose: Verifies playback video empty/error presentation without blocking page controls.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library and PlaybackVideo.
 * MainFuncs: PlaybackVideo render states.
 * SideEffects: None; renders into jsdom only.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/*
 * Recordings used to have no audio track at all, and this player hardcoded `muted` to make
 * autoplay work. The recorder now maps the camera microphone, so a literal would mean we
 * record sound that no viewer can ever reach. Muted stays the DEFAULT — the autoplay policy
 * demands it and this player advances segments on its own — but it has to be the viewer's
 * to change, and the change has to survive the next segment.
 */
describe('PlaybackVideo audio', () => {
    const playingSegment = { id: 1, filename: 'a.mp4' };
    const renderPlaying = (overrides = {}) => {
        const videoRef = { current: null };
        const view = render(
            <PlaybackVideo {...baseProps} videoRef={videoRef} selectedSegment={playingSegment} {...overrides} />
        );
        return { videoRef, ...view };
    };

    beforeEach(() => {
        localStorage.clear();
    });

    it('starts muted and offers a way out', () => {
        const { videoRef } = renderPlaying();

        expect(videoRef.current.muted).toBe(true);
        expect(screen.getByTestId('playback-unmute')).toBeTruthy();
    });

    it('unmutes the element on tap, drops the prompt, and remembers the choice', () => {
        const { videoRef } = renderPlaying();

        fireEvent.click(screen.getByTestId('playback-unmute'));

        expect(videoRef.current.muted).toBe(false);
        expect(screen.queryByTestId('playback-unmute')).toBeNull();
        // Remembered, so the next segment does not silently re-mute the viewer.
        expect(localStorage.getItem('recording-audio-muted')).toBe('0');
    });

    it('honours a remembered unmuted preference on a fresh mount', () => {
        localStorage.setItem('recording-audio-muted', '0');

        const { videoRef } = renderPlaying();

        expect(videoRef.current.muted).toBe(false);
        expect(screen.queryByTestId('playback-unmute')).toBeNull();
    });

    it('follows the NATIVE mute control instead of fighting it', async () => {
        const { videoRef } = renderPlaying();

        // What the browser's own volume button does: change the element, tell nobody.
        // Assigning `muted` makes jsdom queue its OWN volumechange asynchronously, so the
        // await is what lets that second event land inside act instead of after the test.
        await act(async () => {
            videoRef.current.muted = false;
            fireEvent.volumeChange(videoRef.current);
        });

        expect(screen.queryByTestId('playback-unmute')).toBeNull();
        expect(localStorage.getItem('recording-audio-muted')).toBe('0');
    });

    it('stays quiet when there is nothing playing or the video failed', () => {
        render(<PlaybackVideo {...baseProps} videoRef={{ current: null }} selectedSegment={null} />);
        expect(screen.queryByTestId('playback-unmute')).toBeNull();

        render(
            <PlaybackVideo
                {...baseProps}
                videoRef={{ current: null }}
                selectedSegment={playingSegment}
                videoError="boom"
            />
        );
        expect(screen.queryByTestId('playback-unmute')).toBeNull();
    });
});

/*
 * Three of the twelve recording cameras genuinely have no microphone. Where the browser can
 * say so, do not advertise sound that does not exist — but only where it can SAY so. An
 * inconclusive probe must keep the control, or Chrome (which reports nothing useful about a
 * muted element) would hide it on every camera.
 */
describe('PlaybackVideo audio honesty', () => {
    const proto = window.HTMLMediaElement.prototype;

    // jsdom never loads media, so readyState stays at HAVE_NOTHING and mozHasAudio does not
    // exist. Both have to be planted to simulate an element that has actually parsed its
    // metadata — which is the only state in which "no audio" is a trustworthy answer.
    //
    // Restore by DESCRIPTOR, not by `delete`: readyState is a native jsdom accessor, and
    // deleting it leaves every later test in this file looking at an element with no
    // readyState at all — which silently flips the very behaviour being asserted.
    const original = {};
    const simulateLoaded = (hasAudio) => {
        for (const prop of ['readyState', 'mozHasAudio']) {
            if (!(prop in original)) {
                original[prop] = Object.getOwnPropertyDescriptor(proto, prop) ?? null;
            }
        }
        Object.defineProperty(proto, 'readyState', { configurable: true, value: 1 });
        Object.defineProperty(proto, 'mozHasAudio', { configurable: true, value: hasAudio });
    };

    afterEach(() => {
        for (const [prop, descriptor] of Object.entries(original)) {
            if (descriptor) {
                Object.defineProperty(proto, prop, descriptor);
            } else {
                delete proto[prop];
            }
        }
        localStorage.clear();
    });

    it('hides the prompt when a LOADED element positively reports no audio track', () => {
        simulateLoaded(false);

        render(
            <PlaybackVideo {...baseProps} videoRef={{ current: null }} selectedSegment={{ id: 1, filename: 'a.mp4' }} />
        );

        expect(screen.queryByTestId('playback-unmute')).toBeNull();
    });

    it('keeps the prompt when the browser reports an audio track', () => {
        simulateLoaded(true);

        render(
            <PlaybackVideo {...baseProps} videoRef={{ current: null }} selectedSegment={{ id: 1, filename: 'a.mp4' }} />
        );

        expect(screen.getByTestId('playback-unmute')).toBeTruthy();
    });

    /*
     * The default jsdom element: nothing loaded, no vendor property, empty track list. That is
     * exactly what Chrome looks like on a muted player, and it must keep the control.
     */
    it('keeps the prompt when the browser cannot say either way', () => {
        render(
            <PlaybackVideo {...baseProps} videoRef={{ current: null }} selectedSegment={{ id: 1, filename: 'a.mp4' }} />
        );

        expect(screen.getByTestId('playback-unmute')).toBeTruthy();
    });
});

/*
 * The speed row floats over the video, so it is both a thumb target and something covering the
 * picture. It ran at 24px high — well under the 40px touch floor in docs/frontend-guide.md.
 * The width must NOT grow with it: the unmute prompt owns the opposite corner and already caps
 * itself at 55% to avoid this row on a 360px phone.
 */
describe('PlaybackVideo speed controls on a phone', () => {
    it('meets the touch-target floor without widening past the unmute prompt', () => {
        render(<PlaybackVideo {...baseProps} />);

        const speedButtons = screen.getAllByTitle(/^Kecepatan /);
        expect(speedButtons).toHaveLength(4);
        for (const button of speedButtons) {
            const cls = button.getAttribute('class');
            expect(cls).toContain('min-h-11');
            expect(cls).toContain('sm:min-h-0');
            expect(cls).toContain('px-2');
        }
    });
});
