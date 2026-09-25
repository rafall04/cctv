/**
 * Purpose: Give every backend test run an ISOLATED SQLite database.
 * Caller: vitest.config.js globalSetup — runs once before workers spawn; workers inherit
 *         process.env, so DATABASE_PATH set here redirects the whole suite.
 * Deps: better-sqlite3 (for a WAL-safe copy), child_process (fresh-boot fallback).
 * MainFuncs: default export (setup) returning teardown.
 * SideEffects: Creates + deletes a temp DB file; spawns setup-db/migrate on CI-fresh checkouts.
 *
 * Why: tests used to run against backend/data/cctv.db — the developer's real dev DB. Two failure
 * modes came from that: writes from tests (connectionPool transaction tests) persisted into dev
 * data, and schema drift in the dev DB broke ~60 recording tests with "no such table".
 */
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_DB = join(BACKEND_ROOT, 'data', 'cctv.db');

export default async function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'rafnet-test-db-'));
    const testDb = join(dir, 'cctv.db');

    if (existsSync(DEV_DB)) {
        // Dev box: snapshot the current dev DB (better-sqlite3 .backup is WAL-safe — a plain
        // file copy can miss uncheckpointed pages). Same data the suite sees today, zero writes.
        const src = new Database(DEV_DB, { readonly: true });
        try {
            await src.backup(testDb);
        } finally {
            src.close();
        }
    } else {
        // CI / fresh checkout: build + migrate a brand-new DB in the temp dir.
        const env = { ...process.env, DATABASE_PATH: testDb };
        execFileSync(process.execPath, [join(BACKEND_ROOT, 'database', 'setup.js')],
            { cwd: BACKEND_ROOT, env, stdio: 'inherit' });
        execFileSync(process.execPath, [join(BACKEND_ROOT, 'database', 'run-all-migrations.js')],
            { cwd: BACKEND_ROOT, env, stdio: 'inherit' });
    }

    process.env.DATABASE_PATH = testDb;

    return () => {
        try {
            // Windows: workers can still hold the DB handle briefly after exit — retry, and
            // never fail the whole run over temp-dir cleanup (the OS reaps %TEMP% anyway).
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch (err) {
            console.warn('[globalSetup] temp DB cleanup skipped:', err.code || err.message);
        }
    };
}
