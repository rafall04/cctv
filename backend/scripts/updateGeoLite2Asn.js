/**
 * Purpose: Download and atomically install the local MaxMind GeoLite2 ASN database.
 * Caller: npm run update:geolite2-asn, operators, deployment automation.
 * Deps: Node fs/path/https/child_process/os modules and system tar command.
 * MainFuncs: buildDownloadUrl, updateGeoLite2Asn, main.
 * SideEffects: Writes backend/data/GeoLite2-ASN.mmdb when a valid MaxMind license key is provided.
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs';
import { copyFile, mkdir } from 'fs/promises';
import https from 'https';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_ROOT = resolve(__dirname, '..');
const DEFAULT_OUTPUT_PATH = resolve(BACKEND_ROOT, 'data', 'GeoLite2-ASN.mmdb');
const EDITION_ID = 'GeoLite2-ASN';

export function buildDownloadUrl(licenseKey) {
    const url = new URL('https://download.maxmind.com/app/geoip_download');
    url.searchParams.set('edition_id', EDITION_ID);
    url.searchParams.set('license_key', licenseKey);
    url.searchParams.set('suffix', 'tar.gz');
    return url.toString();
}

function printHelp() {
    console.log(`
Usage: npm run update:geolite2-asn -- [--output <path>] [--dry-run]

Environment:
  MAXMIND_LICENSE_KEY   Required MaxMind account license key.

Options:
  --output <path>       Destination mmdb path. Defaults to backend/data/GeoLite2-ASN.mmdb.
  --dry-run             Validate inputs and print target path without downloading.
  --help                Show this help.
`.trim());
}

function parseArgs(argv) {
    const args = { output: DEFAULT_OUTPUT_PATH, dryRun: false, help: false };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else if (arg === '--dry-run') {
            args.dryRun = true;
        } else if (arg === '--output') {
            args.output = resolve(argv[index + 1] || '');
            index += 1;
        }
    }

    return args;
}

function downloadFile(url, destination) {
    return new Promise((resolveDownload, rejectDownload) => {
        const file = createWriteStream(destination);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                rejectDownload(new Error(`MaxMind download failed with HTTP ${response.statusCode}`));
                response.resume();
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close(resolveDownload);
            });
        }).on('error', rejectDownload);
    });
}

function runTarExtract(archivePath, outputDir) {
    return new Promise((resolveExtract, rejectExtract) => {
        const child = spawn('tar', ['-xzf', archivePath, '-C', outputDir], { stdio: 'inherit' });
        child.on('error', rejectExtract);
        child.on('close', (code) => {
            if (code === 0) {
                resolveExtract();
                return;
            }

            rejectExtract(new Error(`tar extraction failed with exit code ${code}`));
        });
    });
}

function findMmdbFile(directory) {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            const nested = findMmdbFile(fullPath);
            if (nested) {
                return nested;
            }
        } else if (entry.name === `${EDITION_ID}.mmdb`) {
            return fullPath;
        }
    }

    return null;
}

export async function updateGeoLite2Asn({ licenseKey, outputPath = DEFAULT_OUTPUT_PATH, dryRun = false } = {}) {
    if (!licenseKey) {
        const error = new Error('MAXMIND_LICENSE_KEY is required');
        error.statusCode = 2;
        throw error;
    }

    const resolvedOutput = resolve(outputPath);
    const downloadUrl = buildDownloadUrl(licenseKey);

    if (dryRun) {
        return { outputPath: resolvedOutput, downloadUrl };
    }

    const workDir = join(tmpdir(), `geolite2-asn-${Date.now()}`);
    const archivePath = join(workDir, `${EDITION_ID}.tar.gz`);
    const stagingPath = `${resolvedOutput}.tmp`;

    mkdirSync(workDir, { recursive: true });
    try {
        await mkdir(dirname(resolvedOutput), { recursive: true });
        await downloadFile(downloadUrl, archivePath);
        await runTarExtract(archivePath, workDir);

        const mmdbPath = findMmdbFile(workDir);
        if (!mmdbPath || !existsSync(mmdbPath)) {
            throw new Error('GeoLite2-ASN.mmdb was not found in the downloaded archive');
        }

        await copyFile(mmdbPath, stagingPath);
        renameSync(stagingPath, resolvedOutput);
        return { outputPath: resolvedOutput, downloadUrl };
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const result = await updateGeoLite2Asn({
        licenseKey: process.env.MAXMIND_LICENSE_KEY,
        outputPath: args.output,
        dryRun: args.dryRun,
    });

    console.log(args.dryRun
        ? `GeoLite2 ASN dry-run OK: ${result.outputPath}`
        : `GeoLite2 ASN updated: ${result.outputPath}`);
}

if (process.argv[1] === __filename) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(error.statusCode || 1);
    });
}
