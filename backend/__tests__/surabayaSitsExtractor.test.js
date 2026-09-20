// Purpose: Verify Surabaya SITS extraction, sanitization, output path safety, and CLI parsing.
// Caller: Vitest backend suite.
// Deps: surabayaSitsExtractor service, node fs/path temp helpers, Vitest.
// MainFuncs: surabayaSitsExtractor test cases.
// SideEffects: Writes temporary private export JSON files in allowed private_exports paths.

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildPrivateImportPayload,
    buildSanitizedReportPayload,
    buildDefaultSurabayaSitsOutputPaths,
    decryptSurabayaSitsHex,
    formatSurabayaSitsSummary,
    getSurabayaSitsPrivateBaseDir,
    maskRtspUrl,
    normalizeSurabayaSitsRecord,
    parseSurabayaSitsCliArgs,
    probeSurabayaSitsHosts,
    validateOutputPath,
    writeSurabayaSitsOutputs,
} from '../services/surabayaSitsExtractor.js';

describe('surabayaSitsExtractor', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Fixture ciphertexts are aes-128-cbc over FAKE urls (TEST-NET-3 host, placeholder creds) —
    // a real feed credential was committed here once; the secret-hygiene guardrail now fails on it.
    const FAKE_RTSP_HEX = '8ade0e5f9fe33b4c2b7d74dd0a910699ee45ec470bac65ad32eb90154f014a007b52665d92115edf3c4f238d3292064336a34ce35103acb43425fd2fce05b9d4';
    const FAKE_HTTP_HEX = 'd8eafeadd2d775ea3c7790d504a09f6584d49287eeef4f3cc9418c0e009255d8f3f801b3035f8352f23584fd50cd9fa5';

    it('decrypts a sample rtsp payload from the Surabaya feed', () => {
        const plain = decryptSurabayaSitsHex(FAKE_RTSP_HEX);

        expect(plain).toBe('rtsp://user:pass@203.0.113.10:554/mpeg4/ch99/sub/av_stream');
    });

    it('decrypts a sample http fallback payload from the Surabaya feed', () => {
        const plain = decryptSurabayaSitsHex(FAKE_HTTP_HEX);

        expect(plain).toBe('http://vms.example.test/ver2/vms/atcs_99.mp4');
    });

    it('normalizes raw records into private import shape', () => {
        const normalized = normalizeSurabayaSitsRecord({
            nama_cctv: 'Adityawarman Indragiri Utara',
            status: 'on',
            url_cctv: '',
            rtsp: FAKE_RTSP_HEX,
        });

        expect(normalized).toMatchObject({
            name: 'Adityawarman Indragiri Utara',
            status: 'on',
            deliveryType: 'private_rtsp',
            coordinates: null,
            areaHint: 'SURABAYA',
            sourceMeta: {
                rtspHost: '203.0.113.10',
                rtspPort: 554,
                rtspUsername: 'user',
                rtspPassword: 'pass',
            },
        });
    });

    it('builds a sanitized report without credentials', () => {
        const records = [
            normalizeSurabayaSitsRecord({
                nama_cctv: 'Camera 1',
                status: 'on',
                url_cctv: '',
                rtsp: FAKE_RTSP_HEX,
            }),
        ];

        const report = buildSanitizedReportPayload(records, '2026-03-30T00:00:00.000Z');

        expect(JSON.stringify(report)).not.toContain('pass@');
        expect(report.records[0]).toEqual({
            name: 'Camera 1',
            status: 'on',
            rtspHost: '203.0.113.10',
            hasHttpFallback: false,
            coordinates: null,
        });
    });

    it('masks rtsp urls deterministically for logs', () => {
        expect(maskRtspUrl('rtsp://user:pass@203.0.113.10:554/Streaming/Channels/102')).toBe(
            'rtsp://user:***@203.0.113.10:554/Streaming/Channels/102'
        );
    });

    it('refuses repo-root json outputs and tracked repo paths', () => {
        const repoRoot = resolve(getSurabayaSitsPrivateBaseDir(), '..', '..');

        expect(() => validateOutputPath(resolve(repoRoot, 'output.json'), { privateOutput: false })).toThrow(
            /repo root/
        );
        expect(() => validateOutputPath(resolve(repoRoot, 'README.md'), { privateOutput: false })).toThrow(
            /tracked repo file/
        );
    });

    it('writes private and sanitized outputs to allowed paths', async () => {
        // basename(), not split('\\'): the backslash split only worked on Windows, so on
        // Linux CI the "token" was the whole absolute path and escaped the allowed dir.
        const tempToken = basename(await mkdtemp(join(tmpdir(), 'surabaya-sits-')));
        const privateBaseDir = getSurabayaSitsPrivateBaseDir();
        const privatePath = resolve(privateBaseDir, `${tempToken}-private.json`);
        const reportPath = resolve(privateBaseDir, `${tempToken}-report.json`);
        const records = [
            normalizeSurabayaSitsRecord({
                nama_cctv: 'Camera 1',
                status: 'on',
                url_cctv: '',
                rtsp: 'f09ac26facf91bcd66c22ed76568432be4bcdd4f2435b204d576cc759a0626f71126f43036c0c4e72be3e5b4e9faf8a44b66e7f03d374ac31a616eefe8827921b22aa524246b90f891a4f1a9c66d7b9b',
            }),
        ];
        const privatePayload = buildPrivateImportPayload(records, '2026-03-30T00:00:00.000Z');
        const reportPayload = buildSanitizedReportPayload(records, '2026-03-30T00:00:00.000Z');

        const result = await writeSurabayaSitsOutputs({
            privatePayload,
            reportPayload,
            privatePath,
            reportPath,
        });

        const privateText = await readFile(result.privatePath, 'utf8');
        const reportText = await readFile(result.reportPath, 'utf8');

        expect(privateText).toContain('g412uda5u12y426');
        expect(reportText).not.toContain('g412uda5u12y426');
    });

    it('parses cli args with safe defaults and optional probe mode', () => {
        const parsed = parseSurabayaSitsCliArgs([
            '--out-private',
            'C:/tmp/private_exports/surabaya/private.json',
            '--out-report',
            'C:/tmp/surabaya-report.json',
            '--timeout',
            '15',
            '--probe-hosts',
        ]);

        expect(parsed).toEqual({
            outPrivate: 'C:/tmp/private_exports/surabaya/private.json',
            outReport: 'C:/tmp/surabaya-report.json',
            timeoutSeconds: 15,
            probeHosts: true,
        });
    });

    it('probes hosts without exposing credentials', async () => {
        const records = [
            {
                sourceMeta: {
                    rtspHost: '36.66.208.98',
                },
            },
            {
                sourceMeta: {
                    rtspHost: '36.66.208.98',
                },
            },
            {
                sourceMeta: {
                    rtspHost: '36.66.208.99',
                },
            },
        ];

        const results = await probeSurabayaSitsHosts(records, {
            probe: async host => ({ host, port: 554, status: 'open' }),
        });

        expect(results).toEqual([
            { host: '36.66.208.98', port: 554, status: 'open' },
            { host: '36.66.208.99', port: 554, status: 'open' },
        ]);
    });

    it('formats a summary without leaking rtsp credentials', () => {
        const text = formatSurabayaSitsSummary({
            cameraCount: 132,
            hostCount: 5,
            rtspCount: 132,
            httpFallbackCount: 7,
            sampleCameraNames: ['A. YANI - JEMURSARI', 'BANYU URIP TOL BARAT PTZ'],
            hostProbes: [{ host: '36.66.208.98', status: 'open' }],
        }, {
            privatePath: 'C:/safe/private.json',
            reportPath: 'C:/safe/report.json',
        });

        expect(text).toContain('Cameras: 132');
        expect(text).not.toContain('rtsp://');
        expect(text).not.toContain('g412uda5u12y426');
    });

    it('uses private_exports defaults for both output files', () => {
        const defaults = buildDefaultSurabayaSitsOutputPaths();

        expect(defaults.privatePath).toContain('private_exports');
        expect(defaults.reportPath).toContain('private_exports');
    });
});
