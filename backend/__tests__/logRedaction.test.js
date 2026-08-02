/**
 * Purpose: Validate that free-text log redaction removes URL credentials without eating context.
 * Caller: Vitest backend suite.
 * Deps: utils/logRedaction.
 * MainFuncs: redactUrlCredentials.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { redactUrlCredentials } from '../utils/logRedaction.js';

describe('redactUrlCredentials', () => {
    it('masks user and password inside an FFmpeg error line', () => {
        const line = 'rtsp://admin:Aldivarama9@192.168.1.50:554/stream1: Connection timed out';
        const out = redactUrlCredentials(line);

        expect(out).not.toContain('Aldivarama9');
        expect(out).not.toContain('admin');
        expect(out).toBe('rtsp://****:****@192.168.1.50:554/stream1: Connection timed out');
    });

    it('masks a bare username with no password', () => {
        expect(redactUrlCredentials('rtsp://operator@10.0.0.9/live'))
            .toBe('rtsp://****:****@10.0.0.9/live');
    });

    it('masks every occurrence, not just the first', () => {
        const out = redactUrlCredentials(
            'failed rtsp://a:b@h1/s and rtsp://c:d@h2/s'
        );
        expect(out).not.toMatch(/[ab]:@|a:b|c:d/);
        expect(out).toBe('failed rtsp://****:****@h1/s and rtsp://****:****@h2/s');
    });

    it('covers http(s) sources too, not only rtsp', () => {
        expect(redactUrlCredentials('https://user:pw@cam.example/live.m3u8: 401'))
            .toBe('https://****:****@cam.example/live.m3u8: 401');
    });

    it('leaves credential-free URLs untouched', () => {
        const line = "[https @ 0x55] Opening 'https://data.example.go.id/live/x.m3u8?session=AbC' for reading";
        expect(redactUrlCredentials(line)).toBe(line);
    });

    /*
     * The "@" that matters is the one closing the authority. An "@" further down
     * the path is part of a filename and must not trigger a match — otherwise the
     * whole host+path collapses into "****:****@" and the line stops being useful.
     */
    it('does not match an @ that appears in a path', () => {
        const line = 'https://cdn.example/assets/logo@2x.png: 404';
        expect(redactUrlCredentials(line)).toBe(line);
    });

    it('passes through non-strings and empty values unchanged', () => {
        expect(redactUrlCredentials('')).toBe('');
        expect(redactUrlCredentials(null)).toBe(null);
        expect(redactUrlCredentials(undefined)).toBe(undefined);
        expect(redactUrlCredentials(42)).toBe(42);
    });
});
