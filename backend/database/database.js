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
