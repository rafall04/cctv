/*
Purpose: Lock the fullscreen object-fit fix — the fullscreen video must FILL the screen (object-cover)
         so a camera whose aspect ratio differs from the screen no longer shows black pillarbox bars on
         the sides; windowed keeps object-contain (the body is already sized to the camera's ratio).
Caller: Vitest frontend suite.
Deps: @testing-library/react; deviceDetector + rafThrottle stubbed so jsdom render is deterministic.
*/
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';

vi.mock('../../utils/deviceDetector.js', () => ({ detectDeviceTier: () => 'high' }));
vi.mock('../../utils/rafThrottle.js', () => ({
    createTransformThrottle: () => ({ update: vi.fn(), cancel: vi.fn() }),
}));

import ZoomableVideo from './ZoomableVideo';

const renderVideo = (props) => {
    const { container } = render(<ZoomableVideo videoRef={createRef()} {...props} />);
    return container.querySelector('video');
};

describe('ZoomableVideo — fullscreen object-fit (pillarbox fix)', () => {
    it('FILLS the screen with object-cover in fullscreen (no black bars on the sides)', () => {
        const video = renderVideo({ isFullscreen: true });
        expect(video.className).toContain('object-cover');
        expect(video.className).not.toContain('object-contain');
    });

    it('keeps object-contain when windowed (body is aspect-shaped → full frame, no bars either)', () => {
        const video = renderVideo({ isFullscreen: false });
        expect(video.className).toContain('object-contain');
        expect(video.className).not.toContain('object-cover');
    });

    it('defaults to object-contain when isFullscreen is not passed', () => {
        const video = renderVideo({});
        expect(video.className).toContain('object-contain');
    });
});
