/**
 * Purpose: Actually BOOT server.js and recorder.js as real processes and prove they
 *          stay up — the one class of failure the rest of the suite structurally cannot see.
 * Caller: Vitest backend suite (and CI).
 * Deps: child_process, a throwaway copy of the dev DB, a free TCP port.
 * SideEffects: Spawns real node processes against a temp DB; kills them afterwards.
 *              Never touches the real DB, never spawns ffmpeg (all cameras disabled).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * On 2026-07-27 commit 0413b4b left server.js syntactically valid but fatally broken
 * at boot: `thumbnailService.archiveCache.scheduleSweep(...)`. `node --check` passed.
 * All 1194 unit tests passed. Production then crash-looped every ~70 seconds for
 * 7h36m, destroying every in-flight recording segment, because NOT ONE TEST HAS EVER
 * EXECUTED server.js.
 *
 * Unit tests mock the module graph, so they can only prove the pieces work in
 * isolation. Nothing proved the pieces still work when actually wired together and
 * run. That is exactly what this file does, and it is deliberately crude: start the
 * real process, wait for it to serve, then WAIT LONGER and check it is still alive.
 *
 * The "wait longer" is the whole point. The old deploy gate declared success on the
 * first /health 200 (~40s max) while the crash landed at ~67s — it was structurally
 * blind. A boot check that stops at "it answered once" would not have caught this.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { createServer } from 'net';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(__dirname, '..');
const SOURCE_DB = join(BACKEND_DIR, 'data', 'cctv.db');

// Margin held AFTER the process reports its boot actually finished.
//
// Deliberately not a guess at "how long is the boot tail". An earlier version of this
// file waited a fixed 12s after /health went green and PASSED with the real 0413b4b bug
// reintroduced — measured, that crash lands at t=23.4s while /health answers at t=3.2s.
// Any fixed window is a guess that silently rots as boot work is added. So the test
// waits for an explicit end-of-boot marker instead, and this margin only has to cover
// "died immediately after finishing".
const STAY_ALIVE_MS = 8_000;
const READY_TIMEOUT_MS = 120_000;

// Last line each entry point prints once every background service is up.
const SERVER_BOOT_COMPLETE = '[Server] Startup complete';
const RECORDER_BOOT_COMPLETE = '[Recorder] Worker ready';

const spawned = [];

afterEach(() => {
    for (const { child, dir } of spawned.splice(0)) {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
});

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

/**
 * Throwaway DB: a copy of the dev database with every camera disabled, so booting
 * cannot spawn ffmpeg, reach a real camera, or mutate anything real.
 */
function makeThrowawayDb() {
    const dir = mkdtempSync(join(tmpdir(), 'bootsmoke-'));
    const dbPath = join(dir, 'cctv.db');
    copyFileSync(SOURCE_DB, dbPath);

    const db = new Database(dbPath);
    try {
        db.exec('UPDATE cameras SET enable_recording = 0, enabled = 0');
    } catch { /* fresh DB may have no cameras table yet — nothing to disable */ }
    db.close();

    return { dir, dbPath };
}

function baseEnv(dbPath, extra = {}) {
    return {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_PATH: dbPath,
        // Strong values so the secure-config boot guard is satisfied and cannot be the
        // reason a boot failure shows up here.
        JWT_SECRET: 'a'.repeat(64),
        JWT_REFRESH_SECRET: 'b'.repeat(64),
        CSRF_SECRET: 'c'.repeat(64),
        API_KEY_SECRET: 'd'.repeat(64),
        SESSION_SECRET: 'e'.repeat(64),
        // Keep the boot self-contained: no Telegram polling, no outbound alerts.
        TELEGRAM_BOT_TOKEN: '',
        TELEGRAM_MONITORING_CHAT_ID: '',
        RECORDING_HEALTH_ALERTS_ENABLED: 'false',
        ...extra,
    };
}

function launch(script, env, cwd = BACKEND_DIR) {
    const child = spawn(process.execPath, [script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = { stdout: '', stderr: '', exited: null };

    child.stdout.on('data', (d) => { out.stdout += d.toString(); });
    child.stderr.on('data', (d) => { out.stderr += d.toString(); });
    child.on('exit', (code, signal) => { out.exited = { code, signal }; });

    return { child, out };
}

/** Poll until predicate passes, the process dies, or we run out of time. */
async function waitFor(predicate, out, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (out.exited) return false;
        if (await predicate()) return true;
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

function report(label, out) {
    return [
        `${label} did not stay up.`,
        out.exited ? `exit: code=${out.exited.code} signal=${out.exited.signal}` : 'exit: (still running)',
        '--- stderr (tail) ---',
        out.stderr.slice(-3000) || '(empty)',
        '--- stdout (tail) ---',
        out.stdout.slice(-2000) || '(empty)',
    ].join('\n');
}

describe('boot smoke', () => {
    it('server.js serves /health AND is still alive after the boot tail', async () => {
        expect(existsSync(SOURCE_DB), `${SOURCE_DB} missing — run npm run setup-db first`).toBe(true);

        const { dir, dbPath } = makeThrowawayDb();
        const port = await freePort();
        const { child, out } = launch('server.js', baseEnv(dbPath, {
            PORT: String(port),
            HOST: '127.0.0.1',
            RECORDING_WORKER_ENABLED: 'false',
        }));
        spawned.push({ child, dir });

        const healthy = await waitFor(async () => {
            try {
                const res = await fetch(`http://127.0.0.1:${port}/health`);
                return res.ok;
            } catch {
                return false;
            }
        }, out, READY_TIMEOUT_MS);

        expect(healthy, report('server.js /health', out)).toBe(true);

        // THE ACTUAL ASSERTION. Answering /health proves only that the port is bound;
        // 0413b4b served health for 20+ seconds before dying in the boot tail. Require
        // the process to say it FINISHED starting.
        const bootComplete = await waitFor(
            async () => out.stdout.includes(SERVER_BOOT_COMPLETE),
            out,
            READY_TIMEOUT_MS
        );
        expect(bootComplete, report('server.js never finished booting', out)).toBe(true);

        await new Promise((r) => setTimeout(r, STAY_ALIVE_MS));

        expect(out.exited, report('server.js after boot tail', out)).toBeNull();
        expect(out.stderr, report('server.js logged a fatal', out)).not.toContain('[Fatal]');

        // Still serving, not just still resident.
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        expect(res.ok).toBe(true);
    }, READY_TIMEOUT_MS + STAY_ALIVE_MS + 30_000);

    it('recorder.js reaches "Worker ready" AND is still alive after the boot tail', async () => {
        expect(existsSync(SOURCE_DB), `${SOURCE_DB} missing — run npm run setup-db first`).toBe(true);

        const { dir, dbPath } = makeThrowawayDb();
        // recorder.js sets RECORDING_WORKER_ENABLED itself; it has no HTTP surface, so
        // readiness is its own log line.
        const { child, out } = launch('recorder.js', baseEnv(dbPath));
        spawned.push({ child, dir });

        const ready = await waitFor(
            async () => out.stdout.includes(RECORDER_BOOT_COMPLETE),
            out,
            READY_TIMEOUT_MS
        );

        expect(ready, report('recorder.js readiness', out)).toBe(true);

        await new Promise((r) => setTimeout(r, STAY_ALIVE_MS));

        expect(out.exited, report('recorder.js after boot tail', out)).toBeNull();
        expect(out.stderr, report('recorder.js logged a fatal', out)).not.toContain('[Fatal]');

        // With every camera disabled it must not have started any recorder.
        expect(out.stdout).toContain('Auto-start complete: 0 started');
    }, READY_TIMEOUT_MS + STAY_ALIVE_MS + 30_000);
});
