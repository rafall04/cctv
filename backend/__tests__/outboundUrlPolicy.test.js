/**
 * Purpose: Prove the outbound-link policy that sits behind every affiliate redirect - https only,
 *          decided by the WHATWG URL parser rather than a prefix regex, credentials refused, and a
 *          raw string refused when it carries a character the parser would silently strip.
 * Caller: Backend test gate (vitest, node env).
 * Deps: vitest, utils/outboundUrlPolicy.js. No DB, no network - the module is pure.
 * MainFuncs: isSafeOutboundUrl / assertSafeOutboundUrl acceptance + rejection tables.
 * SideEffects: None.
 *
 * WHY THESE PARTICULAR REJECTIONS ARE LOAD-BEARING
 * ------------------------------------------------
 * The consumer of a value that passes this policy is a browser following `Location:` on a 302 sent
 * from this domain. So "safe" has to mean what the BROWSER will do with the string, not what a
 * human reading it assumes. Two of the cases below exist precisely because a caret-https prefix
 * test - the obvious implementation - answers differently from the browser:
 *
 *   * `https://toko-asli.example@evil.test/x` starts with https:// and reads as the trusted brand
 *     to whoever approved the deal in the admin panel. The browser resolves it to evil.test.
 *   * `new URL()` STRIPS tab/CR/LF from anywhere in the input before parsing, so a stored string of
 *     `https://toko-asli.example` + newline + `.evil.test` parses to the host
 *     `toko-asli.example.evil.test`. Only a scan of the RAW string catches that, which is why the
 *     control-character tests below are not redundant with the protocol test.
 *
 * Every `it` here is written so that deleting the corresponding rule from utils/outboundUrlPolicy.js
 * turns it red.
 *
 * Control characters appear ONLY as escape sequences in this file. Writing the literal bytes is
 * what the repo's byte-level source guardrail exists to catch.
 */

import { describe, expect, it } from 'vitest';

import { assertSafeOutboundUrl, isSafeOutboundUrl } from '../utils/outboundUrlPolicy.js';

/** 'https://toko.example/' is 21 chars, so this lands on the 1000-char boundary exactly. */
const AT_MAX_LENGTH = `https://toko.example/${'a'.repeat(979)}`;
const OVER_MAX_LENGTH = `https://toko.example/${'a'.repeat(1000)}`;

describe('isSafeOutboundUrl - accepts a real shop link', () => {
    it.each([
        ['a plain https host', 'https://toko-sinar.example'],
        ['a path and query', 'https://toko-sinar.example/produk/kamera-2mp?ref=raf'],
        ['a port and a fragment', 'https://toko-sinar.example:8443/produk#spesifikasi'],
        ['a trailing slash only', 'https://toko-sinar.example/'],
        ['an uppercase scheme (the parser lower-cases it)', 'HTTPS://toko-sinar.example/x'],
        ['exactly the 1000-character ceiling', AT_MAX_LENGTH],
    ])('accepts %s', (_label, value) => {
        expect(isSafeOutboundUrl(value)).toBe(true);
    });

    it('trims surrounding whitespace and hands back the trimmed string to store', () => {
        // The caller must persist THIS return value, not its own input, so the stored row is
        // byte-identical to the string that was validated.
        expect(assertSafeOutboundUrl('  https://toko-sinar.example/produk/1  ')).toBe(
            'https://toko-sinar.example/produk/1'
        );
    });
});

describe('isSafeOutboundUrl - refuses anything the browser would treat differently', () => {
    it.each([
        // The scheme allow-list is one entry long: a 302 from this domain is this domain vouching
        // for the destination, and none of these belong in a Location header.
        ['plaintext http', 'http://toko-sinar.example'],
        ['ftp', 'ftp://toko-sinar.example/x'],
        ['javascript:', 'javascript:alert(1)'],
        ['data:', 'data:text/html,<h1>hai</h1>'],
        ['an app intent', 'intent://scan/#Intent;scheme=zxing;end'],
        ['tel:', 'tel:+6281234567890'],
        ['market:', 'market://details?id=com.example'],

        // Apparent host is not the real host. This is the pair a prefix regex gets wrong.
        ['a bare username', 'https://toko-sinar.example@evil.test/x'],
        ['username and password', 'https://user:rahasia@evil.test/x'],

        // Not parseable at all, or parseable with no host to send anyone to.
        ['no scheme', 'toko-sinar.example/produk'],
        ['a protocol-relative link', '//toko-sinar.example/produk'],
        ['an empty hostname', 'https://'],
        ['an empty string', ''],
        ['whitespace only', '   '],

        ['over the 1000-character ceiling', OVER_MAX_LENGTH],
    ])('rejects %s', (_label, value) => {
        expect(isSafeOutboundUrl(value)).toBe(false);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a number', 42],
        ['an object', { href: 'https://toko-sinar.example' }],
        ['an array', ['https://toko-sinar.example']],
    ])('rejects %s rather than coercing it to a string', (_label, value) => {
        expect(isSafeOutboundUrl(value)).toBe(false);
    });
});

describe('isSafeOutboundUrl - the characters new URL() silently swallows', () => {
    /*
     * THE REAL LEAK. Without the raw-string scan this case PASSES: `new URL()` removes the newline
     * before parsing, so the policy would approve a string whose visible host is toko-asli.example
     * while the browser goes to toko-asli.example.evil.test. The protocol check cannot catch this
     * one - the parse result is a perfectly valid https URL, just not the one anybody reviewed.
     */
    it('rejects a newline spliced into the hostname (the parser strips it and changes the host)', () => {
        const spliced = 'https://toko-asli.example\n.evil.test/x';
        // What the browser would actually see if this string were ever put in a Location header:
        expect(new URL(spliced).hostname).toBe('toko-asli.example.evil.test');
        expect(isSafeOutboundUrl(spliced)).toBe(false);
    });

    it('rejects the WHATWG scheme trap "java\\nscript:alert(1)"', () => {
        // Same stripping, applied to the scheme: this parses as protocol 'javascript:'.
        const trap = 'java\nscript:alert(1)';
        expect(new URL(trap).protocol).toBe('javascript:');
        expect(isSafeOutboundUrl(trap)).toBe(false);
    });

    it.each([
        ['an embedded space', 'https://toko-sinar.example/produk baru'],
        ['an embedded tab', 'https://toko-sinar.example/\tproduk'],
        ['an embedded carriage return', 'https://toko-sinar.example/\rproduk'],
        ['a NUL byte', 'https://toko-sinar.example/\u0000produk'],
        ['a DEL byte', 'https://toko-sinar.example/produk\u007F'],
    ])('rejects %s', (_label, value) => {
        expect(isSafeOutboundUrl(value)).toBe(false);
    });
});

describe('assertSafeOutboundUrl - the write path', () => {
    it('throws a 400 carrying the operator-facing field label', () => {
        let thrown = null;
        try {
            assertSafeOutboundUrl('http://toko-sinar.example', 'URL toko');
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.statusCode).toBe(400);
        expect(thrown.message).toMatch(/^URL toko /);
        expect(thrown.message).toMatch(/https/);
    });

    it('falls back to a generic label when the caller gives none', () => {
        expect(() => assertSafeOutboundUrl('javascript:alert(1)')).toThrow(/^URL /);
    });

    it('agrees with isSafeOutboundUrl on every input, so the boolean and the 400 cannot drift', () => {
        const inputs = [
            'https://toko-sinar.example/produk',
            'http://toko-sinar.example',
            'https://user:pw@evil.test',
            'https://toko-asli.example\n.evil.test',
            'javascript:alert(1)',
            '',
            null,
            OVER_MAX_LENGTH,
            AT_MAX_LENGTH,
        ];
        for (const input of inputs) {
            let threw = false;
            try {
                assertSafeOutboundUrl(input);
            } catch {
                threw = true;
            }
            expect(threw, `disagreement on ${String(input).slice(0, 60)}`).toBe(!isSafeOutboundUrl(input));
        }
    });
});
