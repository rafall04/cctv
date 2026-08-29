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

/**
 * Send SIGTERM and wait for the process to actually leave.
 *
 * Shutdown had no coverage at all, which is where a whole class of bug lives: every stage
 * of it is a best-effort cleanup, so one stage throwing can silently skip the ones after
 * it — including closing the database. Booting a process and then killing it with SIGKILL
 * (as this file used to) proves nothing about that path.
 */
async function terminate(child, out, timeoutMs = 20_000) {
    child.kill('SIGTERM');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !out.exited) {
        await new Promise((r) => setTimeout(r, 100));
    }
    return out.exited;
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
        // Boot the worker in its production role (RECORDING_WORKER_ENABLED=true). Without the flag
        // it now deliberately IDLES and records nothing, so the API can own recording alone — the
        // single-owner guard that stops a fresh install from double-recording. It has no HTTP
        // surface, so readiness is its own log line.
        const { child, out } = launch('recorder.js', baseEnv(dbPath, { RECORDING_WORKER_ENABLED: 'true' }));
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

    it('recorder.js IDLES (records nothing, stays alive) when RECORDING_WORKER_ENABLED is not "true" — fresh-install single-owner guard', async () => {
        expect(existsSync(SOURCE_DB), `${SOURCE_DB} missing — run npm run setup-db first`).toBe(true);

        const { dir, dbPath } = makeThrowawayDb();
        // The fresh-install default: flag unset (pinned to '' so a CI env cannot leak a value in).
        // The API owns recording here; this worker must NOT also spawn ffmpeg, or every camera gets
        // two recorders on the same directory — the corruption this guard exists to prevent.
        const { child, out } = launch('recorder.js', baseEnv(dbPath, { RECORDING_WORKER_ENABLED: '' }));
        spawned.push({ child, dir });

        const idled = await waitFor(
            async () => out.stdout.includes('will NOT record'),
            out,
            READY_TIMEOUT_MS,
        );
        expect(idled, report('recorder.js did not idle when worker mode was off', out)).toBe(true);

        await new Promise((r) => setTimeout(r, STAY_ALIVE_MS));

        // Alive (no pm2 restart-loop), and it never touched the recording pipeline.
        expect(out.exited, report('recorder.js idle did not stay alive', out)).toBeNull();
        expect(out.stdout, report('recorder.js idle reached worker-ready', out)).not.toContain(RECORDER_BOOT_COMPLETE);
        expect(out.stdout, report('recorder.js idle started recording', out)).not.toContain('Auto-start complete');
    }, READY_TIMEOUT_MS + STAY_ALIVE_MS + 30_000);
});

/*
 * SHUTDOWN SMOKE — the other half nothing covered.
 *
 * Every shutdown stage is a best-effort cleanup, so an unguarded throw in an early stage
 * silently skips the ones after it, database close included. Booting a process and then
 * SIGKILLing it (which is all this file used to do) proves nothing about that path.
 *
 * POSIX only, and skipped rather than weakened on Windows: `child.kill('SIGTERM')` there
 * maps to TerminateProcess, so the child never runs its handler at all — it exits with
 * code=null signal=SIGTERM no matter how correct the shutdown code is. Asserting anything
 * about shutdown on Windows would be asserting on the OS, not on this project. CI runs
 * ubuntu-latest and production is Ubuntu, so this does run where it counts.
 */
const describeShutdown = process.platform === 'win32' ? describe.skip : describe;

describeShutdown('shutdown smoke (POSIX only)', () => {
    it('server.js closes its database and exits 0 on SIGTERM', async () => {
        const { dir, dbPath } = makeThrowawayDb();
        const port = await freePort();
        const { child, out } = launch('server.js', baseEnv(dbPath, {
            PORT: String(port),
            HOST: '127.0.0.1',
            RECORDING_WORKER_ENABLED: 'false',
        }));
        spawned.push({ child, dir });

        const booted = await waitFor(
            async () => out.stdout.includes(SERVER_BOOT_COMPLETE),
            out,
            READY_TIMEOUT_MS
        );
        expect(booted, report('server.js never finished booting', out)).toBe(true);

        const exited = await terminate(child, out);
        expect(exited, report('server.js did not exit on SIGTERM', out)).not.toBeNull();
        expect(exited.code, report('server.js exited non-zero on SIGTERM', out)).toBe(0);
        expect(out.stdout, report('server.js did not close its database', out))
            .toContain('[Shutdown] Database connections closed');
        expect(out.stdout, report('server.js did not finish shutting down', out))
            .toContain('Graceful shutdown completed');
    }, READY_TIMEOUT_MS + 60_000);

    it('recorder.js detaches its recorders AND closes its database on SIGTERM', async () => {
        const { dir, dbPath } = makeThrowawayDb();
        // Worker role so it actually owns recorders to detach (see the readiness test above).
        const { child, out } = launch('recorder.js', baseEnv(dbPath, { RECORDING_WORKER_ENABLED: 'true' }));
        spawned.push({ child, dir });

        const ready = await waitFor(
            async () => out.stdout.includes(RECORDER_BOOT_COMPLETE),
            out,
            READY_TIMEOUT_MS
        );
        expect(ready, report('recorder.js readiness', out)).toBe(true);

        const exited = await terminate(child, out);

        expect(exited, report('recorder.js did not exit on SIGTERM', out)).not.toBeNull();
        expect(exited.code, report('recorder.js exited non-zero on SIGTERM', out)).toBe(0);
        // Detach must happen (ffmpeg survives the restart) AND the DB must still close after
        // it — those were one try block, so a throw in the first took the second with it.
        expect(out.stdout, report('recorder.js did not detach its recorders', out))
            .toContain('[Recorder] Detached');
        /*
         * Asserted on the SYNCHRONOUS end-of-shutdown marker, not on the connection pool's
         * own log line. That line is a console.log into a pm2 pipe immediately before
         * process.exit(), so Node discards it — measured: the pool's "All connections closed"
         * never made it out, even though the close itself ran. Asserting on it would have
         * been asserting on buffer timing.
         */
        expect(out.stdout, report('recorder.js did not report a clean shutdown', out))
            .toContain('[Recorder] Shutdown complete');
    }, READY_TIMEOUT_MS + 60_000);
});
