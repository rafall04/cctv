/*
 * Purpose: Titik Speaker node management — adds `agent_version` (reported by audio_node.py on each poll so
 *          an out-of-date STB is visible in the admin list) and `level` on the command queue (payload for
 *          the new 'volume' command — remote amixer control instead of walking to the box).
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: ALTER TABLE audio_devices ADD agent_version; ALTER TABLE audio_device_commands ADD level.
 * SideEffects: schema only; additive + idempotent (column-presence guarded).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: audio device volume + agent_version...');

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

try {
    if (!hasColumn('audio_devices', 'agent_version')) {
        db.exec(`ALTER TABLE audio_devices ADD COLUMN agent_version TEXT`);
        console.log('   audio_devices.agent_version added');
    } else {
        console.log('   audio_devices.agent_version already present — skipped');
    }

    if (!hasColumn('audio_device_commands', 'level')) {
        db.exec(`ALTER TABLE audio_device_commands ADD COLUMN level INTEGER`);
        console.log('   audio_device_commands.level added');
    } else {
        console.log('   audio_device_commands.level already present — skipped');
    }

    console.log('Audio device volume/agent_version migration completed successfully');
} catch (error) {
    console.error('Audio device migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
