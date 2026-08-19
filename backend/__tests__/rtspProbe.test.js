/**
 * Purpose: Lock the settlement guarantee of the RTSP probe primitives — every connection
 *          outcome must SETTLE the promise, because the health sweep awaits probes through
 *          Promise.allSettled and one unsettled promise freezes fleet health forever.
 * Caller: Backend Vitest suite.
 * Deps: real net.Server on an ephemeral port (the hazard under test is socket-event wiring,
 *       which mocks cannot prove).
 * SideEffects: Listens on 127.0.0.1 ephemeral ports; servers closed per test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import net from 'net';
import { sendRtspRequest, probeRtspSource } from '../services/rtspProbe.js';
import { guardProbeSettlement } from '../services/cameraHealthPolicy.js';

const servers = [];

function listen(onConnection) {
    return new Promise((resolve) => {
        // resume() first: these fake cameras never read the request bytes, and a Node socket
        // holding unconsumed inbound data never processes the peer's FIN — the server socket
        // stays half-open and server.close() in afterEach waits on it forever. (The same
        // never-quite-closed shape as the bug under test, just on the other side.)
        const server = net.createServer((socket) => { socket.resume(); onConnection(socket); });
        servers.push(server);
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r()))));
});

describe('sendRtspRequest settles on every connection outcome', () => {
    /*
     * REGRESSION (production, 2026-08-17 -> 19): a camera accepted the probe's TCP
     * connection and closed it cleanly — FIN, no data, no RST. 'data' never saw the header
     * terminator, a clean FIN is not an 'error', and a closed socket's inactivity timer is
     * cleared so 'timeout' can never fire. The promise lost its resolver, and because the
     * health sweep awaits every probe via Promise.allSettled, fleet-wide health monitoring
     * froze for the life of the process: 447 sweep completions on Aug 17, zero afterwards.
     * Three cameras stayed "offline" for two days while MediaMTX streamed them happily.
     */
    it('settles when the server accepts and closes without ever responding', async () => {
        const port = await listen((socket) => socket.end());

        const result = await sendRtspRequest({
            host: '127.0.0.1', port, request: 'DESCRIBE rtsp://x RTSP/1.0\r\nCSeq: 1\r\n\r\n', timeoutMs: 2000,
        });

        expect(result.errorCode).toBe('connection_closed_without_response');
    }, 4000);

    it('settles when the server sends a partial response and then closes', async () => {
        const port = await listen((socket) => {
            socket.on('data', () => socket.end('RTSP/1.0 200 OK\r\nCSeq: 1'));
        });

        const result = await sendRtspRequest({
            host: '127.0.0.1', port, request: 'DESCRIBE rtsp://x RTSP/1.0\r\nCSeq: 1\r\n\r\n', timeoutMs: 2000,
        });

        expect(result.errorCode).toBe('connection_closed_without_response');
    }, 4000);

    it('still parses a complete response ahead of the close handler', async () => {
        const port = await listen((socket) => {
            socket.on('data', () => socket.end('RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\nWWW-Authenticate: Basic realm="x"\r\n\r\n'));
        });

        const result = await sendRtspRequest({
            host: '127.0.0.1', port, request: 'DESCRIBE rtsp://x RTSP/1.0\r\nCSeq: 1\r\n\r\n', timeoutMs: 2000,
        });

        expect(result.statusCode).toBe(401);
    }, 4000);

    it('settles on connection refused', async () => {
        const port = await listen(() => {});
        await new Promise((r) => servers.pop().close(() => r()));

        const result = await sendRtspRequest({
            host: '127.0.0.1', port, request: 'DESCRIBE rtsp://x RTSP/1.0\r\nCSeq: 1\r\n\r\n', timeoutMs: 2000,
        });

        expect(result.errorCode).toBe('ECONNREFUSED');
    }, 4000);
});

describe('probeRtspSource end-to-end against a close-happy camera', () => {
    it('reports offline instead of hanging when every connection is dropped unanswered', async () => {
        const port = await listen((socket) => socket.end());

        const result = await probeRtspSource(`rtsp://user:pass@127.0.0.1:${port}/stream1`, 2000);

        expect(result.online).toBe(false);
    }, 6000);
});

describe('guardProbeSettlement — the fleet-level armour', () => {
    it('rejects a probe that never settles, instead of waiting forever', async () => {
        const never = new Promise(() => {});

        await expect(guardProbeSettlement(never, { deadlineMs: 50 }))
            .rejects.toThrow('probe_never_settled_within_50ms');
    });

    it('passes through a resolving probe and its value untouched', async () => {
        await expect(guardProbeSettlement(Promise.resolve({ online: true }), { deadlineMs: 5000 }))
            .resolves.toEqual({ online: true });
    });

    it('passes through a rejecting probe without rewriting the reason', async () => {
        await expect(guardProbeSettlement(Promise.reject(new Error('asli')), { deadlineMs: 5000 }))
            .rejects.toThrow('asli');
    });
});

/*
 * REGRESSION (production, 2026-08-19): probes ended their sockets with destroy() — a FIN. The
 * `RtpRtspFlyer` cameras on this deployment never close their own side, so every probe left the
 * camera holding a CLOSE_WAIT socket forever. Those fill the firmware's small session table, and a
 * full table answers 401 to CORRECT credentials — which health reads as auth failure, marks the
 * camera offline, and retries harder, adding more zombies. Cameras 7 and 8 were wedged this way
 * for two days; eight minutes of total silence let camera 7 reap its sessions and answer normally.
 *
 * RST tears both sides down at once, so the slot is reclaimed the moment the probe is finished.
 */
describe('probe melepaskan slot sesi kamera, bukan meninggalkan zombie', () => {
    it('mengakhiri koneksi dengan RST sehingga sisi kamera ikut runtuh', async () => {
        const seen = [];
        const port = await listen((socket) => {
            socket.on('error', (e) => seen.push(e.code));
            socket.on('close', (hadError) => seen.push(hadError ? 'close_with_error' : 'close_clean'));
            socket.on('data', () => socket.write('RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n'));
        });

        await sendRtspRequest({
            host: '127.0.0.1', port, request: 'DESCRIBE rtsp://x RTSP/1.0\r\nCSeq: 1\r\n\r\n', timeoutMs: 2000,
        });
        await new Promise((r) => setTimeout(r, 250));

        // RST surfaces on the peer as ECONNRESET; a FIN would have left it half-open with the
        // server never seeing an error at all.
        expect(seen).toContain('ECONNRESET');
    }, 5000);

    it('tetap menyerahkan hasil probe yang benar meski koneksi diputus paksa', async () => {
        const port = await listen((socket) => {
            socket.on('error', () => {});
            socket.on('data', () => socket.write('RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: 0\r\n\r\n'));
        });

        const result = await sendRtspRequest({
            host: '127.0.0.1', port, request: 'DESCRIBE rtsp://x RTSP/1.0\r\nCSeq: 1\r\n\r\n', timeoutMs: 2000,
        });

        expect(result.statusCode).toBe(200);
    }, 5000);
});
