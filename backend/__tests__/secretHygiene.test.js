/**
 * Purpose: Repo-wide secret-hygiene guardrail — CI fails if a credential-shaped string lands
 *          in a tracked file. Written after the 2026-09 audit found a REAL Surabaya camera
 *          credential (edishub:…) committed inside a decrypt fixture, and an admin-looking
 *          password inside logRedaction.test.js. Both are scrubbed; this keeps them gone.
 * Caller: backend test gate (runs in the full suite).
 * Deps: none — walks the working tree.
 * MainFuncs: scan rules — private-key blocks, known token signatures, URL userinfo passwords.
 * SideEffects: read-only filesystem walk.
 *
 * IMPORTANT: a finding must NEVER echo the secret itself into test output — we print
 * file:line + rule name only, so CI logs stay clean even when the repo is dirty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set([
    'node_modules', '.git', '.claude', '.worktrees', 'data', 'recordings', 'dist', 'build',
    'coverage', 'logs', 'tmp', 'temp', 'backups', 'private_exports', '.vscode', '.idea',
]);
const SKIP_FILES = /(^|\/)\.env(\.|$)|package-lock\.json|\.min\.(js|css)$/;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp4|mp3|webm|db|sqlite3?|zip|gz|tar|7z|pdf|bin|so|dll|exe|map|pyc|pyo)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Obvious fixture values only — a REAL password must never appear here. Compared lowercased.
const PLACEHOLDER_PASSWORDS = new Set([
    'secret', 'pass', 'password', 'pw', 'pwd', 'rahasia', 'hunter2', 'wrong', 'old', 'new',
    'test', 'testpass', 'changeme', 'admin', 'user', 'fake', 'fakepass', 'fixturepass9',
    'dummy', 'placeholder', 'redacted', 'masked', 'example', 'supersecret123', 'demo', 'sample',
    'x', 'xx', 'xxx', 'xxxx', '***', '****', '*****', 'none', 'null', 'undefined', 'bar', 'foo',
    'p%40ss', 'p@ssw0rd', 'passw0rd', '1234', '12345', '123456', 'letmein', 'qwerty', 'nope',
    'notreal', 'mypassword', 'your_password', 'your-password', 'password123', 'secret123',
]);

const RULES = [
    {
        name: 'private-key-block',
        re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/,
    },
    {
        name: 'cloud-or-vendor-token',
        re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bghp_[0-9A-Za-z]{30,}|\bgithub_pat_[0-9A-Za-z_]{22,}|\bxox[baprs]-[0-9A-Za-z-]{10,}|\bAIza[0-9A-Za-z_-]{35}|\bsk-[A-Za-z0-9]{20,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
    },
    {
        // user:pass@ inside a URL — the exact shape that leaked real camera creds twice.
        name: 'url-userinfo-credential',
        re: /\b(?:rtsp|rtmp|rtmps|https?|ftps?|mqtts?|onvif|tcp):\/\/([^\s/:@'"<>]+):([^\s/@'"<>]{3,})@/g,
        check: (m) => {
            const password = m[2];
            if (PLACEHOLDER_PASSWORDS.has(password.toLowerCase())) return null;
            if (/[$*{}<>()[\]^]/.test(password) || /[$*{}<>()[\]^]/.test(m[1])) return null; // template refs, masks, and regex literals like rtsp://([^:]+):([^@]+)@
            return `non-placeholder password (${password.length} chars)`;
        },
    },
];

function* walk(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) yield* walk(full);
        } else if (entry.isFile() && !BINARY_EXT.test(entry.name) && !SKIP_FILES.test(full)) {
            yield full;
        }
    }
}

/*
 * The guardrail guards what git carries, not what an operator dumped locally — enumerate
 * TRACKED files via `git ls-files` (which also answers "is this .env really committed?"),
 * falling back to the filesystem walk where git isn't installed.
 */
function* candidateFiles() {
    try {
        const out = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 });
        for (const rel of out.split('\n').filter(Boolean)) {
            const full = path.join(REPO_ROOT, rel);
            if (!BINARY_EXT.test(rel) && !SKIP_FILES.test(rel)) yield full;
        }
    } catch {
        yield* walk(REPO_ROOT);
    }
}

describe('guardrail: secret hygiene (no credentials committed to the repo)', () => {
    it('no file contains a private key, vendor token, or non-placeholder URL credential', () => {
        const findings = [];
        for (const file of candidateFiles()) {
            let stat;
            try { stat = fs.statSync(file); } catch { continue; }
            if (stat.size > MAX_FILE_BYTES) continue;

            const content = fs.readFileSync(file, 'utf8');
            const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
            for (const rule of RULES) {
                rule.re.lastIndex = 0;
                let m;
                while ((m = rule.re.exec(content)) !== null) {
                    const detail = rule.check ? rule.check(m) : null;
                    if (rule.check && detail === null) continue;
                    const line = content.slice(0, m.index).split('\n').length;
                    // Never print m[0] — it IS the secret.
                    findings.push(`${rel}:${line} [${rule.name}]${detail ? ` ${detail}` : ''}`);
                    if (rule.re.global === false) break;
                }
            }
        }
        expect(findings, `\nSecret-shaped content found (rotate the credential, then replace with a placeholder):\n  ${findings.join('\n  ')}\n`).toEqual([]);
    });
});
