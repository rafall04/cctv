#!/usr/bin/env node

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

        if (!hasColumn(areaColumns, 'internal_ingest_policy_default')) {
            db.exec("ALTER TABLE areas ADD COLUMN internal_ingest_policy_default TEXT NOT NULL DEFAULT 'default'");
            console.log('Added areas.internal_ingest_policy_default');
        } else {
            console.log('areas.internal_ingest_policy_default already exists');
        }

        if (!hasColumn(areaColumns, 'internal_on_demand_close_after_seconds')) {
            db.exec('ALTER TABLE areas ADD COLUMN internal_on_demand_close_after_seconds INTEGER DEFAULT NULL');
            console.log('Added areas.internal_on_demand_close_after_seconds');
        } else {
            console.log('areas.internal_on_demand_close_after_seconds already exists');
        }

        if (!hasColumn(cameraColumns, 'internal_ingest_policy_override')) {
            db.exec("ALTER TABLE cameras ADD COLUMN internal_ingest_policy_override TEXT NOT NULL DEFAULT 'default'");
            console.log('Added cameras.internal_ingest_policy_override');
        } else {
            console.log('cameras.internal_ingest_policy_override already exists');
        }

        if (!hasColumn(cameraColumns, 'internal_on_demand_close_after_seconds_override')) {
            db.exec('ALTER TABLE cameras ADD COLUMN internal_on_demand_close_after_seconds_override INTEGER DEFAULT NULL');
            console.log('Added cameras.internal_on_demand_close_after_seconds_override');
        } else {
            console.log('cameras.internal_on_demand_close_after_seconds_override already exists');
        }

        if (!hasColumn(cameraColumns, 'source_profile')) {
            db.exec('ALTER TABLE cameras ADD COLUMN source_profile TEXT DEFAULT NULL');
            console.log('Added cameras.source_profile');
        } else {
            console.log('cameras.source_profile already exists');
        }

        db.exec(`
            UPDATE areas
            SET internal_ingest_policy_default = CASE
                WHEN internal_ingest_policy_default IN ('default', 'always_on', 'on_demand')
                    THEN internal_ingest_policy_default
                ELSE 'default'
            END
        `);

        db.exec(`
            UPDATE cameras
            SET internal_ingest_policy_override = CASE
                WHEN internal_ingest_policy_override IN ('default', 'always_on', 'on_demand')
                    THEN internal_ingest_policy_override
                ELSE 'default'
            END
        `);

        db.exec(`
            UPDATE cameras
            SET source_profile = 'surabaya_private_rtsp'
            WHERE source_profile IS NULL
              AND enable_recording = 0
              AND private_rtsp_url LIKE 'rtsp://%'
              AND (
                  LOWER(COALESCE(description, '')) LIKE '%source: private rtsp live only%'
                  OR LOWER(COALESCE(description, '')) LIKE '%source_tag: surabaya_private_rtsp%'
                  OR LOWER(COALESCE(description, '')) LIKE '%surabaya_private_rtsp%'
              )
        `);

        db.exec(`
            UPDATE cameras
            SET internal_ingest_policy_override = 'on_demand'
            WHERE source_profile = 'surabaya_private_rtsp'
              AND internal_ingest_policy_override = 'default'
        `);

        db.exec(`
            UPDATE cameras
            SET internal_on_demand_close_after_seconds_override = 15
            WHERE source_profile = 'surabaya_private_rtsp'
              AND internal_on_demand_close_after_seconds_override IS NULL
        `);
    } finally {
        db.close();
    }
}

runMigration();

export default runMigration;
