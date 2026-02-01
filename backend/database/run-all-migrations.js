#!/usr/bin/env node

/**
 * Run All Database Migrations
 * 
 * Script ini menjalankan SEMUA migration yang ada di folder migrations/
 * Digunakan untuk setup awal client baru atau update database ke versi terbaru
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, 'migrations');

console.log('🔄 Running all database migrations...\n');

// Get all migration files
const migrationFiles = readdirSync(migrationsDir)
    .filter(file => file.endsWith('.js'))
    .sort(); // Run in alphabetical order

console.log(`Found ${migrationFiles.length} migration files:\n`);

let successCount = 0;
let skipCount = 0;
let errorCount = 0;

for (const file of migrationFiles) {
    const migrationPath = join(migrationsDir, file);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📄 Running: ${file}`);
    console.log('='.repeat(60));
    
    try {
        // Run migration using node
        execSync(`node "${migrationPath}"`, {
            stdio: 'inherit',
            cwd: __dirname
        });
        
        successCount++;
    } catch (error) {
        // Check if error is because table/column already exists (not a real error)
        const errorOutput = error.message || '';
        if (errorOutput.includes('already exists') || errorOutput.includes('✓')) {
            console.log(`⏭️  Skipped (already applied)`);
            skipCount++;
        } else {
            console.error(`❌ Failed: ${file}`);
            console.error(error.message);
            errorCount++;
        }
    }
}

console.log(`\n${'='.repeat(60)}`);
console.log('📊 Migration Summary:');
console.log('='.repeat(60));
console.log(`✅ Success: ${successCount}`);
console.log(`⏭️  Skipped: ${skipCount}`);
console.log(`❌ Errors: ${errorCount}`);
console.log(`📁 Total: ${migrationFiles.length}`);

if (errorCount > 0) {
    console.log('\n⚠️  Some migrations failed. Please check the errors above.');
    process.exit(1);
} else {
    console.log('\n✅ All migrations completed successfully!');
    process.exit(0);
}
