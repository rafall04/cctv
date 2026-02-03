/**
 * Migration: Add indexes for analytics performance optimization
 * 
 * Indexes yang ditambahkan:
 * 1. idx_viewer_history_started_at - untuk filter date range
 * 2. idx_viewer_history_ip_address - untuk retention metrics
 * 3. idx_viewer_history_camera_id - untuk camera performance
 * 4. idx_viewer_history_duration - untuk bounce rate calculation
 * 
 * Estimasi improvement: 3-5x lebih cepat untuk analytics queries
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: add analytics indexes...');
    
    // Check if viewer_session_history table exists
    const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='viewer_session_history'
    `).get();
    
    if (!tableExists) {
        console.log('⚠️  Table viewer_session_history does not exist yet');
        console.log('   This migration will be skipped and should run after add_viewer_sessions.js');
        console.log('✅ Migration skipped (will auto-run on next migration cycle)');
        process.exit(0);
    }
    
    // Check existing indexes
    const existingIndexes = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND tbl_name='viewer_session_history'
    `).all();
    
    const indexNames = existingIndexes.map(idx => idx.name);
    console.log('📋 Existing indexes:', indexNames);

    // Index 1: started_at for date range filtering
    if (!indexNames.includes('idx_viewer_history_started_at')) {
        console.log('➕ Creating index: idx_viewer_history_started_at...');
        db.exec(`CREATE INDEX idx_viewer_history_started_at ON viewer_session_history(started_at)`);
        console.log('✅ Index created: idx_viewer_history_started_at');
    } else {
        console.log('✓ Index already exists: idx_viewer_history_started_at');
    }

    // Index 2: ip_address for retention metrics
    if (!indexNames.includes('idx_viewer_history_ip_address')) {
        console.log('➕ Creating index: idx_viewer_history_ip_address...');
        db.exec(`CREATE INDEX idx_viewer_history_ip_address ON viewer_session_history(ip_address)`);
        console.log('✅ Index created: idx_viewer_history_ip_address');
    } else {
        console.log('✓ Index already exists: idx_viewer_history_ip_address');
    }

    // Index 3: camera_id for camera performance
    if (!indexNames.includes('idx_viewer_history_camera_id')) {
        console.log('➕ Creating index: idx_viewer_history_camera_id...');
        db.exec(`CREATE INDEX idx_viewer_history_camera_id ON viewer_session_history(camera_id)`);
        console.log('✅ Index created: idx_viewer_history_camera_id');
    } else {
        console.log('✓ Index already exists: idx_viewer_history_camera_id');
    }

    // Index 4: duration_seconds for bounce rate
    if (!indexNames.includes('idx_viewer_history_duration')) {
        console.log('➕ Creating index: idx_viewer_history_duration...');
        db.exec(`CREATE INDEX idx_viewer_history_duration ON viewer_session_history(duration_seconds)`);
        console.log('✅ Index created: idx_viewer_history_duration');
    } else {
        console.log('✓ Index already exists: idx_viewer_history_duration');
    }

    // Composite index for common query patterns
    if (!indexNames.includes('idx_viewer_history_composite')) {
        console.log('➕ Creating composite index: idx_viewer_history_composite...');
        db.exec(`CREATE INDEX idx_viewer_history_composite ON viewer_session_history(started_at, ip_address, camera_id)`);
        console.log('✅ Composite index created: idx_viewer_history_composite');
    } else {
        console.log('✓ Composite index already exists: idx_viewer_history_composite');
    }

    // Analyze table for query optimizer
    console.log('📊 Analyzing table for query optimizer...');
    db.exec(`ANALYZE viewer_session_history`);
    console.log('✅ Table analyzed');

    console.log('');
    console.log('✅ Migration completed successfully');
    console.log('📈 Expected performance improvement: 3-5x faster analytics queries');
    
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
