/**
 * Migration: clear stale is_online flags on disabled cameras.
 *
 * Before the write-path fix in cameraSourceLifecycleService.handleCameraUpdated, disabling a
 * camera never touched is_online — the row kept its last probed state forever (health checks
 * select enabled=1 only, so nothing ever rewrote it). Readers COALESCE camera_runtime_state
 * .is_online over cameras.is_online, so BOTH tables need the clear or the stale flag keeps
 * winning. Production carried 44 such rows that displayed "online" while disabled.
 *
 * Forward-only and idempotent — re-runs on a populated database are no-ops.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();

console.log('Starting migration: clear stale is_online on disabled cameras...');

const db = new Database(dbPath);

try {
    const hasCrs = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='camera_runtime_state'")
        .get();

    const clearedCameras = db
        .prepare('UPDATE cameras SET is_online = 0 WHERE enabled = 0 AND is_online = 1')
        .run().changes;
    console.log(`   cameras.is_online cleared: ${clearedCameras} row(s)`);

    if (hasCrs) {
        const clearedCrs = db
            .prepare(
                `UPDATE camera_runtime_state SET is_online = 0
                 WHERE is_online = 1
                   AND camera_id IN (SELECT id FROM cameras WHERE enabled = 0)`
            )
            .run().changes;
        console.log(`   camera_runtime_state.is_online cleared: ${clearedCrs} row(s)`);
    } else {
        console.log('   camera_runtime_state table missing — nothing to do there.');
    }

    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
