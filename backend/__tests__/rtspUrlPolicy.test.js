/**
 * Purpose: Pin the customer RTSP SSRF filter, including the IPv4-mapped IPv6 bypass (Audit v1.2.0, S-04).
 * Caller: Backend Vitest suite for utils/rtspUrlPolicy.js.
 * Deps: vitest; pure function, no mocks.
 * MainFuncs: validateCustomerRtspUrl block/allow matrix.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { validateCustomerRtspUrl } from '../utils/rtspUrlPolicy.js';

const ok = (u) => validateCustomerRtspUrl(u).ok;

describe('validateCustomerRtspUrl — SSRF literal-IP blocklist', () => {
    it('blocks plain loopback / link-local / unspecified', () => {
        expect(ok('rtsp://127.0.0.1:554/s')).toBe(false);
        expect(ok('rtsp://169.254.169.254/s')).toBe(false);
        expect(ok('rtsp://0.0.0.0/s')).toBe(false);
        expect(ok('rtsp://[::1]:554/s')).toBe(false);
    });

    it('blocks IPv4-mapped IPv6 forms of loopback / link-local (S-04 regression)', () => {
        expect(ok('rtsp://[::ffff:127.0.0.1]:554/s')).toBe(false);       // dotted mapped
        expect(ok('rtsp://[::ffff:169.254.169.254]/s')).toBe(false);      // dotted mapped metadata
        expect(ok('rtsp://[::ffff:7f00:1]:554/s')).toBe(false);           // hex-canonical mapped loopback
    });

    it('still allows public and RFC1918 hosts (private ranges are intentional for LAN cameras)', () => {
        expect(ok('rtsp://203.0.113.9:554/cam')).toBe(true);
        expect(ok('rtsp://[::ffff:8.8.8.8]:554/s')).toBe(true);           // mapped public
        expect(ok('rtsp://10.0.0.5:554/cam')).toBe(true);
        expect(ok('rtsp://[::ffff:10.0.0.5]:554/s')).toBe(true);          // mapped RFC1918
    });

    it('rejects non-rtsp schemes and the localhost hostname', () => {
        expect(ok('http://example.com/s')).toBe(false);
        expect(ok('rtsp://localhost:554/s')).toBe(false);
    });
});
