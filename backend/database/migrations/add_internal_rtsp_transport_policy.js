#!/usr/bin/env node

/*
Purpose: Add per-area and per-camera internal RTSP transport policy columns.
Caller: Database migration runner before backend startup.
Deps: better-sqlite3 and backend data/cctv.db.
MainFuncs: runMigration().
SideEffects: Alters areas/cameras schema and normalizes invalid transport values.
*/

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

function hasColumn(columns, name) {
    return columns.some((column) => column.name === name);
}

function runMigration() {
    const db = new Database(dbPath);

    try {
        const areaColumns = db.prepare('PRAGMA table_info(areas)').all();
        const cameraColumns = db.prepare('PRAGMA table_info(cameras)').all();

        if (!hasColumn(areaColumns, 'internal_rtsp_transport_default')) {
            db.exec("ALTER TABLE areas ADD COLUMN internal_rtsp_transport_default TEXT NOT NULL DEFAULT 'default'");
            console.log('Added areas.internal_rtsp_transport_default');
        } else {
            console.log('areas.internal_rtsp_transport_default already exists');
        }

        if (!hasColumn(cameraColumns, 'internal_rtsp_transport_override')) {
            db.exec("ALTER TABLE cameras ADD COLUMN internal_rtsp_transport_override TEXT NOT NULL DEFAULT 'default'");
            console.log('Added cameras.internal_rtsp_transport_override');
        } else {
            console.log('cameras.internal_rtsp_transport_override already exists');
        }

        db.exec(`
            UPDATE areas
            SET internal_rtsp_transport_default = CASE
                WHEN internal_rtsp_transport_default IN ('default', 'tcp', 'udp', 'auto')
                    THEN internal_rtsp_transport_default
                ELSE 'default'
            END
        `);

        db.exec(`
            UPDATE cameras
            SET internal_rtsp_transport_override = CASE
                WHEN internal_rtsp_transport_override IN ('default', 'tcp', 'udp', 'auto')
                    THEN internal_rtsp_transport_override
                ELSE 'default'
            END
        `);
    } finally {
        db.close();
    }
}

runMigration();

export default runMigration;
