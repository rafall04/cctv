/**
 * Purpose: Run database migration files safely without recursively invoking aggregate runners.
 * Caller: `npm run migrate`, deployment scripts, and migration runner tests.
 * Deps: Node fs/path/url/child_process, backend/database/migrations.
 * MainFuncs: selectRunnableMigrationFiles, ensureDatabaseDirectory, runMigrations.
 * SideEffects: Creates backend/data and spawns migration Node processes when run as CLI.
 */

import { spawn } from 'child_process';
import { existsSync, readdirSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, 'migrations');
const databaseDir = join(__dirname, '..', 'data');

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
    logger = console,
} = {}) {
    ensureDatabaseDirectory(targetDatabaseDir);

    const migrationFiles = getMigrationFiles(targetMigrationsDir);
    logger.log('Running database migrations');
    logger.log(`Found ${migrationFiles.length} migration files`);
    migrationFiles.forEach((file, index) => logger.log(`  ${index + 1}. ${file}`));

    const failed = [];
    const skipped = [];

    for (const file of migrationFiles) {
        try {
            await runMigrationFile({ file, targetMigrationsDir });
        } catch (error) {
            skipped.push(file);
            logger.warn(`[Migration] Deferred: ${file} (${error.message})`);
        }
    }

    if (skipped.length > 0) {
        logger.log('\nRetrying deferred migrations');
        for (const file of skipped) {
            try {
                await runMigrationFile({ file, targetMigrationsDir });
            } catch (error) {
                failed.push({ file, error: error.message });
                logger.error(`[Migration] Failed: ${file} (${error.message})`);
            }
        }
    }

    if (failed.length > 0) {
        const error = new Error(`Failed migrations: ${failed.map((item) => item.file).join(', ')}`);
        error.failed = failed;
        throw error;
    }

    logger.log('\nAll migrations completed successfully');
    return { successful: migrationFiles.length, failed: 0 };
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
