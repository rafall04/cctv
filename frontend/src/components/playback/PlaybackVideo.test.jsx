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
 * The speed control once floated over the video, both a thumb target and something covering the
 * picture — it ran at 24px high, well under the 40px touch floor in docs/frontend-guide.md. It
 * now sits in the external bar below the frame: ONE cycling button, same reach, and the picture
 * keeps its corners.
 */
describe('PlaybackVideo speed control on a phone', () => {
    const playingSegment = { id: 1, filename: 'a.mp4' };

    it('is a single control that meets the touch-target floor', () => {
        render(<PlaybackVideo {...baseProps} selectedSegment={playingSegment} />);

        const speedButtons = screen.getAllByTitle(/^Kecepatan /);
        expect(speedButtons).toHaveLength(1);
        const cls = speedButtons[0].getAttribute('class');
        expect(cls).toContain('h-10');
        expect(cls).toContain('sm:h-8');
        expect(cls).toContain('px-2');
    });

    it('shows the current speed and cycles to the next one when tapped', () => {
        const onSpeedChange = vi.fn();
        const { rerender } = render(
            <PlaybackVideo {...baseProps} selectedSegment={playingSegment} playbackSpeed={1} onSpeedChange={onSpeedChange} />,
        );

        expect(screen.getByTitle(/^Kecepatan /).textContent).toBe('1x');
        fireEvent.click(screen.getByTitle(/^Kecepatan /));
        expect(onSpeedChange).toHaveBeenLastCalledWith(1.5);

        // …and wraps around from the last step back to normal speed, so every value stays reachable.
        rerender(<PlaybackVideo {...baseProps} selectedSegment={playingSegment} playbackSpeed={0.5} onSpeedChange={onSpeedChange} />);
        fireEvent.click(screen.getByTitle(/^Kecepatan /));
        expect(onSpeedChange).toHaveBeenLastCalledWith(1);
    });

    /*
     * Fullscreen regression: the floating speed button rendered UNDER the z-50 header bar —
     * same corner as the close button, and the bar's pointer-events-auto swallowed every
     * click. In fullscreen the control must live INSIDE the header, next to the camera name.
     */
    it('moves into the fullscreen header bar instead of floating under it', () => {
        render(
            <PlaybackVideo
                {...baseProps}
                isFullscreen
                selectedSegment={{ id: 1, filename: 'a.mp4' }}
            />
        );

        const speedButtons = screen.getAllByTitle(/^Kecepatan /);
        expect(speedButtons).toHaveLength(1);
        // Header membership: its flex group is the one carrying the camera name.
        expect(speedButtons[0].parentElement.textContent).toContain('Lobby');
    });
});

/*
 * Production bug, caught live: the page passes `videoRef={attachVideo}` — a FUNCTION ref —
 * and every internal read of `videoRef.current` (mute preference, audio probing, snapshot
 * disabled-state) silently saw undefined. The component now holds its own element ref and
 * forwards the node to whatever shape the parent sent. This test is the regression guard:
 * if someone reverts to reading videoRef.current, it fails immediately.
 */
describe('PlaybackVideo ref forwarding', () => {
    const playingSegment = { id: 1, filename: 'a.mp4' };

    it('accepts a CALLBACK ref (the shape the page actually sends) and still wires the element', () => {
        let received = null;
        render(
            <PlaybackVideo
                {...baseProps}
                videoRef={(node) => { received = node; }}
                selectedSegment={playingSegment}
            />
        );

        expect(received).not.toBeNull();
        expect(received.tagName).toBe('VIDEO');
        // The mute default must land on the element — before the fix this read
        // videoRef.current (undefined for a function ref) and silently did nothing.
        expect(received.muted).toBe(true);
    });

    it('still accepts an object ref for callers that use one', () => {
        const videoRef = { current: null };
        render(<PlaybackVideo {...baseProps} videoRef={videoRef} selectedSegment={playingSegment} />);
        expect(videoRef.current?.tagName).toBe('VIDEO');
    });
});

/*
 * The playback page had NO zoom at all, while MultiView already shipped pinch/pan. The zoom
 * pill must exist wherever a segment plays — and must NOT appear over the empty state, where
 * zooming a "no recording" message is meaningless.
 */
describe('PlaybackVideo zoom pill', () => {
    const playingSegment = { id: 1, filename: 'a.mp4' };

    it('renders the zoom control once a segment is playing', () => {
        render(<PlaybackVideo {...baseProps} selectedSegment={playingSegment} />);

        const pill = screen.getByTestId('playback-zoom');
        expect(pill).toBeTruthy();
        expect(screen.getByTitle('Perbesar')).toBeTruthy();
        expect(screen.getByTitle('Perkecil')).toBeTruthy();
    });

    it('stays hidden over the empty state — nothing to zoom', () => {
        render(<PlaybackVideo {...baseProps} />);

        expect(screen.queryByTestId('playback-zoom')).toBeNull();
    });

    it('zooming in updates the readout and hides native controls for gesture ownership', () => {
        const { container } = render(
            <PlaybackVideo {...baseProps} selectedSegment={playingSegment} />
        );

        fireEvent.click(screen.getByTitle('Perbesar'));

        expect(screen.getByTestId('playback-zoom').textContent).toContain('1.5x');
        // controls={!isZoomed} — once zoomed the stage owns every gesture, and a native
        // bar that scales with the frame is worse than none.
        expect(container.querySelector('video').hasAttribute('controls')).toBe(false);
    });

    /*
     * The live popup offers an explicit ⟲ reset once zoomed; playback originally hid reset
     * INSIDE the % label — invisible until you already knew it. The dedicated button must
     * appear exactly while zoomed and return the picture to 1x, matching the popup.
     */
    it('offers an explicit reset only while zoomed, and reset returns to 1x', () => {
        render(<PlaybackVideo {...baseProps} selectedSegment={playingSegment} />);

        expect(screen.queryByTitle('Reset Zoom')).toBeNull();

        fireEvent.click(screen.getByTitle('Perbesar'));
        expect(screen.getByTestId('playback-zoom').textContent).toContain('1.5x');

        fireEvent.click(screen.getByTitle('Reset Zoom'));
        expect(screen.getByTestId('playback-zoom').textContent).toContain('1.0x');
        expect(screen.queryByTitle('Reset Zoom')).toBeNull();
    });
});

/*
 * Operator feedback: controls floating over the picture looked cluttered — zoom pill bottom-left,
 * snapshot/fullscreen rail bottom-right, speed pill top-right, all fighting the camera's own
 * burned-in timestamp. They now live in ONE bar BELOW the video frame (the live popup's pattern);
 * only fullscreen keeps overlay chrome, because an outside bar can't reach inside the
 * fullscreen element. This test guards the boundary: every control stays OFF the picture.
 */
describe('PlaybackVideo external control bar', () => {
    const playingSegment = { id: 1, filename: 'a.mp4' };

    it('keeps zoom, speed, snapshot, and fullscreen OFF the picture', () => {
        const { container } = render(
            <PlaybackVideo {...baseProps} selectedSegment={playingSegment} />
        );

        const bar = screen.getByTestId('playback-controls');
        const frame = container.querySelector('.aspect-video');
        expect(frame.contains(bar)).toBe(false);
        for (const title of ['Perbesar', 'Perkecil', /^Kecepatan /, 'Ambil Snapshot & Share', 'Fullscreen']) {
            const control = screen.getByTitle(title);
            expect(bar.contains(control)).toBe(true);
            expect(frame.contains(control)).toBe(false);
        }
    });

    it('does not render the bar over the empty state — nothing to control', () => {
        render(<PlaybackVideo {...baseProps} />);
        expect(screen.queryByTestId('playback-controls')).toBeNull();
    });

    it('keeps overlay chrome in fullscreen, where an outside bar cannot reach', () => {
        render(<PlaybackVideo {...baseProps} isFullscreen selectedSegment={playingSegment} />);

        expect(screen.queryByTestId('playback-controls')).toBeNull();
        expect(screen.getByTestId('playback-zoom-fullscreen')).toBeTruthy();
    });

    /*
     * Fullscreen mirrors the live popup: ONE minimal pill at the bottom-right corner holds
     * zoom AND snapshot together — not two separate floating rails on opposite corners.
     */
    it('groups zoom and snapshot into one bottom-right pill in fullscreen', () => {
        render(<PlaybackVideo {...baseProps} isFullscreen selectedSegment={playingSegment} />);

        const pill = screen.getByTestId('playback-zoom-fullscreen');
        expect(pill.className).toContain('right-4');
        for (const title of ['Perkecil', 'Perbesar', 'Ambil Snapshot & Share']) {
            expect(pill.contains(screen.getByTitle(title))).toBe(true);
        }
    });

    /*
     * The native <video controls> fullscreen button sends the VIDEO element to fullscreen —
     * our chrome is a sibling, never a descendant, so the whole fullscreen UI vanished
     * (operator report: no zoom in fullscreen). The component steals the fullscreen element
     * back to the container, where the chrome lives; the request rejects harmlessly on
     * platforms that can only fullscreen video (iOS native player).
     */
    it('steals fullscreen back to the container when the VIDEO element itself went fullscreen', () => {
        const containerRef = { current: null };
        const videoRef = { current: null };
        render(
            <PlaybackVideo {...baseProps} videoRef={videoRef} containerRef={containerRef} selectedSegment={playingSegment} />
        );

        const request = vi.fn().mockResolvedValue(undefined);
        containerRef.current.requestFullscreen = request;

        // Browser draws it: fullscreen element = the <video>, not our container.
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => videoRef.current,
        });
        act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
        expect(request).toHaveBeenCalledTimes(1);

        // Once the container holds fullscreen, the steal must NOT fire again (no loop).
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => containerRef.current,
        });
        act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
        expect(request).toHaveBeenCalledTimes(1);

        delete document.fullscreenElement;
    });

    /*
     * Operator report: fullscreen entered from the toggle left a portrait-LOCKED phone
     * vertical — the 16:9 frame letterboxed tiny. Entering fullscreen (any path) must
     * lock landscape; leaving must hand the orientation back to the system setting.
     */
    it('locks landscape while fullscreen is held and unlocks on exit', () => {
        const lock = vi.fn().mockResolvedValue(undefined);
        const unlock = vi.fn();
        const containerRef = { current: null };
        render(
            <PlaybackVideo {...baseProps} containerRef={containerRef} selectedSegment={playingSegment} />
        );
        Object.defineProperty(window.screen, 'orientation', {
            configurable: true,
            value: { lock, unlock },
        });

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => containerRef.current,
        });
        act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
        expect(lock).toHaveBeenCalledWith('landscape');
        expect(unlock).not.toHaveBeenCalled();

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => null,
        });
        act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
        expect(unlock).toHaveBeenCalledTimes(1);

        delete document.fullscreenElement;
        delete window.screen.orientation;
    });

    /*
     * The unmute prompt sat at top-2 — in fullscreen that is INSIDE the z-50 header
     * bar, whose pointer-events-auto swallows every tap. Same class of bug that
     * trapped the old floating speed button. In FS it must drop below the header.
     */
    it('drops the unmute prompt below the fullscreen header instead of under it', () => {
        // Prompt renders only while muted — earlier describes may leave a remembered
        // unmuted choice in localStorage, which would hide it before we can check.
        localStorage.setItem('recording-audio-muted', '1');
        render(<PlaybackVideo {...baseProps} isFullscreen selectedSegment={playingSegment} />);
        expect(screen.getByTestId('playback-unmute').className).toContain('top-16');
        localStorage.clear();
    });
});
