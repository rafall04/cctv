/**
 * Purpose: Run database migration files safely without recursively invoking aggregate runners.
 *          Applied migrations are recorded in a `schema_migrations` ledger and skipped on the next
 *          run, so `npm run migrate` no longer re-executes every migration on every update — a
 *          future non-idempotent migration cannot silently re-run against a populated buyer DB.
 * Caller: `npm run migrate`, deployment scripts, and migration runner tests.
 * Deps: Node fs/path/url/child_process, better-sqlite3 (ledger), backend/database/migrations.
 * MainFuncs: selectRunnableMigrationFiles, partitionMigrations, ensureDatabaseDirectory, runMigrations.
 * SideEffects: Creates backend/data, the `schema_migrations` table, and spawns migration processes.
 */

import { spawn } from 'child_process';
import { existsSync, readdirSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';

const LEDGER_TABLE = 'schema_migrations';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, 'migrations');
const databaseDir = dirname(resolveDbPath());

const AGGREGATE_MIGRATION_RUNNERS = new Set([
    'run_all_migrations.js',
]);

export function selectRunnableMigrationFiles(files) {
    return files
        .filter((file) => file.endsWith('.js'))
        .filter((file) => !AGGREGATE_MIGRATION_RUNNERS.has(file))
        .sort();
}

export function ensureDatabaseDirectory(targetDir = databaseDir) {
    if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
    }
}

export function getMigrationFiles(targetMigrationsDir = migrationsDir) {
    return selectRunnableMigrationFiles(readdirSync(targetMigrationsDir));
}

/** Pure split of migration files into the ones still to run vs the count already in the ledger. */
export function partitionMigrations(files, appliedSet) {
    const applied = appliedSet instanceof Set ? appliedSet : new Set(appliedSet || []);
    const pending = files.filter((file) => !applied.has(file));
    return { pending, skipped: files.length - pending.length };
}

function openLedger(dbPath) {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    return db;
}

function runMigration(migrationPath) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn('node', [migrationPath], {
            stdio: 'inherit',
            shell: true,
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            reject(new Error(`Migration exited with code ${code}`));
        });

        child.on('error', reject);
    });
}

async function runMigrationFile({ file, targetMigrationsDir }) {
    const migrationPath = join(targetMigrationsDir, file);
    console.log(`\n[Migration] Running: ${file}`);
    console.log('-'.repeat(60));
    await runMigration(migrationPath);
    console.log(`[Migration] Success: ${file}`);
}

export async function runMigrations({
    targetMigrationsDir = migrationsDir,
    targetDatabaseDir = databaseDir,
    dbPath = resolveDbPath(),
    logger = console,
} = {}) {
    ensureDatabaseDirectory(targetDatabaseDir);

    const migrationFiles = getMigrationFiles(targetMigrationsDir);

    // Ledger: which migrations already ran. On the FIRST run against an existing DB the ledger is
    // empty, so every (still self-guarding, idempotent) migration re-runs once and is recorded;
    // from then on only NEW files run. Records ONLY on success, so a failed migration is retried.
    const ledger = openLedger(dbPath);
    const applied = new Set(ledger.prepare(`SELECT filename FROM ${LEDGER_TABLE}`).all().map((r) => r.filename));
    const insertApplied = ledger.prepare(`INSERT OR IGNORE INTO ${LEDGER_TABLE} (filename) VALUES (?)`);
    const record = (file) => {
        try { insertApplied.run(file); } catch (e) { logger.warn(`[Migration] Ledger write failed (${file}): ${e.message}`); }
    };

    const { pending, skipped } = partitionMigrations(migrationFiles, applied);
    logger.log('Running database migrations');
    logger.log(`Found ${migrationFiles.length} migration files — ${skipped} already applied, ${pending.length} to run`);
    pending.forEach((file, index) => logger.log(`  ${index + 1}. ${file}`));

    const failed = [];
    const deferred = [];

    for (const file of pending) {
        try {
            await runMigrationFile({ file, targetMigrationsDir });
            record(file);
        } catch (error) {
            deferred.push(file);
            logger.warn(`[Migration] Deferred: ${file} (${error.message})`);
        }
    }

    // One retry pass for the deferred set only — covers a legacy migration whose dependency sorted
    // after it. A migration that succeeds here is recorded and never retried again. (Migrations
    // SHOULD be transactional + idempotent so a partial-then-throw cannot double-apply on retry.)
    if (deferred.length > 0) {
        logger.log('\nRetrying deferred migrations (dependency order)');
        for (const file of deferred) {
            try {
                await runMigrationFile({ file, targetMigrationsDir });
                record(file);
            } catch (error) {
                failed.push({ file, error: error.message });
                logger.error(`[Migration] Failed: ${file} (${error.message})`);
            }
        }
    }

    ledger.close();

    if (failed.length > 0) {
        const error = new Error(`Failed migrations: ${failed.map((item) => item.file).join(', ')}`);
        error.failed = failed;
        throw error;
    }

    logger.log(`\nAll migrations completed successfully (${pending.length} applied, ${skipped} already recorded)`);
    return { successful: pending.length, skipped, failed: 0 };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === __filename) {
    runMigrations().catch((error) => {
        console.error('\nFatal error running migrations:', error.message);
        if (error.failed) {
            error.failed.forEach(({ file, error: itemError }) => {
                console.error(`- ${file}: ${itemError}`);
            });
        }
        process.exit(1);
    });
}
