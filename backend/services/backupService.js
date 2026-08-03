/**
 * Backup Service
 * Export/Import complete database backup for migration
 */

import { query, queryOne, execute, transaction } from '../database/connectionPool.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Tables a backup may read or write.
 *
 * This list is also the IMPORT WHITELIST. SQL identifiers cannot be bound as parameters, so
 * table/column names reach the statement by interpolation â€” and importBackup's input is the raw
 * request body (admin endpoint), i.e. attacker-controlled. Anything not named here is rejected
 * rather than interpolated. Keep export and import on this one list so they cannot drift.
 */
const BACKUP_TABLES = [
    'users',
    'cameras',
    'areas',
    'audit_logs',
    'feedbacks',
    'api_keys',
    'viewer_sessions',
    'viewer_session_history',
    'system_settings',
    'saweria_settings'
];

/**
 * Describe a whitelisted table: which columns exist, and which form the primary key.
 * `table` MUST already be validated against BACKUP_TABLES before it gets here.
 */
function describeTable(table) {
    const info = query(`PRAGMA table_info(${table})`);
    return {
        validColumns: new Set(info.map((column) => column.name)),
        // `pk` is 0 for non-key columns and 1..n for the position within a composite key.
        primaryKey: info
            .filter((column) => column.pk > 0)
            .sort((a, b) => a.pk - b.pk)
            .map((column) => column.name)
    };
}

/**
 * Export complete database backup
 */
export function exportBackup() {
    try {
        const backup = {
            version: '1.0',
            exported_at: new Date().toISOString(),
            data: {}
        };

        const tables = BACKUP_TABLES;

        tables.forEach(table => {
            try {
                backup.data[table] = query(`SELECT * FROM ${table}`);
            } catch (error) {
                console.warn(`Table ${table} not found or error:`, error.message);
                backup.data[table] = [];
            }
        });

        return {
            success: true,
            backup
        };
    } catch (error) {
        console.error('Export backup error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Import backup data
 * Options:
 * - mode: 'merge' (default) or 'replace'
 * - tables: array of table names to import (default: all)
 */
export function importBackup(backupData, options = {}) {
    const { mode = 'merge', tables = null } = options;

    try {
        // Validate backup format
        if (!backupData.version || !backupData.data) {
            throw new Error('Invalid backup format');
        }

        const results = {
            success: true,
            imported: {},
            skipped: {},
            errors: {},
            // Rows that could not be written because they collided with an EXISTING row on a
            // unique column other than the primary key. Previously such rows were silently
            // destroyed; now they are refused and reported so an operator can decide.
            conflicts: {}
        };

        // Determine which tables to import, dropping anything outside the whitelist.
        const requestedTables = tables || Object.keys(backupData.data);
        const tablesToImport = requestedTables.filter((table) => BACKUP_TABLES.includes(table));
        requestedTables
            .filter((table) => !BACKUP_TABLES.includes(table))
            .forEach((table) => {
                results.skipped[table] = 'Not an allowed backup table';
            });

        // Import in transaction
        const importTxn = transaction(() => {
            tablesToImport.forEach(table => {
                try {
                    const records = backupData.data[table];
                    if (!records || records.length === 0) {
                        results.skipped[table] = 'No data';
                        return;
                    }

                    // Skip sensitive tables in merge mode
                    if (mode === 'merge' && ['users', 'api_keys'].includes(table)) {
                        results.skipped[table] = 'Skipped for security (merge mode)';
                        return;
                    }

                    let imported = 0;
                    const { validColumns, primaryKey } = describeTable(table);
                    const conflicts = [];

                    records.forEach((record, index) => {
                        // Drop keys that are not real columns of this table: they would otherwise
                        // be interpolated into the statement verbatim.
                        const columns = Object.keys(record).filter((column) => validColumns.has(column));
                        if (columns.length === 0) {
                            conflicts.push({ row: index, reason: 'No recognisable columns' });
                            return;
                        }

                        const values = columns.map((column) => record[column]);
                        const placeholders = columns.map(() => '?').join(', ');
                        const columnList = columns.join(', ');

                        let sql;
                        if (mode === 'replace') {
                            /*
                             * NEVER an INSERT-OR-REPLACE upsert. On ANY primary-key *or* UNIQUE conflict
                             * SQLite DELETEs the conflicting row before inserting â€” so restoring a
                             * backup could destroy a live row that merely shared a username/email,
                             * and fire ON DELETE CASCADE on its children. That is exactly how a real
                             * customer row was lost in 2026-06 (see AGENTS.md "Production data safety").
                             *
                             * An upsert targeted at the PRIMARY KEY updates the row in place instead,
                             * and a collision on some other unique column now raises loudly (caught
                             * per row below) rather than silently removing someone else's data.
                             */
                            const updatable = columns.filter((column) => !primaryKey.includes(column));
                            if (primaryKey.length === 0) {
                                // No declared primary key: there is no safe conflict target, so fall
                                // back to insert-only rather than guessing which row to overwrite.
                                sql = `INSERT OR IGNORE INTO ${table} (${columnList}) VALUES (${placeholders})`;
                            } else if (updatable.length === 0) {
                                sql = `INSERT INTO ${table} (${columnList}) VALUES (${placeholders}) `
                                    + `ON CONFLICT(${primaryKey.join(', ')}) DO NOTHING`;
                            } else {
                                sql = `INSERT INTO ${table} (${columnList}) VALUES (${placeholders}) `
                                    + `ON CONFLICT(${primaryKey.join(', ')}) DO UPDATE SET `
                                    + updatable.map((column) => `${column} = excluded.${column}`).join(', ');
                            }
                        } else {
                            // Merge mode: INSERT OR IGNORE (skip duplicates)
                            sql = `INSERT OR IGNORE INTO ${table} (${columnList}) VALUES (${placeholders})`;
                        }

                        try {
                            const result = execute(sql, values);
                            if (result.changes > 0) imported++;
                        } catch (rowError) {
                            // One unwritable row must not abort the rest of the table.
                            conflicts.push({ row: index, reason: rowError.message });
                        }
                    });

                    results.imported[table] = imported;
                    if (conflicts.length > 0) {
                        results.conflicts[table] = conflicts;
                    }
                } catch (error) {
                    console.error(`Import error for table ${table}:`, error);
                    results.errors[table] = error.message;
                }
            });
        });

        importTxn();

        return results;
    } catch (error) {
        console.error('Import backup error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Save backup to file
 */
export function saveBackupToFile(backup, filename = null) {
    try {
        const backupDir = join(__dirname, '..', 'data', 'backups');
        
        // Create backups directory if not exists
        if (!existsSync(backupDir)) {
            mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = filename || `backup_${timestamp}.json`;
        const filePath = join(backupDir, fileName);

        writeFileSync(filePath, JSON.stringify(backup, null, 2));

        return {
            success: true,
            filePath,
            fileName
        };
    } catch (error) {
        console.error('Save backup to file error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Load backup from file
 */
export function loadBackupFromFile(filePath) {
    try {
        const data = readFileSync(filePath, 'utf8');
        const backup = JSON.parse(data);

        return {
            success: true,
            backup
        };
    } catch (error) {
        console.error('Load backup from file error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get backup statistics
 */
export function getBackupStats(backup) {
    const stats = {
        version: backup.version,
        exported_at: backup.exported_at,
        tables: {}
    };

    Object.keys(backup.data).forEach(table => {
        stats.tables[table] = backup.data[table].length;
    });

    return stats;
}

export default {
    exportBackup,
    importBackup,
    saveBackupToFile,
    loadBackupFromFile,
    getBackupStats
};
