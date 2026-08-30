/*
Purpose: Guard ZoomableVideo's render contract for the fullscreen fill-on-zoom fix — the <video> stays
         object-CONTAIN (so the whole frame is always present and pan can reach every edge; the fill
         comes from the scale boost in zoomFit, NOT from cropping the source). The fill/pan geometry
         itself is covered exhaustively in utils/zoomFit.test.js.
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

describe('ZoomableVideo — object-fit contract', () => {
    it('keeps object-contain in fullscreen (whole frame present; cover would crop the overflow away)', () => {
        const { container } = render(<ZoomableVideo videoRef={createRef()} isFullscreen />);
        const video = container.querySelector('video');
        expect(video.className).toContain('object-contain');
        expect(video.className).not.toContain('object-cover');
    });

    it('keeps object-contain in fullscreen even when zoomed in', () => {
        const api = createRef();
        const { container } = render(<ZoomableVideo ref={api} videoRef={createRef()} isFullscreen />);
        act(() => { api.current.zoomIn(); });
        const video = container.querySelector('video');
        expect(video.className).toContain('object-contain');
        expect(video.className).not.toContain('object-cover');
    });

    it('keeps object-contain windowed', () => {
        const { container } = render(<ZoomableVideo videoRef={createRef()} isFullscreen={false} />);
        expect(container.querySelector('video').className).toContain('object-contain');
    });

    it('exposes the imperative zoom API and tracks zoom (touch-action toggles off 1x)', () => {
        const api = createRef();
        const { container } = render(<ZoomableVideo ref={api} videoRef={createRef()} isFullscreen />);
        const wrapper = container.querySelector('div');
        expect(wrapper.style.touchAction).toBe('pan-x pan-y'); // 1x → page still scrollable
        act(() => { api.current.zoomIn(); });
        expect(api.current.getZoom()).toBeGreaterThan(1);
        expect(wrapper.style.touchAction).toBe('none'); // zoomed → capture gestures
        act(() => { api.current.reset(); });
        expect(api.current.getZoom()).toBe(1);
    });
});
