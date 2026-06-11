/*
Purpose: Lock the tab-hidden pause/resume behavior so backgrounded live tabs stop wasting
         bandwidth/CPU without ever overriding a manual user pause.
Caller: Frontend Vitest suite.
Deps: React Testing Library renderHook, usePauseOnHidden hook.
SideEffects: Toggles document.hidden and dispatches visibilitychange.
*/

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePauseOnHidden } from './usePauseOnHidden.js';

function setHidden(hidden) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

describe('usePauseOnHidden', () => {
    it('pauses a playing video when the tab hides and resumes it when visible again', () => {
        const video = {
            paused: false,
            play: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(() => { video.paused = true; }),
        };
        renderHook(() => usePauseOnHidden({ current: video }));

        setHidden(true);
        expect(video.pause).toHaveBeenCalledTimes(1);

        setHidden(false);
        expect(video.play).toHaveBeenCalledTimes(1);
    });

    it('does not resume a video the user paused themselves', () => {
        const video = {
            paused: true, // user already paused it
            play: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
        };
        renderHook(() => usePauseOnHidden({ current: video }));

        setHidden(true);
        expect(video.pause).not.toHaveBeenCalled(); // already paused → leave it

        setHidden(false);
        expect(video.play).not.toHaveBeenCalled(); // we never paused it → don't resume
    });

    it('is a no-op when the ref holds no video element (MJPEG / embed)', () => {
        renderHook(() => usePauseOnHidden({ current: null }));
        expect(() => setHidden(true)).not.toThrow();
        expect(() => setHidden(false)).not.toThrow();
    });

    it('removes the visibilitychange listener on unmount', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        const { unmount } = renderHook(() => usePauseOnHidden({
            current: { paused: false, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() },
        }));

        unmount();
        expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
        removeSpy.mockRestore();
    });
});
