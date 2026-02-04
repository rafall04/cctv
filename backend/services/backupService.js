/**
 * Backup Service
 * Export/Import complete database backup for migration
 */

import { query, queryOne, execute, transaction } from '../database/database.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

        // Export all tables
        const tables = [
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
            errors: {}
        };

        // Determine which tables to import
        const tablesToImport = tables || Object.keys(backupData.data);

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

                    records.forEach(record => {
                        const columns = Object.keys(record);
                        const values = Object.values(record);
                        const placeholders = columns.map(() => '?').join(', ');

                        if (mode === 'replace') {
                            // Replace mode: INSERT OR REPLACE
                            const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
                            execute(sql, values);
                            imported++;
                        } else {
                            // Merge mode: INSERT OR IGNORE (skip duplicates)
                            const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
                            const result = execute(sql, values);
                            if (result.changes > 0) imported++;
                        }
                    });

                    results.imported[table] = imported;
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
