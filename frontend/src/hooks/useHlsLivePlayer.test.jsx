// @vitest-environment jsdom

/*
 * Purpose: Lock the shared live-player core's error classification + side-effect contract, since two
 *          players (TokenLivePlayer, CustomerLivePlayer) now depend on it — a silent change here would
 *          break both. Covers the resolveStream-reject classification (no hls.js needed) AND the
 *          in-stream hls.js error routing (mocked hls.js + a hand-driven picture-watch), including the
 *          billing-critical mid-watch 402 → payment path and the pre-live media-recovery-before-codec path.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library, vitest, mocked hls.js + livePictureWatch.
 */

import { useRef } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake hls.js: records instances so a test can fire ERROR events at the running player.
vi.mock('hls.js', () => {
    const instances = [];
    class FakeHls {
        constructor() { this.handlers = {}; instances.push(this); this.liveSyncPosition = 10; }
        static isSupported() { return true; }
        static Events = { MANIFEST_PARSED: 'MANIFEST_PARSED', ERROR: 'ERROR' };
        static ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' };
        on(evt, cb) { this.handlers[evt] = cb; }
        loadSource() {}
        attachMedia() {}
        destroy() {}
        recoverMediaError() { this.recovered = (this.recovered || 0) + 1; }
        startLoad() {}
        emit(evt, data) { this.handlers[evt]?.(null, data); }
    }
    FakeHls.__instances = instances;
    return { default: FakeHls };
});

// Picture-watch: capture its opts so a test drives go-live (onPicture) deterministically, by hand.
const watch = vi.hoisted(() => ({ opts: null }));
vi.mock('../utils/livePictureWatch.js', () => ({
    startLivePictureWatch: (_video, opts) => { watch.opts = opts; return () => {}; },
    hasPicture: () => true,
    countDecodedFrames: () => 1,
}));

import Hls from 'hls.js';
import { useHlsLivePlayer } from './useHlsLivePlayer';

function Harness(props) {
    const videoRef = useRef(null);
    const state = useHlsLivePlayer({ videoRef, resetKey: 'cam', ...props });
    return (
        <div>
            <video ref={videoRef} />
            <span data-testid="status">{state.status}</span>
            <span data-testid="kind">{String(state.kind)}</span>
            <span data-testid="message">{state.message}</span>
        </div>
    );
}

const rejectWith = (status) => () => Promise.reject(Object.assign(new Error('x'), { response: { status } }));

async function expectError(kind, message) {
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('kind').textContent).toBe(kind);
    if (message !== undefined) expect(screen.getByTestId('message').textContent).toBe(message);
}

describe('useHlsLivePlayer error classification (grant fetch)', () => {
    beforeEach(() => { Hls.__instances.length = 0; watch.opts = null; });

    it('maps HTTP 402 to a payment kind with the default message', async () => {
        render(<Harness resolveStream={rejectWith(402)} />);
        await expectError('payment', 'Kamera ditangguhkan.');
    });

    it('maps HTTP 401/403 to denied and fires onError once with the kind', async () => {
        const onError = vi.fn();
        render(<Harness resolveStream={rejectWith(403)} onError={onError} />);
        await expectError('denied');
        expect(onError).toHaveBeenCalledWith({ kind: 'denied', httpCode: 403 });
    });

    it('maps HTTP 404 to notfound', async () => {
        render(<Harness resolveStream={rejectWith(404)} />);
        await expectError('notfound');
    });

    it('carries a friendly error message through unchanged', async () => {
        const resolveStream = () => Promise.reject(Object.assign(new Error('Stream live tidak tersedia'), { friendly: true }));
        render(<Harness resolveStream={resolveStream} />);
        await expectError('unknown', 'Stream live tidak tersedia');
    });

    it('lets a caller override the copy per kind', async () => {
        render(<Harness resolveStream={rejectWith(402)} messages={{ payment: 'Saldo habis — kamera ditangguhkan.' }} />);
        await expectError('payment', 'Saldo habis — kamera ditangguhkan.');
    });

    it('lets mapError build a dynamic message (e.g. embed the HTTP code)', async () => {
        const mapError = ({ kind, httpCode }) => (kind === 'notfound' ? `Tidak ada (HTTP ${httpCode})` : undefined);
        render(<Harness resolveStream={rejectWith(404)} mapError={mapError} />);
        await expectError('notfound', 'Tidak ada (HTTP 404)');
    });
});

describe('useHlsLivePlayer in-stream error routing (hls.js)', () => {
    beforeEach(() => { Hls.__instances.length = 0; watch.opts = null; });

    const resolveOk = () => Promise.resolve('https://x/live.m3u8');
    const instance = async () => {
        await waitFor(() => expect(Hls.__instances.length).toBeGreaterThan(0));
        return Hls.__instances[Hls.__instances.length - 1];
    };
    const goLive = async () => {
        await waitFor(() => expect(watch.opts).toBeTruthy());
        await act(async () => { watch.opts.onPicture(); });
        await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('playing'));
    };

    it('surfaces a mid-watch 402 as payment (amber), not a generic stall', async () => {
        render(<Harness resolveStream={resolveOk} />);
        const inst = await instance();
        await goLive();
        // A suspended camera's next live-playlist refresh returns 402.
        act(() => inst.emit('ERROR', { fatal: true, type: 'networkError', details: 'levelLoadError', response: { code: 402 } }));
        await expectError('payment');
    });

    it('surfaces a mid-watch 401/403 as denied, not a stall', async () => {
        render(<Harness resolveStream={resolveOk} />);
        const inst = await instance();
        await goLive();
        act(() => inst.emit('ERROR', { fatal: true, type: 'networkError', details: 'levelLoadError', response: { code: 403 } }));
        await expectError('denied');
    });

    it('is terminal: a later hls ERROR cannot reopen a picture-watch codec verdict', async () => {
        const onError = vi.fn();
        render(<Harness resolveStream={resolveOk} onError={onError} />);
        const inst = await instance();
        await waitFor(() => expect(watch.opts).toBeTruthy());
        // Pre-live: the watch reports "took bytes, decoded nothing" → terminal codec verdict.
        act(() => watch.opts.onNoPicture({ everHadPicture: false }));
        await expectError('codec');
        expect(onError).toHaveBeenCalledTimes(1);
        // The still-attached instance emits a late fatal 404 — must NOT revert to loading (warmup-404)
        // or re-fire onError. The verdict is terminal.
        act(() => inst.emit('ERROR', { fatal: true, type: 'networkError', details: 'levelLoadError', response: { code: 404 } }));
        expect(screen.getByTestId('status').textContent).toBe('error');
        expect(screen.getByTestId('kind').textContent).toBe('codec');
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('recovers a pre-live fatal media error before ever pronouncing codec', async () => {
        render(<Harness resolveStream={resolveOk} />);
        const inst = await instance();
        // Pre-live (onPicture NOT called): a fatal media error with no http code → recoverMediaError, no verdict.
        act(() => inst.emit('ERROR', { fatal: true, type: 'mediaError', details: 'bufferAppendError' }));
        expect(inst.recovered).toBe(1);
        expect(screen.getByTestId('status').textContent).toBe('loading');
        // Second one → second recovery, still no codec verdict.
        act(() => inst.emit('ERROR', { fatal: true, type: 'mediaError', details: 'bufferAppendError' }));
        expect(inst.recovered).toBe(2);
        expect(screen.getByTestId('status').textContent).toBe('loading');
        // Third (recovery budget spent) → NOW the terminal codec verdict.
        act(() => inst.emit('ERROR', { fatal: true, type: 'mediaError', details: 'bufferAppendError' }));
        await expectError('codec');
    });
});
