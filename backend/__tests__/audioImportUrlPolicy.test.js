/**
 * Purpose: Lock the SSRF guard for audio imports — the box sits ON the camera subnet, so an
 *   operator-supplied URL must be proven public before we open a socket. Uses IP-literal hosts so the
 *   checks are deterministic (no DNS/network).
 * Caller: Backend test gate (vitest, node env).
 */

import { describe, expect, it, vi } from 'vitest';
import { assertSafeImportUrl, pinnedLookup } from '../utils/audioImportUrlPolicy.js';

describe('audioImportUrlPolicy — rejects unsafe URLs', () => {
    it('rejects non-https', async () => {
        await expect(assertSafeImportUrl('http://8.8.8.8/a.mp3')).rejects.toThrow(/https/i);
    });
    it('rejects embedded credentials', async () => {
        await expect(assertSafeImportUrl('https://user:pass@8.8.8.8/a.mp3')).rejects.toThrow(/kredensial/i);
    });
    it('rejects malformed URLs', async () => {
        await expect(assertSafeImportUrl('not a url')).rejects.toThrow(/tidak valid/i);
    });

    const PRIVATE = [
        'https://10.0.0.1/a', 'https://10.255.1.2/a',
        'https://172.16.0.1/a', 'https://172.31.9.9/a',
        'https://192.168.1.5/a', 'https://127.0.0.1/a',
        'https://169.254.169.254/latest/meta-data', // cloud metadata
        'https://100.64.0.1/a',                      // CGNAT
        'https://[::1]/a',                           // IPv6 loopback
    ];
    it.each(PRIVATE)('rejects internal address %s', async (url) => {
        await expect(assertSafeImportUrl(url)).rejects.toThrow(/internal/i);
    });
});

describe('audioImportUrlPolicy — allows + classifies public URLs', () => {
    it('allows a public IP literal and classifies it as a plain url', async () => {
        const r = await assertSafeImportUrl('https://8.8.8.8/song.mp3');
        expect(r.kind).toBe('url');
        expect(r.host).toBe('8.8.8.8');
    });
    it('a non-YouTube host stays kind=url; only YouTube hosts are kind=youtube', async () => {
        // 1.1.1.1 is public and not a YouTube host.
        expect((await assertSafeImportUrl('https://1.1.1.1/a.mp3')).kind).toBe('url');
    });
});

describe('audioImportUrlPolicy — returns validated addresses for socket pinning (TOCTOU close)', () => {
    it('returns the literal IP as the pinned address (family 4)', async () => {
        // The socket is later pinned to exactly this, so a rebinding server cannot swap in a private IP
        // between validation and connect (there is no second, unchecked DNS lookup).
        const r = await assertSafeImportUrl('https://8.8.8.8/song.mp3');
        expect(r.addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
    });
});

describe('pinnedLookup — hands the connection ONLY pre-validated addresses', () => {
    const addrs = [{ address: '8.8.8.8', family: 4 }, { address: '8.8.4.4', family: 4 }];
    it('all:true returns the whole validated array', () => {
        const cb = vi.fn();
        pinnedLookup(addrs)('example.com', { all: true }, cb);
        expect(cb).toHaveBeenCalledWith(null, addrs);
    });
    it('all:false returns the first address + family', () => {
        const cb = vi.fn();
        pinnedLookup(addrs)('example.com', { all: false }, cb);
        expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    });
    it('supports the (hostname, callback) 2-arg form', () => {
        const cb = vi.fn();
        pinnedLookup(addrs)('example.com', cb);
        expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    });
});
