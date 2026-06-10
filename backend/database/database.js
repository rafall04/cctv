import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { config } from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = config.database.path.startsWith('/')
  ? config.database.path
  : join(__dirname, '..', config.database.path);

console.log('Database connection info:');
console.log('  Config path:', config.database.path);
console.log('  Resolved path:', dbPath);
console.log('  Working directory:', process.cwd());

// Ensure database directory exists
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  console.log('  Creating database directory:', dbDir);
  mkdirSync(dbDir, { recursive: true });
} else {
  console.log('  Database directory exists:', dbDir);
}

// Create database connection
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Match connectionPool's busy_timeout so a write WAITS for the lock (up to 5s) instead of
// throwing SQLITE_BUSY immediately when connectionPool's writer holds it. This removes the
// concrete dual-connection hazard (the asymmetry the audit flagged).
//
// NOTE: this module intentionally keeps its OWN single connection rather than delegating to
// connectionPool. The modules that import it rely on read-after-write consistency on one
// connection; connectionPool's separate read/write connections do NOT provide that (a read
// after a write — especially inside a transaction — returns the pre-write state), which breaks
// those modules. Full convergence onto connectionPool is deferred and needs a per-module audit —
// see "Known Rule Deviations" in SYSTEM_MAP.md.
db.pragma('busy_timeout = 5000');

// Helper function to run queries with error handling
export function query(sql, params = []) {
    try {
        return db.prepare(sql).all(params);
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// Helper function to get single row
export function queryOne(sql, params = []) {
    try {
        return db.prepare(sql).get(params);
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// Helper function to run insert/update/delete
export function execute(sql, params = []) {
    try {
        return db.prepare(sql).run(params);
    } catch (error) {
        console.error('Database execute error:', error);
        throw error;
    }
}

// Transaction helper
export function transaction(callback) {
    const txn = db.transaction(callback);
    return txn;
}

// Export database instance for advanced usage
export { db };

export default {
    query,
    queryOne,
    execute,
    transaction,
    db,
};
