/*
 * Purpose: Pin the User-Agent summary against the agents production actually receives, plus the
 *          device families it will meet next.
 * Caller: Vitest frontend suite.
 * MainFuncs: summarizeUserAgent cases.
 * SideEffects: None.
 *
 * The nine REAL agents below were read out of the production audit log, not invented — that is why
 * they include the awkward cases a hand-written fixture would have missed: Android reporting model
 * "K", two vendor browsers that also claim to be Chrome, and a bare `curl`.
 */

import { describe, expect, it } from 'vitest';
import { summarizeUserAgent } from './deviceLabel.js';

describe('summarizeUserAgent — agents seen in production', () => {
    it.each([
        [
            'Windows desktop Chrome',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
            'Windows 10/11 · Chrome 150',
        ],
        [
            'Android with the model reduced to "K"',
            'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
            'Android 10 · Chrome 151',
        ],
        [
            'Xiaomi POCO on MIUI Browser — which also claims Chrome',
            'Mozilla/5.0 (Linux; Android 16; POCO F7 Build/BP2A.250605.031.A3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.79 Mobile Safari/537.36 XiaoMi/MiuiBrowser/14.54.0-gn',
            'Android 16 · POCO F7 · MIUI Browser 14',
        ],
        [
            'Vivo phone on its own browser',
            'Mozilla/5.0 (Linux; Android 14; V2322) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/123.0.6312.118 Mobile Safari/537.36 VivoBrowser/15.1.0.3',
            'Android 14 · V2322 · Vivo Browser 15',
        ],
        [
            'iPhone Safari, whose version lives in Version/',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1',
            'iOS 18.7 · Safari 26',
        ],
        [
            'a command-line client, not a browser at all',
            'curl/7.81.0',
            'curl 7.81.0',
        ],
    ])('%s', (_label, ua, expected) => {
        expect(summarizeUserAgent(ua)).toBe(expected);
    });

    it('names an Electron app rather than calling it Chrome', () => {
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.24012.9 Chrome/148.0.7778.280 Electron/42.7.0 Safari/537.36 MSIX';
        expect(summarizeUserAgent(ua)).toBe('Windows 10/11 · Aplikasi Claude');
    });
});

describe('summarizeUserAgent — other device families', () => {
    it.each([
        [
            'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1',
            'iPadOS 17.5 · Safari 17',
        ],
        [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
            'macOS 10.15 · Chrome 149',
        ],
        [
            'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
            'Android 13 · SM-A536E · Samsung Internet 23',
        ],
        [
            'Mozilla/5.0 (Linux; Android 12; CPH2325) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 HeyTapBrowser/45.9.4.1',
            'Android 12 · CPH2325 · Oppo Browser 45',
        ],
        [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0',
            'Windows 10/11 · Edge 149',
        ],
        [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
            'Windows 10/11 · Firefox 130',
        ],
        [
            'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
            'ChromeOS · Chrome 149',
        ],
        [
            'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
            'Windows 7 · Chrome 109',
        ],
    ])('summarises %s', (ua, expected) => {
        expect(summarizeUserAgent(ua)).toBe(expected);
    });
});

describe('summarizeUserAgent — honesty when it cannot tell', () => {
    it.each([[null], [undefined], [''], ['   ']])('answers null for %s rather than a fake device', (value) => {
        expect(summarizeUserAgent(value)).toBeNull();
    });

    it('shows a trimmed raw string for something it does not recognise', () => {
        // Better an honest fragment than a confident wrong guess, in a log used to work out who did what.
        expect(summarizeUserAgent('SomeUnknownAgent')).toBe('SomeUnknownAgent');
        const long = 'x'.repeat(120);
        expect(summarizeUserAgent(long)).toBe(`${'x'.repeat(40)}…`);
    });

    it('drops meaningless Android models instead of printing them', () => {
        // "wv" marks a WebView and "K" is Chrome's reduction — neither identifies a handset.
        expect(summarizeUserAgent('Mozilla/5.0 (Linux; Android 11; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'))
            .toBe('Android 11 · Chrome 120');
    });
});
