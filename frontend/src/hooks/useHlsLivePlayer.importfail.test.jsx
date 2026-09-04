// @vitest-environment jsdom

/*
 * Purpose: Guard the regression where a failed `import('hls.js')` (stale index.html after a redeploy
 *          re-hashes the lazy chunk — Vite does not auto-retry) left the player on an eternal spinner.
 *          The hook must surface a retryable error card instead. Isolated in its own file because it
 *          mocks hls.js to FAIL to load, the opposite of the main test file's working mock.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library, vitest.
 */

import { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// The dynamic import rejects: mod.default access throws, so `await import('hls.js')` → HlsClass = mod.default
// throws synchronously inside run(), rejecting run()'s promise exactly like a real chunk-load failure.
vi.mock('hls.js', () => ({ get default() { throw new Error('Failed to fetch dynamically imported module'); } }));

import { useHlsLivePlayer } from './useHlsLivePlayer';

function Harness() {
    const videoRef = useRef(null);
    const state = useHlsLivePlayer({
        videoRef,
        resolveStream: () => Promise.resolve('https://x/live.m3u8'),
        resetKey: 'cam',
    });
    return (
        <div>
            <video ref={videoRef} />
            <span data-testid="status">{state.status}</span>
            <span data-testid="message">{state.message}</span>
        </div>
    );
}

describe('useHlsLivePlayer import failure', () => {
    it('surfaces a retryable error (not an eternal spinner) when the hls.js chunk fails to load', async () => {
        render(<Harness />);
        await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
        expect(screen.getByTestId('message').textContent).toMatch(/Muat ulang/i);
    });
});
