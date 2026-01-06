/**
 * Migration: Add viewer_sessions table
 * Tracks real-time viewer sessions for monitoring who is watching CCTV streams
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

console.log('Running migration: add_viewer_sessions');
console.log('Database path:', dbPath);

try {
    // Create viewer_sessions table
    db.exec(`
        CREATE TABLE IF NOT EXISTS viewer_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT UNIQUE NOT NULL,
            camera_id INTEGER NOT NULL,
            ip_address TEXT NOT NULL,
            user_agent TEXT,
            device_type TEXT,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
            ended_at DATETIME,
            duration_seconds INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        )
    `);
    console.log('✓ Created viewer_sessions table');

    // Create indexes for better query performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_viewer_sessions_camera_id ON viewer_sessions(camera_id);
        CREATE INDEX IF NOT EXISTS idx_viewer_sessions_is_active ON viewer_sessions(is_active);
        CREATE INDEX IF NOT EXISTS idx_viewer_sessions_started_at ON viewer_sessions(started_at);
        CREATE INDEX IF NOT EXISTS idx_viewer_sessions_ip_address ON viewer_sessions(ip_address);
    `);
    console.log('✓ Created indexes');

    // Create viewer_session_history table for analytics (optional, stores completed sessions)
    db.exec(`
        CREATE TABLE IF NOT EXISTS viewer_session_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            camera_name TEXT,
            ip_address TEXT NOT NULL,
            user_agent TEXT,
            device_type TEXT,
            started_at DATETIME NOT NULL,
            ended_at DATETIME NOT NULL,
            duration_seconds INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✓ Created viewer_session_history table');

    // Create index for history queries
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_viewer_history_camera_id ON viewer_session_history(camera_id);
        CREATE INDEX IF NOT EXISTS idx_viewer_history_started_at ON viewer_session_history(started_at);
    `);
    console.log('✓ Created history indexes');

    console.log('\n✅ Migration completed successfully!');
} catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
