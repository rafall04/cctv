/*
Purpose: Lock the fullscreen ZOOM fill fix — while fullscreen AND zoomed in, the video fills the screen
         (object-cover) so no black pillarbox bars surround the zoomed close-up; at 1× (and windowed) it
         stays object-contain so the WHOLE frame is visible.
Caller: Vitest frontend suite.
Deps: @testing-library/react; deviceDetector + rafThrottle stubbed so jsdom render is deterministic.
*/
import { describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { createRef } from 'react';

vi.mock('../../utils/deviceDetector.js', () => ({ detectDeviceTier: () => 'high' }));
vi.mock('../../utils/rafThrottle.js', () => ({
    createTransformThrottle: () => ({ update: vi.fn(), cancel: vi.fn() }),
}));

import ZoomableVideo from './ZoomableVideo';

describe('ZoomableVideo — fullscreen zoom fill (pillarbox fix)', () => {
    it('fills with object-cover ONCE ZOOMED IN in fullscreen (no black bars while zooming)', () => {
        const api = createRef();
        const { container } = render(<ZoomableVideo ref={api} videoRef={createRef()} isFullscreen />);
        const video = container.querySelector('video');
        // At 1× fullscreen: whole frame (contain); a 4:3-on-16:9 letterbox here is acceptable.
        expect(video.className).toContain('object-contain');
        // Zoom in → fills edge-to-edge (cover), bars gone.
        act(() => { api.current.zoomIn(); });
        expect(video.className).toContain('object-cover');
        expect(video.className).not.toContain('object-contain');
    });

    it('stays object-contain at 1× fullscreen (whole frame visible for overview)', () => {
        const { container } = render(<ZoomableVideo videoRef={createRef()} isFullscreen />);
        expect(container.querySelector('video').className).toContain('object-contain');
    });

    it('never uses cover when windowed, even zoomed (body is already aspect-shaped → no bars)', () => {
        const api = createRef();
        const { container } = render(<ZoomableVideo ref={api} videoRef={createRef()} isFullscreen={false} />);
        act(() => { api.current.zoomIn(); });
        const video = container.querySelector('video');
        expect(video.className).toContain('object-contain');
        expect(video.className).not.toContain('object-cover');
    });
});
