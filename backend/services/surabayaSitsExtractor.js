import axios from 'axios';
import { createDecipheriv } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SURABAYA_SITS_SOURCE_URL = 'https://dishub.surabaya.go.id/p56/api/sits/cctv2.php';
const SURABAYA_SITS_ORIGIN = 'dishub.surabaya.go.id/p56/api/sits/cctv2.php';
const SURABAYA_AREA_HINT = 'SURABAYA';
const SURABAYA_DELIVERY_TYPE = 'private_rtsp';
const SURABAYA_AES_KEY = '0a1b2c3d4e5f6789';
const SURABAYA_AES_IV = 'f0e1d2c3b4a59876';
const SURABAYA_DEFAULT_TIMEOUT_SECONDS = 30;
const PRIVATE_EXPORTS_DIRNAME = 'private_exports';
const PRIVATE_SURABAYA_DIRNAME = 'surabaya';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = resolve(__dirname, '..');
const repoRoot = resolve(backendRoot, '..');
const defaultPrivateBaseDir = resolve(repoRoot, PRIVATE_EXPORTS_DIRNAME, PRIVATE_SURABAYA_DIRNAME);

export function getSurabayaSitsPrivateBaseDir() {
    return defaultPrivateBaseDir;
}

export function createSurabayaSitsHttpClient(timeoutMs = SURABAYA_DEFAULT_TIMEOUT_SECONDS * 1000) {
    return axios.create({
        timeout: timeoutMs,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'application/json,text/plain,*/*',
            'Referer': 'https://dishub.surabaya.go.id/p56/',
        },
    });
}

export function decryptSurabayaSitsHex(cipherHex) {
    if (!cipherHex || !String(cipherHex).trim()) {
        return null;
    }

    const decipher = createDecipheriv(
        'aes-128-cbc',
        Buffer.from(SURABAYA_AES_KEY, 'utf8'),
        Buffer.from(SURABAYA_AES_IV, 'utf8')
    );
    decipher.setAutoPadding(false);

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(String(cipherHex).trim(), 'hex')),
        decipher.final(),
    ]);

    return decrypted.toString('utf8').replace(/\0+$/g, '');
}

export function parseRtspUrl(rtspUrl) {
    if (!rtspUrl) {
        return {
            host: null,
            port: null,
            path: null,
            username: null,
            password: null,
        };
    }

    const parsed = new URL(rtspUrl);

    return {
        host: parsed.hostname || null,
        port: parsed.port ? Number(parsed.port) : 554,
        path: parsed.pathname || null,
        username: parsed.username || null,
        password: parsed.password || null,
    };
}

export function maskRtspUrl(rtspUrl) {
    if (!rtspUrl) {
        return null;
    }

    const parsed = new URL(rtspUrl);
    const maskedPassword = parsed.password ? '***' : '';
    const authPart = parsed.username
        ? `${parsed.username}${parsed.password ? `:${maskedPassword}` : ''}@`
        : '';
    const portPart = parsed.port ? `:${parsed.port}` : '';

    return `${parsed.protocol}//${authPart}${parsed.hostname}${portPart}${parsed.pathname}`;
}

export function normalizeSurabayaSitsRecord(rawRecord) {
    const rtspUrl = decryptSurabayaSitsHex(rawRecord?.rtsp);
    const httpFallbackUrl = decryptSurabayaSitsHex(rawRecord?.url_cctv);
    const parsedRtsp = parseRtspUrl(rtspUrl);
    const normalizedStatus = ['on', 'off'].includes(String(rawRecord?.status || '').toLowerCase())
        ? String(rawRecord.status).toLowerCase()
        : 'unknown';

    return {
        name: rawRecord?.nama_cctv || null,
        status: normalizedStatus,
        deliveryType: SURABAYA_DELIVERY_TYPE,
        rtspUrl,
        httpFallbackUrl,
        coordinates: null,
        areaHint: SURABAYA_AREA_HINT,
        sourceMeta: {
            rtspHost: parsedRtsp.host,
            rtspPort: parsedRtsp.port,
            rtspPath: parsedRtsp.path,
            rtspUsername: parsedRtsp.username,
            rtspPassword: parsedRtsp.password,
            origin: SURABAYA_SITS_ORIGIN,
        },
    };
}

export async function fetchSurabayaSitsRecords({
    client = createSurabayaSitsHttpClient(),
    timeoutSeconds = SURABAYA_DEFAULT_TIMEOUT_SECONDS,
} = {}) {
    const response = await client.get(SURABAYA_SITS_SOURCE_URL, {
        timeout: timeoutSeconds * 1000,
    });

    const rows = Array.isArray(response?.data?.cctv) ? response.data.cctv : [];
    return rows.map(normalizeSurabayaSitsRecord);
}

export function buildPrivateImportPayload(records, fetchedAt = new Date().toISOString()) {
    return {
        source: 'sits_surabaya_apk',
        fetchedAt,
        recordCount: records.length,
        records,
    };
}

export function buildSanitizedReportPayload(records, fetchedAt = new Date().toISOString()) {
    return {
        source: 'sits_surabaya_apk',
        fetchedAt,
        recordCount: records.length,
        records: records.map(record => ({
            name: record.name,
            status: record.status,
            rtspHost: record.sourceMeta.rtspHost,
            hasHttpFallback: Boolean(record.httpFallbackUrl),
            coordinates: null,
        })),
    };
}

export function buildDefaultSurabayaSitsOutputPaths() {
    return {
        privatePath: resolve(defaultPrivateBaseDir, 'surabaya_sits_private_import.json'),
        reportPath: resolve(defaultPrivateBaseDir, 'surabaya_sits_sanitized_report.json'),
    };
}

function isPathInside(basePath, targetPath) {
    const relativePath = relative(basePath, targetPath);
    return (
        (relativePath !== '' && !relativePath.startsWith('..') && !relativePath.includes(':'))
        || resolve(basePath) === resolve(targetPath)
    );
}

function isTrackedRepoPath(targetPath) {
    if (!isPathInside(repoRoot, targetPath)) {
        return false;
    }

    const relativePath = relative(repoRoot, targetPath);
    const gitResult = spawnSync('git', ['ls-files', '--error-unmatch', relativePath], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
    });

    return gitResult.status === 0;
}

export function validateOutputPath(targetPath, { privateOutput = false } = {}) {
    const resolvedPath = resolve(targetPath);
    const outputDir = dirname(resolvedPath);

    if (privateOutput && !isPathInside(defaultPrivateBaseDir, resolvedPath)) {
        throw new Error(`Private output must stay under ${defaultPrivateBaseDir}`);
    }

    if (isTrackedRepoPath(resolvedPath)) {
        throw new Error(`Refusing to overwrite tracked repo file: ${resolvedPath}`);
    }

    if (isPathInside(repoRoot, resolvedPath) && dirname(resolvedPath) === repoRoot && extname(resolvedPath).toLowerCase() === '.json') {
        throw new Error(`Refusing to write JSON output to repo root: ${resolvedPath}`);
    }

    if (isPathInside(repoRoot, resolvedPath) && !isPathInside(defaultPrivateBaseDir, outputDir)) {
        throw new Error(`Repo-local outputs must stay under ${defaultPrivateBaseDir}`);
    }

    return resolvedPath;
}

export async function writeSurabayaSitsOutputs({
    privatePayload,
    reportPayload,
    privatePath,
    reportPath,
}) {
    const resolvedPrivatePath = validateOutputPath(privatePath, { privateOutput: true });
    const resolvedReportPath = validateOutputPath(reportPath, { privateOutput: false });

    await mkdir(dirname(resolvedPrivatePath), { recursive: true });
    await mkdir(dirname(resolvedReportPath), { recursive: true });

    await writeFile(resolvedPrivatePath, JSON.stringify(privatePayload, null, 4));
    await writeFile(resolvedReportPath, JSON.stringify(reportPayload, null, 4));

    return {
        privatePath: resolvedPrivatePath,
        reportPath: resolvedReportPath,
    };
}

export function createTcpHostProbe(timeoutSeconds = 5) {
    return host => new Promise(resolveProbe => {
        const socket = new net.Socket();
        const timeoutMs = timeoutSeconds * 1000;

        const finish = result => {
            socket.removeAllListeners();
            socket.destroy();
            resolveProbe(result);
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish({ host, port: 554, status: 'open' }));
        socket.once('timeout', () => finish({ host, port: 554, status: 'timeout' }));
        socket.once('error', error => finish({ host, port: 554, status: 'error', reason: error.code || error.message }));
        socket.connect(554, host);
    });
}

export async function probeSurabayaSitsHosts(records, { timeoutSeconds = 5, probe = createTcpHostProbe(timeoutSeconds) } = {}) {
    const uniqueHosts = [...new Set(records.map(record => record.sourceMeta.rtspHost).filter(Boolean))];
    const results = [];

    for (const host of uniqueHosts) {
        results.push(await probe(host));
    }

    return results;
}

export function summarizeSurabayaSitsDataset(records, hostProbes = []) {
    const uniqueHosts = [...new Set(records.map(record => record.sourceMeta.rtspHost).filter(Boolean))];
    const httpFallbackCount = records.filter(record => record.httpFallbackUrl).length;

    return {
        cameraCount: records.length,
        hostCount: uniqueHosts.length,
        rtspCount: records.filter(record => record.rtspUrl).length,
        httpFallbackCount,
        sampleCameraNames: records.slice(0, 5).map(record => record.name),
        hostProbes,
    };
}

export async function extractSurabayaSitsDataset({
    client = createSurabayaSitsHttpClient(),
    timeoutSeconds = SURABAYA_DEFAULT_TIMEOUT_SECONDS,
    probeHosts = false,
    hostProbe,
} = {}) {
    const fetchedAt = new Date().toISOString();
    const records = await fetchSurabayaSitsRecords({ client, timeoutSeconds });
    const hostProbes = probeHosts
        ? await probeSurabayaSitsHosts(records, { timeoutSeconds: Math.min(timeoutSeconds, 5), probe: hostProbe })
        : [];

    return {
        fetchedAt,
        records,
        privatePayload: buildPrivateImportPayload(records, fetchedAt),
        reportPayload: buildSanitizedReportPayload(records, fetchedAt),
        summary: summarizeSurabayaSitsDataset(records, hostProbes),
    };
}

export function parseSurabayaSitsCliArgs(argv) {
    const defaults = buildDefaultSurabayaSitsOutputPaths();
    const args = {
        outPrivate: defaults.privatePath,
        outReport: defaults.reportPath,
        timeoutSeconds: SURABAYA_DEFAULT_TIMEOUT_SECONDS,
        probeHosts: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];

        if (token === '--out-private') {
            args.outPrivate = argv[index + 1];
            index += 1;
            continue;
        }

        if (token === '--out-report') {
            args.outReport = argv[index + 1];
            index += 1;
            continue;
        }

        if (token === '--timeout') {
            args.timeoutSeconds = Number(argv[index + 1]);
            index += 1;
            continue;
        }

        if (token === '--probe-hosts') {
            args.probeHosts = true;
            continue;
        }

        throw new Error(`Unknown argument: ${token}`);
    }

    if (!Number.isFinite(args.timeoutSeconds) || args.timeoutSeconds <= 0) {
        throw new Error('Timeout must be a positive number of seconds');
    }

    return args;
}

export function formatSurabayaSitsSummary(summary, outputPaths) {
    const lines = [
        'Surabaya SITS extractor completed.',
        `Cameras: ${summary.cameraCount}`,
        `RTSP streams: ${summary.rtspCount}`,
        `HTTP fallbacks: ${summary.httpFallbackCount}`,
        `Hosts: ${summary.hostCount}`,
        `Sample cameras: ${summary.sampleCameraNames.join(', ')}`,
        `Private output: ${outputPaths.privatePath}`,
        `Sanitized report: ${outputPaths.reportPath}`,
    ];

    if (summary.hostProbes.length > 0) {
        const hostStatuses = summary.hostProbes.map(probe => `${probe.host}=${probe.status}`).join(', ');
        lines.push(`Host probes: ${hostStatuses}`);
    }

    return lines.join('\n');
}
