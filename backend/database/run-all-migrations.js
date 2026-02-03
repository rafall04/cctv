#!/usr/bin/env node
/**
 * Run All Database Migrations
 * 
 * This script runs all migration files in the migrations directory
 * in alphabetical order. Each migration is idempotent (safe to run multiple times).
 * 
 * Usage:
 *   node backend/database/run-all-migrations.js
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, 'migrations');

console.log('🚀 Running All Database Migrations');
console.log('=====================================\n');

// Get all migration files
const migrationFiles = readdirSync(migrationsDir)
    .filter(file => file.endsWith('.js'))
    .sort(); // Run in alphabetical order

console.log(`Found ${migrationFiles.length} migration files:\n`);
migrationFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file}`);
});
console.log('');

// Run migrations sequentially
async function runMigrations() {
    let successCount = 0;
    let failCount = 0;
    const failed = [];
    const skipped = [];

    for (const file of migrationFiles) {
        const migrationPath = join(migrationsDir, file);
        
        console.log(`\n📦 Running: ${file}`);
        console.log('─'.repeat(60));
        
        try {
            const exitCode = await runMigration(migrationPath);
            if (exitCode === 0) {
                successCount++;
                console.log(`✅ Success: ${file}\n`);
            } else {
                // Exit code 0 = success, anything else = failure
                // But we continue with next migration
                skipped.push(file);
                console.log(`⚠️  Skipped: ${file} (will retry after dependencies)\n`);
            }
        } catch (error) {
            failCount++;
            failed.push({ file, error: error.message });
            console.error(`❌ Failed: ${file}`);
            console.error(`   Error: ${error.message}\n`);
            // Continue with next migration even if one fails
        }
    }

    // Retry skipped migrations (for dependency issues)
    if (skipped.length > 0) {
        console.log('\n🔄 Retrying skipped migrations...');
        console.log('─'.repeat(60));
        
        for (const file of skipped) {
            const migrationPath = join(migrationsDir, file);
            console.log(`\n📦 Retry: ${file}`);
            
            try {
                await runMigration(migrationPath);
                successCount++;
                console.log(`✅ Success: ${file}\n`);
            } catch (error) {
                failCount++;
                failed.push({ file, error: error.message });
                console.error(`❌ Still failed: ${file}`);
                console.error(`   Error: ${error.message}\n`);
            }
        }
    }

    // Summary
    console.log('\n=====================================');
    console.log('📊 Migration Summary');
    console.log('=====================================');
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    
    if (failed.length > 0) {
        console.log('\n❌ Failed Migrations:');
        failed.forEach(({ file, error }) => {
            console.log(`   - ${file}: ${error}`);
        });
        console.log('\n⚠️  Some migrations failed. Please check the errors above.');
        process.exit(1);
    } else {
        console.log('\n✅ All migrations completed successfully!');
        process.exit(0);
    }
}

// Run a single migration file
function runMigration(migrationPath) {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [migrationPath], {
            stdio: 'inherit',
            shell: true
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Migration exited with code ${code}`));
            }
        });

        child.on('error', (error) => {
            reject(error);
        });
    });
}

// Run all migrations
runMigrations().catch(error => {
    console.error('\n❌ Fatal error running migrations:', error);
    process.exit(1);
});
