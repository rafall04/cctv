/**
 * Migration: Add playback viewer session tables
 * Tracks playback viewers separately from live viewers.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

console.log('Running migration: add_playback_viewer_sessions');
console.log('Database path:', dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS playback_viewer_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT UNIQUE NOT NULL,
            camera_id INTEGER NOT NULL,
            camera_name TEXT,
            segment_filename TEXT NOT NULL,
            segment_started_at DATETIME,
            playback_access_mode TEXT NOT NULL DEFAULT 'public_preview',
            ip_address TEXT NOT NULL,
            user_agent TEXT,
            device_type TEXT,
            admin_user_id INTEGER,
            admin_username TEXT,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
            ended_at DATETIME,
            duration_seconds INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        )
    `);
    console.log('Created playback_viewer_sessions table');

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_playback_viewer_sessions_camera_id
        ON playback_viewer_sessions(camera_id);

        CREATE INDEX IF NOT EXISTS idx_playback_viewer_sessions_is_active
        ON playback_viewer_sessions(is_active);

        CREATE INDEX IF NOT EXISTS idx_playback_viewer_sessions_started_at
        ON playback_viewer_sessions(started_at);

        CREATE INDEX IF NOT EXISTS idx_playback_viewer_sessions_access_mode
        ON playback_viewer_sessions(playback_access_mode);
    `);
    console.log('Created playback_viewer_sessions indexes');

    db.exec(`
        CREATE TABLE IF NOT EXISTS playback_viewer_session_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            camera_name TEXT,
            segment_filename TEXT NOT NULL,
            segment_started_at DATETIME,
            playback_access_mode TEXT NOT NULL DEFAULT 'public_preview',
            ip_address TEXT NOT NULL,
            user_agent TEXT,
            device_type TEXT,
            admin_user_id INTEGER,
            admin_username TEXT,
            started_at DATETIME NOT NULL,
            ended_at DATETIME NOT NULL,
            duration_seconds INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('Created playback_viewer_session_history table');

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_playback_viewer_history_camera_id
        ON playback_viewer_session_history(camera_id);

        CREATE INDEX IF NOT EXISTS idx_playback_viewer_history_started_at
        ON playback_viewer_session_history(started_at);

        CREATE INDEX IF NOT EXISTS idx_playback_viewer_history_access_mode
        ON playback_viewer_session_history(playback_access_mode);

        CREATE INDEX IF NOT EXISTS idx_playback_viewer_history_segment
        ON playback_viewer_session_history(segment_filename);
    `);
    console.log('Created playback_viewer_session_history indexes');

    console.log('Playback viewer session migration completed successfully');
} catch (error) {
    console.error('Playback viewer session migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
