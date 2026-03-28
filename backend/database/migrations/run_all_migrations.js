#!/usr/bin/env node

/**
 * Run All Migrations Script
 * 
 * Safely runs all database migrations in order.
 * Safe to run multiple times - migrations check if changes already exist.
 * 
 * Usage:
 *   node backend/database/migrations/run_all_migrations.js
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

// Migration files in order
const MIGRATIONS = [
    '001_migrate_security.js',
    'add_settings_table.js',
    'add_timezone_settings.js',
    'add_branding_settings.js',
    'add_landing_page_settings.js',
    'add_watermark_settings.js',
    'add_saweria_settings.js',
    'add_feedbacks_table.js',
    'add_viewer_sessions.js',
    'add_coordinates.js',
    'add_area_coordinates.js',
    'add_video_codec.js',
    'add_stream_key.js',
    'add_is_tunnel_field.js',
    'add_camera_status.js',
    'add_camera_online_status.js',
    'add_priority_camera.js',
    'add_sponsor_fields.js',
    'add_thumbnail_path.js',
    'fix_thumbnail_paths.js',
    'add_recording_system.js',
    'create_recordings_table.js',
    'add_core_indexes.js',
    'add_analytics_indexes.js',
    'add_external_stream.js',
    'add_external_proxy_controls.js',
    'add_external_health_mode.js',
    'add_area_health_override.js',
    'add_public_playback_controls.js',
    'add_playback_viewer_sessions.js',
    'create_camera_discovery_table.js',
    'add_camera_delivery_types.js',
    'backfill_camera_delivery_types.js'
];

console.log('🚀 Starting migration process...\n');
console.log(`📁 Database: ${dbPath}\n`);

let successCount = 0;
let skipCount = 0;
let errorCount = 0;

for (const migrationFile of MIGRATIONS) {
    const migrationPath = join(__dirname, migrationFile);

    try {
        console.log(`⏳ Running: ${migrationFile}`);

        // Import and run migration
        const migration = await import(`file://${migrationPath}`);

        // Most migrations are self-executing, but some export a function
        if (typeof migration.default === 'function') {
            await migration.default();
        }

        console.log(`✅ Success: ${migrationFile}\n`);
        successCount++;

    } catch (error) {
        if (error.message.includes('already exists') ||
            error.message.includes('duplicate column')) {
            console.log(`⏭️  Skipped: ${migrationFile} (already applied)\n`);
            skipCount++;
        } else {
            console.error(`❌ Error: ${migrationFile}`);
            console.error(`   ${error.message}\n`);
            errorCount++;
        }
    }
}

console.log('━'.repeat(60));
console.log('📊 Migration Summary:');
console.log(`   ✅ Success: ${successCount}`);
console.log(`   ⏭️  Skipped: ${skipCount}`);
console.log(`   ❌ Errors:  ${errorCount}`);
console.log('━'.repeat(60));

if (errorCount > 0) {
    console.log('\n⚠️  Some migrations failed. Check errors above.');
    process.exit(1);
} else {
    console.log('\n🎉 All migrations completed successfully!');
    process.exit(0);
}
