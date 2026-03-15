/**
 * Migration: add external proxy controls for CCTV cameras
 * Adds per-camera proxy behavior fields for external HLS streams.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add external proxy controls...');

const db = new Database(dbPath);

try {
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();

    const hasExternalUseProxy = tableInfo.some((column) => column.name === 'external_use_proxy');
    if (!hasExternalUseProxy) {
        db.exec("ALTER TABLE cameras ADD COLUMN external_use_proxy INTEGER NOT NULL DEFAULT 1");
        console.log('Added external_use_proxy column to cameras table');
    } else {
        console.log('external_use_proxy column already exists, skipping');
    }

    const hasExternalTlsMode = tableInfo.some((column) => column.name === 'external_tls_mode');
    if (!hasExternalTlsMode) {
        db.exec("ALTER TABLE cameras ADD COLUMN external_tls_mode TEXT NOT NULL DEFAULT 'strict'");
        console.log('Added external_tls_mode column to cameras table');
    } else {
        console.log('external_tls_mode column already exists, skipping');
    }

    db.exec(`
        UPDATE cameras
        SET external_use_proxy = COALESCE(external_use_proxy, 1),
            external_tls_mode = CASE
                WHEN external_tls_mode IN ('strict', 'insecure') THEN external_tls_mode
                ELSE 'strict'
            END
    `);

    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
