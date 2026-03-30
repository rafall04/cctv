/**
 * Migration: add camera_runtime_state table, targeted indexes, and history archives
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

function tableExists(name) {
    return db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
    `).get(name);
}

function indexExists(name) {
    return db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND name = ?
    `).get(name);
}

function createIndex(name, sql) {
    if (indexExists(name)) {
        return;
    }
    db.exec(sql);
}

try {
    console.log('Running migration: add_runtime_state_and_history_retention');
    console.log('Database path:', dbPath);

    db.exec(`
        CREATE TABLE IF NOT EXISTS camera_runtime_state (
            camera_id INTEGER PRIMARY KEY,
            is_online INTEGER DEFAULT 0,
            monitoring_state TEXT DEFAULT 'unknown',
            monitoring_reason TEXT,
            last_runtime_signal_at DATETIME,
            last_runtime_signal_type TEXT,
            last_health_check_at DATETIME,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        )
    `);

    db.exec(`
        INSERT INTO camera_runtime_state (
            camera_id,
            is_online,
            monitoring_state,
            monitoring_reason,
            last_health_check_at,
            updated_at
        )
        SELECT
            c.id,
            COALESCE(c.is_online, 0),
            CASE
                WHEN c.is_online = 1 THEN 'online'
                WHEN c.is_online = 0 THEN 'offline'
                ELSE 'unknown'
            END,
            CASE
                WHEN c.is_online = 1 THEN 'seed_from_camera'
                WHEN c.is_online = 0 THEN 'seed_from_camera'
                ELSE 'seed_unknown'
            END,
            c.last_online_check,
            COALESCE(c.last_online_check, CURRENT_TIMESTAMP)
        FROM cameras c
        WHERE NOT EXISTS (
            SELECT 1
            FROM camera_runtime_state crs
            WHERE crs.camera_id = c.id
        )
    `);

    createIndex(
        'idx_cameras_enabled_area_id_id',
        'CREATE INDEX idx_cameras_enabled_area_id_id ON cameras(enabled, area_id, id)'
    );
    createIndex(
        'idx_cameras_enabled_delivery_type_id',
        'CREATE INDEX idx_cameras_enabled_delivery_type_id ON cameras(enabled, delivery_type, id)'
    );
    createIndex(
        'idx_cameras_enabled_is_tunnel_id',
        'CREATE INDEX idx_cameras_enabled_is_tunnel_id ON cameras(enabled, is_tunnel, id)'
    );
    createIndex(
        'idx_cameras_area_id_id',
        'CREATE INDEX idx_cameras_area_id_id ON cameras(area_id, id)'
    );

    createIndex(
        'idx_camera_runtime_state_online_monitoring',
        'CREATE INDEX idx_camera_runtime_state_online_monitoring ON camera_runtime_state(is_online, monitoring_state)'
    );
    createIndex(
        'idx_camera_runtime_state_updated_at',
        'CREATE INDEX idx_camera_runtime_state_updated_at ON camera_runtime_state(updated_at)'
    );

    if (tableExists('viewer_sessions')) {
        createIndex(
            'idx_viewer_sessions_active_camera',
            'CREATE INDEX idx_viewer_sessions_active_camera ON viewer_sessions(is_active, camera_id)'
        );
        createIndex(
            'idx_viewer_sessions_active_started_at',
            'CREATE INDEX idx_viewer_sessions_active_started_at ON viewer_sessions(is_active, started_at)'
        );
    }

    if (tableExists('viewer_session_history')) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS viewer_session_history_archive (
                id INTEGER PRIMARY KEY,
                camera_id INTEGER NOT NULL,
                camera_name TEXT,
                ip_address TEXT NOT NULL,
                user_agent TEXT,
                device_type TEXT,
                started_at DATETIME NOT NULL,
                ended_at DATETIME NOT NULL,
                duration_seconds INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        createIndex(
            'idx_viewer_history_started_at_camera_id',
            'CREATE INDEX idx_viewer_history_started_at_camera_id ON viewer_session_history(started_at DESC, camera_id)'
        );
        createIndex(
            'idx_viewer_history_camera_id_started_at',
            'CREATE INDEX idx_viewer_history_camera_id_started_at ON viewer_session_history(camera_id, started_at DESC)'
        );
        createIndex(
            'idx_viewer_history_ip_address_started_at',
            'CREATE INDEX idx_viewer_history_ip_address_started_at ON viewer_session_history(ip_address, started_at DESC)'
        );
    }

    if (tableExists('playback_viewer_sessions')) {
        createIndex(
            'idx_playback_viewer_sessions_active_camera',
            'CREATE INDEX idx_playback_viewer_sessions_active_camera ON playback_viewer_sessions(is_active, camera_id)'
        );
        createIndex(
            'idx_playback_viewer_sessions_active_started_at',
            'CREATE INDEX idx_playback_viewer_sessions_active_started_at ON playback_viewer_sessions(is_active, started_at)'
        );
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
                admin_user_id INTEGER,
                admin_username TEXT,
                started_at DATETIME NOT NULL,
                ended_at DATETIME NOT NULL,
                duration_seconds INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        createIndex(
            'idx_playback_viewer_history_started_at_camera_id',
            'CREATE INDEX idx_playback_viewer_history_started_at_camera_id ON playback_viewer_session_history(started_at DESC, camera_id)'
        );
        createIndex(
            'idx_playback_viewer_history_camera_id_started_at',
            'CREATE INDEX idx_playback_viewer_history_camera_id_started_at ON playback_viewer_session_history(camera_id, started_at DESC)'
        );
        createIndex(
            'idx_playback_viewer_history_access_started_at',
            'CREATE INDEX idx_playback_viewer_history_access_started_at ON playback_viewer_session_history(playback_access_mode, started_at DESC)'
        );
        createIndex(
            'idx_playback_viewer_history_ip_started_at',
            'CREATE INDEX idx_playback_viewer_history_ip_started_at ON playback_viewer_session_history(ip_address, started_at DESC)'
        );
    }

    if (tableExists('recording_restart_logs')) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS recording_restart_logs_archive AS
            SELECT *
            FROM recording_restart_logs
            WHERE 0
        `);
    }

    if (tableExists('recording_segments')) {
        createIndex(
            'idx_recording_segments_camera_start_time',
            'CREATE INDEX idx_recording_segments_camera_start_time ON recording_segments(camera_id, start_time)'
        );
    }

    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
