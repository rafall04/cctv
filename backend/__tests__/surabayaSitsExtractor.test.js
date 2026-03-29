import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

    it('decrypts a sample rtsp payload from the Surabaya feed', () => {
        const plain = decryptSurabayaSitsHex('f09ac26facf91bcd66c22ed76568432be4bcdd4f2435b204d576cc759a0626f71126f43036c0c4e72be3e5b4e9faf8a44b66e7f03d374ac31a616eefe8827921b22aa524246b90f891a4f1a9c66d7b9b');

        expect(plain).toBe('rtsp://edishub:g412uda5u12y426@36.66.208.98:554/mpeg4/ch19/sub/av_stream');
    });

    it('decrypts a sample http fallback payload from the Surabaya feed', () => {
        const plain = decryptSurabayaSitsHex('dd858626d3d9b1f9a9f4f96a193276c3d25423e999863534eaaf2b4670aaa4473cb6d94be5c61a32d036a0eb213174d49e8d28e32b98280f8226c75204e21b9d');

        expect(plain).toBe('http://sits.dishub.surabaya.go.id/ver2/vms/atcs_24.mp4');
    });

    it('normalizes raw records into private import shape', () => {
        const normalized = normalizeSurabayaSitsRecord({
            nama_cctv: 'Adityawarman Indragiri Utara',
            status: 'on',
            url_cctv: '',
            rtsp: 'f09ac26facf91bcd66c22ed76568432be4bcdd4f2435b204d576cc759a0626f71126f43036c0c4e72be3e5b4e9faf8a44b66e7f03d374ac31a616eefe8827921b22aa524246b90f891a4f1a9c66d7b9b',
        });

        expect(normalized).toMatchObject({
            name: 'Adityawarman Indragiri Utara',
            status: 'on',
            deliveryType: 'private_rtsp',
            coordinates: null,
            areaHint: 'SURABAYA',
            sourceMeta: {
                rtspHost: '36.66.208.98',
                rtspPort: 554,
                rtspUsername: 'edishub',
                rtspPassword: 'g412uda5u12y426',
            },
        });
    });

    it('builds a sanitized report without credentials', () => {
        const records = [
            normalizeSurabayaSitsRecord({
                nama_cctv: 'Camera 1',
                status: 'on',
                url_cctv: '',
                rtsp: 'f09ac26facf91bcd66c22ed76568432be4bcdd4f2435b204d576cc759a0626f71126f43036c0c4e72be3e5b4e9faf8a44b66e7f03d374ac31a616eefe8827921b22aa524246b90f891a4f1a9c66d7b9b',
            }),
        ];

        const report = buildSanitizedReportPayload(records, '2026-03-30T00:00:00.000Z');

        expect(JSON.stringify(report)).not.toContain('g412uda5u12y426');
        expect(report.records[0]).toEqual({
            name: 'Camera 1',
            status: 'on',
            rtspHost: '36.66.208.98',
            hasHttpFallback: false,
            coordinates: null,
        });
    });

    it('masks rtsp urls deterministically for logs', () => {
        expect(maskRtspUrl('rtsp://edishub:g412uda5u12y426@36.66.208.112:554/Streaming/Channels/102')).toBe(
            'rtsp://edishub:***@36.66.208.112:554/Streaming/Channels/102'
        );
    });

    it('refuses repo-root json outputs and tracked repo paths', () => {
        expect(() => validateOutputPath('C:/project/cctv/output.json', { privateOutput: false })).toThrow(
            /repo root/
        );
        expect(() => validateOutputPath('C:/project/cctv/README.md', { privateOutput: false })).toThrow(
            /tracked repo file/
        );
    });

    it('writes private and sanitized outputs to allowed paths', async () => {
        const tempToken = (await mkdtemp(join(tmpdir(), 'surabaya-sits-'))).split('\\').pop();
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
