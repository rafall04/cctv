/**
 * Purpose: Validate inputSanitizer strips HTML tags / dangerous schemes WITHOUT corrupting
 *          URLs, passwords, query strings, or JSON.
 * Caller: Vitest backend suite.
 * Deps: middleware/inputSanitizer.js (pure helpers).
 * MainFuncs: sanitizeString, sanitizeObject.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeString, sanitizeObject } from '../middleware/inputSanitizer.js';

describe('sanitizeString — strips markup, preserves data', () => {
    it('removes HTML tag spans', () => {
        expect(sanitizeString('<script>alert(1)</script>')).toBe('alert(1)');
        expect(sanitizeString('hello<b>world</b>')).toBe('helloworld');
        expect(sanitizeString('<img src=x onerror=alert(1)>')).toBe('');
    });

    it('strips javascript: / vbscript: schemes', () => {
        expect(sanitizeString('javascript:alert(1)')).toBe('alert(1)');
        expect(sanitizeString('VBScript:msgbox(1)')).toBe('msgbox(1)');
    });

    it('does NOT corrupt RTSP / HTTP URLs', () => {
        const rtsp = 'rtsp://admin:p%40ss@10.0.0.2:554/stream1';
        expect(sanitizeString(rtsp)).toBe(rtsp);
        const hls = 'https://example.com/live/index.m3u8?token=abc123&q=1';
        expect(sanitizeString(hls)).toBe(hls);
    });

    it('does NOT corrupt passwords with special chars', () => {
        const pw = 'P@ss=w0rd/"\'`&123';
        expect(sanitizeString(pw)).toBe(pw);
    });

    it('preserves bare comparison operators (not tag-like)', () => {
        expect(sanitizeString('a < b and c > d')).toBe('a < b and c > d');
        expect(sanitizeString('value <= 10')).toBe('value <= 10');
    });

    it('passes through non-strings unchanged', () => {
        expect(sanitizeString(42)).toBe(42);
        expect(sanitizeString(null)).toBe(null);
        expect(sanitizeString(undefined)).toBe(undefined);
    });
});

describe('sanitizeObject — recursive', () => {
    it('sanitizes nested string values and array items', () => {
        const input = {
            name: 'Cam <script>x</script>',
            url: 'rtsp://h/s',
            tags: ['<i>a</i>', 'b'],
            meta: { note: 'ok<br>' },
        };
        const out = sanitizeObject(input);
        expect(out.name).toBe('Cam x');
        expect(out.url).toBe('rtsp://h/s');
        expect(out.tags).toEqual(['a', 'b']);
        expect(out.meta.note).toBe('ok');
    });

    it('stops at max recursion depth without throwing', () => {
        const deep = {};
        let cursor = deep;
        for (let i = 0; i < 30; i += 1) {
            cursor.child = {};
            cursor = cursor.child;
        }
        expect(() => sanitizeObject(deep)).not.toThrow();
    });
});
