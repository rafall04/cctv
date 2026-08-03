/**
 * Purpose: Pin connectionPool's read-your-own-writes guarantee against a real SQLite file.
 * Caller: Vitest backend suite.
 * Deps: better-sqlite3, database/connectionPool (imported against a temp DATABASE_PATH).
 * MainFuncs: query, queryOne, execute, transaction.
 * SideEffects: Creates and deletes a temp database under the OS temp dir.
 *
 * WHY THIS IS AN INTEGRATION TEST
 * -------------------------------
 * Every other DB test in this suite mocks the connection layer, which is exactly why the
 * behaviour below went unnoticed until production surfaced it: a mock cannot reproduce
 * SQLite's transaction visibility rules. These assertions only mean anything against a
 * real file, so this test opens one.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir;
let pool;
let previousDatabasePath;

beforeAll(async () => {
    // vitest can share a worker process across test files, so DATABASE_PATH must be put
    // back exactly as it was — pointing it at a temp dir that afterAll then deletes made
    // an unrelated test fail with "disk I/O error" the first time this ran.
    previousDatabasePath = process.env.DATABASE_PATH;
    dir = mkdtempSync(join(tmpdir(), 'cpool-'));
    const dbFile = join(dir, 'probe.db');

    // The read pool opens with fileMustExist:true, so seed a real schema first.
    const seed = new Database(dbFile);
    seed.pragma('journal_mode = WAL');
    seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    seed.close();

    process.env.DATABASE_PATH = dbFile;
    pool = await import('../database/connectionPool.js');
});

afterAll(() => {
    pool?.closeAll();
    if (previousDatabasePath === undefined) {
        delete process.env.DATABASE_PATH;
    } else {
        process.env.DATABASE_PATH = previousDatabasePath;
    }
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch { /* windows may hold the handle briefly; the temp dir is disposable */ }
});

describe('connectionPool read-after-write', () => {
    it('sees a committed write from the read pool (this always worked)', () => {
        pool.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'alpha']);
        expect(pool.queryOne('SELECT v FROM t WHERE id = ?', [1])).toEqual({ v: 'alpha' });
    });

    /*
     * THE REGRESSION.
     *
     * The read pool is made of separate `readonly` connections, so rows written inside an
     * open transaction — not yet committed — were invisible to them. cameraHealthService
     * upserts runtime state for every camera inside ONE transaction and reads each row
     * back; the read returned undefined and production logged 22 x "[CameraHealth] Check
     * failed: Cannot read properties of undefined (reading 'last_runtime_signal_at')".
     * Sharing the transaction meant one camera rolled back the entire tick.
     */
    it('REGRESSION: queryOne inside a transaction sees the uncommitted write', () => {
        let seenInside;
        pool.transaction(() => {
            pool.execute('INSERT INTO t (id, v) VALUES (?, ?)', [2, 'beta']);
            seenInside = pool.queryOne('SELECT v FROM t WHERE id = ?', [2]);
        })();

        expect(seenInside).toEqual({ v: 'beta' });
        expect(pool.queryOne('SELECT v FROM t WHERE id = ?', [2])).toEqual({ v: 'beta' });
    });

    it('REGRESSION: query inside a transaction counts the uncommitted rows', () => {
        const before = pool.query('SELECT id FROM t').length;
        let seenInside = -1;
        pool.transaction(() => {
            pool.execute('INSERT INTO t (id, v) VALUES (?, ?)', [3, 'gamma']);
            seenInside = pool.query('SELECT id FROM t').length;
        })();

        expect(seenInside).toBe(before + 1);
    });

    it('a rolled back transaction leaves nothing behind', () => {
        const before = pool.query('SELECT id FROM t').length;
        expect(() => pool.transaction(() => {
            pool.execute('INSERT INTO t (id, v) VALUES (?, ?)', [99, 'doomed']);
            // Reading it back must work right up until the throw.
            expect(pool.queryOne('SELECT v FROM t WHERE id = ?', [99])).toEqual({ v: 'doomed' });
            throw new Error('rollback');
        })()).toThrow('rollback');

        expect(pool.query('SELECT id FROM t').length).toBe(before);
        expect(pool.queryOne('SELECT v FROM t WHERE id = ?', [99])).toBeUndefined();
    });

    it('returns to the read pool once the transaction commits', () => {
        pool.transaction(() => {
            pool.execute('INSERT INTO t (id, v) VALUES (?, ?)', [4, 'delta']);
        })();

        expect(pool.pool.inWriteTransaction()).toBe(false);
        expect(pool.queryOne('SELECT v FROM t WHERE id = ?', [4])).toEqual({ v: 'delta' });
    });

    /*
     * Documents the measured reality behind the pool sizing. better-sqlite3 is synchronous,
     * so a query always releases its connection before the next one asks — the pool never
     * grows past one, whatever maxReadConnections says.
     */
    it('never opens more than one read connection, because reads cannot overlap', () => {
        for (let i = 0; i < 20; i += 1) {
            pool.query('SELECT 1');
        }
        expect(pool.getStats().readPoolSize).toBe(1);
    });
});
