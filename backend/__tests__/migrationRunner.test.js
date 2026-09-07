/**
 * Purpose: Validate database migration runner file selection and data directory preparation.
 * Caller: Backend Vitest suite before migration runner changes.
 * Deps: database/run-all-migrations.js pure helpers.
 * MainFuncs: selectRunnableMigrationFiles, ensureDatabaseDirectory.
 * SideEffects: Creates temporary test directories only.
 */
import { mkdtemp, rm, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
    ensureDatabaseDirectory,
    partitionMigrations,
    selectRunnableMigrationFiles,
} from '../database/run-all-migrations.js';

describe('migration runner helpers', () => {
    it('excludes aggregate runner scripts from runnable migration files', () => {
        const files = selectRunnableMigrationFiles([
            '001_migrate_security.js',
            'add_settings_table.js',
            'run_all_migrations.js',
            'notes.md',
        ]);

        expect(files).toEqual([
            '001_migrate_security.js',
            'add_settings_table.js',
        ]);
    });

    it('runs recording segment uniqueness after the recording system table migration', () => {
        const files = selectRunnableMigrationFiles([
            'zz_20260503_add_recording_segment_uniqueness.js',
            'add_recording_system.js',
        ]);

        expect(files).toEqual([
            'add_recording_system.js',
            'zz_20260503_add_recording_segment_uniqueness.js',
        ]);
    });

    it('runs only migrations not yet in the ledger', () => {
        const files = ['a.js', 'b.js', 'c.js'];
        const { pending, skipped } = partitionMigrations(files, new Set(['a.js', 'c.js']));
        expect(pending).toEqual(['b.js']);
        expect(skipped).toBe(2);
    });

    it('runs everything on a fresh (empty) ledger', () => {
        const files = ['a.js', 'b.js'];
        const { pending, skipped } = partitionMigrations(files, new Set());
        expect(pending).toEqual(['a.js', 'b.js']);
        expect(skipped).toBe(0);
    });

    it('creates the database directory before SQLite migrations open the DB file', async () => {
        const baseDir = await mkdtemp(join(tmpdir(), 'cctv-migrations-'));
        const dataDir = join(baseDir, 'backend', 'data');

        await ensureDatabaseDirectory(dataDir);

        const dataDirStat = await stat(dataDir);
        expect(dataDirStat.isDirectory()).toBe(true);

        await rm(baseDir, { recursive: true, force: true });
    });
});
