/**
 * Purpose: Add ASN/ISP persistence to viewer session tables and create configurable ASN access policies.
 * Caller: backend/database/migrations/run_all_migrations.js.
 * Deps: better-sqlite3, SQLite database file backend/data/cctv.db.
 * MainFuncs: ensureViewerNetworkIdentityColumns, ensureHistoryArchiveTables, ensureAsnAccessPoliciesTable.
 * SideEffects: Adds new schema columns to live/history/archive viewer tables and creates the ASN policy table.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

function tableExists(tableName) {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName);
    return Boolean(row);
}

function getTableColumns(tableName) {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function addColumnIfMissing(tableName, columnName, columnSql) {
    const columns = getTableColumns(tableName);
    if (columns.has(columnName)) {
        return false;
    }

    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`);
    return true;
}

function ensureViewerNetworkIdentityColumns(tableName) {
    if (!tableExists(tableName)) {
        return false;
    }

    const columns = [
        ['asn_number', 'INTEGER'],
        ['asn_org', "TEXT DEFAULT 'unknown'"],
        ['network_lookup_source', "TEXT DEFAULT 'unavailable'"],
        ['network_lookup_version', "TEXT DEFAULT 'unavailable'"],
    ];

    let changed = false;
    for (const [columnName, columnSql] of columns) {
        changed = addColumnIfMissing(tableName, columnName, columnSql) || changed;
    }

    return changed;
}

function ensureHistoryArchiveTables() {
    if (tableExists('viewer_session_history')) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS viewer_session_history_archive (
                id INTEGER PRIMARY KEY,
                camera_id INTEGER NOT NULL,
                camera_name TEXT,
                ip_address TEXT NOT NULL,
                user_agent TEXT,
                device_type TEXT,
                asn_number INTEGER,
                asn_org TEXT DEFAULT 'unknown',
                network_lookup_source TEXT DEFAULT 'unavailable',
                network_lookup_version TEXT DEFAULT 'unavailable',
                started_at DATETIME NOT NULL,
                ended_at DATETIME NOT NULL,
                duration_seconds INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    if (tableExists('playback_viewer_session_history')) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS playback_viewer_session_history_archive (
                id INTEGER PRIMARY KEY,
                camera_id INTEGER NOT NULL,
                camera_name TEXT,
                segment_filename TEXT NOT NULL,
                segment_started_at DATETIME,
                playback_access_mode TEXT NOT NULL DEFAULT 'public_preview',
                ip_address TEXT NOT NULL,
                user_agent TEXT,
                device_type TEXT,
                asn_number INTEGER,
                asn_org TEXT DEFAULT 'unknown',
                network_lookup_source TEXT DEFAULT 'unavailable',
                network_lookup_version TEXT DEFAULT 'unavailable',
                admin_user_id INTEGER,
                admin_username TEXT,
                started_at DATETIME NOT NULL,
                ended_at DATETIME NOT NULL,
                duration_seconds INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
}

function ensureAsnAccessPoliciesTable() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS asn_access_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope TEXT NOT NULL CHECK (scope IN ('global', 'area', 'camera')),
            target_id INTEGER,
            access_flow TEXT NOT NULL DEFAULT 'live' CHECK (access_flow IN ('live', 'playback')),
            enabled INTEGER NOT NULL DEFAULT 1,
            mode TEXT NOT NULL DEFAULT 'observe_only' CHECK (mode IN ('observe_only', 'allowlist', 'denylist')),
            asn_allowlist TEXT NOT NULL DEFAULT '[]',
            asn_denylist TEXT NOT NULL DEFAULT '[]',
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_asn_access_policies_scope_target_flow
        ON asn_access_policies(scope, COALESCE(target_id, 0), access_flow)
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_asn_access_policies_access_flow
        ON asn_access_policies(access_flow)
    `);
}

console.log('Running migration: zz_20260507_add_network_identity_and_asn_policy');
console.log('Database path:', dbPath);

try {
    ensureHistoryArchiveTables();

    const tables = [
        'viewer_sessions',
        'viewer_session_history',
        'viewer_session_history_archive',
        'playback_viewer_sessions',
        'playback_viewer_session_history',
        'playback_viewer_session_history_archive',
    ];

    for (const tableName of tables) {
        ensureViewerNetworkIdentityColumns(tableName);
    }

    ensureAsnAccessPoliciesTable();

    console.log('ASN/ISP migration completed successfully');
} catch (error) {
    console.error('ASN/ISP migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
