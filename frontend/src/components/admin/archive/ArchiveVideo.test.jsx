// @vitest-environment jsdom

/*
 * Purpose: Prove archived footage is shown at the shape it was recorded in, across a fleet that
 *          records at four different aspect ratios.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: Renders jsdom only; fullscreen APIs are stubbed.
 *
 * The bug this guards: a hardcoded `aspect-video` box threw away 31% of the width as black
 * pillarbox on the 704x576 cameras — on a phone, most of the picture.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ArchiveVideo from './ArchiveVideo';

/** The <video> element, which RTL cannot reach by role in jsdom. */
function videoEl(container) {
    return container.querySelector('video');
}

/** jsdom never decodes, so videoWidth/videoHeight have to be planted before firing the event. */
function emitMetadata(video, width, height) {
    Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
    fireEvent.loadedMetadata(video);
}

beforeEach(() => {
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenElement', { value: null, writable: true, configurable: true });
    Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
});

describe('ArchiveVideo aspect ratio', () => {
    it('reserves a box before metadata arrives so the dialog cannot jump', () => {
        const { container } = render(<ArchiveVideo src="/s/1" segmentId={1} />);

        // 16:9 is the widest shape in the fleet, so the box only ever shrinks to fit.
        expect(videoEl(container).parentElement.style.aspectRatio).toBe(String(16 / 9));
    });

    it.each([
        ['704x576 (kamera 16, 21, 22)', 704, 576],
        ['640x480 (kamera 17, 18, 20, 23)', 640, 480],
        ['1280x720 (kamera 15)', 1280, 720],
        ['1920x1080 (kamera 19)', 1920, 1080],
    ])('takes its ratio from the decoded stream: %s', (_label, width, height) => {
        const { container } = render(<ArchiveVideo src="/s/1" segmentId={1} />);
        const video = videoEl(container);

        emitMetadata(video, width, height);

        expect(video.parentElement.style.aspectRatio).toBe(String(width / height));
    });

    it('drops back to the reserve when a new segment opens, so no wrong-shaped flash carries over', () => {
        const { container, rerender } = render(<ArchiveVideo src="/s/1" segmentId={1} />);
        emitMetadata(videoEl(container), 704, 576);
        expect(videoEl(container).parentElement.style.aspectRatio).toBe(String(704 / 576));

        rerender(<ArchiveVideo src="/s/2" segmentId={2} />);

        expect(videoEl(container).parentElement.style.aspectRatio).toBe(String(16 / 9));
    });

    it('ignores a metadata event that reports no dimensions rather than collapsing the box', () => {
        const { container } = render(<ArchiveVideo src="/s/1" segmentId={1} />);
        const video = videoEl(container);

        emitMetadata(video, 0, 0);

        expect(video.parentElement.style.aspectRatio).toBe(String(16 / 9));
    });

    it('plays inline and does not stretch the footage', () => {
        const { container } = render(<ArchiveVideo src="/s/1" segmentId={1} />);
        const video = videoEl(container);

        expect(video.hasAttribute('playsinline')).toBe(true);
        expect(video.className).toContain('object-contain');
    });
});

/*
 * This element autoplays and, until recordings started carrying the camera microphone, it did
 * so UNMUTED — which browsers only permit while there is nothing to hear. Give it a real audio
 * track and the autoplay policy blocks it, once per segment, because `key={segmentId}` remounts
 * the element on every clip. Nothing in this suite would have caught that.
 */
describe('ArchiveVideo audio', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('autoplays muted by default, which is what keeps autoplay allowed', () => {
        const { container } = render(<ArchiveVideo src="/s/1" segmentId={1} />);
        const video = videoEl(container);

        expect(video.autoplay).toBe(true);
        expect(video.muted).toBe(true);
    });

    it('honours a remembered unmuted preference instead of re-muting every segment', () => {
        localStorage.setItem('recording-audio-muted', '0');

        const { container } = render(<ArchiveVideo src="/s/1" segmentId={1} />);

        expect(videoEl(container).muted).toBe(false);
    });

    it('remembers what the native mute control was told', async () => {
        const { container } = render(<ArchiveVideo src="/s/1" segmentId={1} />);
        const video = videoEl(container);

        // Assigning `muted` makes jsdom queue its own volumechange asynchronously; the await
        // lets that land inside act rather than after the test has finished.
        await act(async () => {
            video.muted = false;
            fireEvent.volumeChange(video);
        });

        expect(localStorage.getItem('recording-audio-muted')).toBe('0');
    });

    it('asks to play explicitly and survives a refusal instead of throwing', () => {
        const play = vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
        const { container } = render(<ArchiveVideo src="/s/1" segmentId={1} />);
        const video = videoEl(container);
        video.play = play;

        // An unhandled rejection here is the failure mode: a blocked autoplay must degrade to
        // a paused player with visible controls, not to a console error.
        expect(() => fireEvent.canPlay(video)).not.toThrow();
        expect(play).toHaveBeenCalled();
        expect(video.hasAttribute('controls')).toBe(true);
    });
});

describe('ArchiveVideo fullscreen', () => {
    it('requests fullscreen on the wrapper, so the footage fills the screen and not just the tag', async () => {
        const { container } = render(<ArchiveVideo src="/s/1" segmentId={1} />);

        fireEvent.click(screen.getByLabelText('Layar penuh'));

        expect(Element.prototype.requestFullscreen).toHaveBeenCalled();
        expect(videoEl(container).parentElement.tagName).toBe('DIV');
    });

    it('follows the DOM when fullscreen is left by Escape rather than the button', () => {
        const onFullscreenChange = vi.fn();
        const { container } = render(
            <ArchiveVideo src="/s/1" segmentId={1} onFullscreenChange={onFullscreenChange} />,
        );
        const wrapper = videoEl(container).parentElement;

        document.fullscreenElement = wrapper;
        fireEvent(document, new Event('fullscreenchange'));
        expect(screen.getByLabelText('Keluar layar penuh')).toBeTruthy();
        expect(onFullscreenChange).toHaveBeenLastCalledWith(true);

        document.fullscreenElement = null;
        fireEvent(document, new Event('fullscreenchange'));
        expect(screen.getByLabelText('Layar penuh')).toBeTruthy();
        expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
    });
});
