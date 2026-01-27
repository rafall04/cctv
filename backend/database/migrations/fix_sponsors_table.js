import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path ke database
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('📍 Database path:', dbPath);

const db = new Database(dbPath);

try {
    console.log('🔍 Checking sponsors table structure...');
    console.log('');

    // Get current table structure
    const tableInfo = db.prepare("PRAGMA table_info(sponsors)").all();
    
    console.log('Current columns:');
    tableInfo.forEach(col => {
        console.log(`  - ${col.name} (${col.type})`);
    });
    console.log('');

    // Required columns with their types
    const requiredColumns = {
        'id': 'INTEGER',
        'name': 'TEXT',
        'logo': 'TEXT',
        'url': 'TEXT',
        'package': 'TEXT',
        'price': 'REAL',
        'active': 'INTEGER',
        'start_date': 'DATE',
        'end_date': 'DATE',
        'contact_name': 'TEXT',
        'contact_email': 'TEXT',
        'contact_phone': 'TEXT',
        'notes': 'TEXT',
        'created_at': 'DATETIME',
        'updated_at': 'DATETIME'
    };

    // Check for missing columns
    const existingColumns = tableInfo.map(col => col.name);
    const missingColumns = Object.keys(requiredColumns).filter(
        col => !existingColumns.includes(col)
    );

    if (missingColumns.length > 0) {
        console.log('⚠️  Missing columns detected:', missingColumns.join(', '));
        console.log('');
        console.log('🔄 Adding missing columns...');

        for (const column of missingColumns) {
            const type = requiredColumns[column];
            let sql = `ALTER TABLE sponsors ADD COLUMN ${column} ${type}`;
            
            // Add defaults for specific columns
            if (column === 'active') {
                sql += ' DEFAULT 1';
            } else if (column === 'created_at' || column === 'updated_at') {
                sql += ' DEFAULT CURRENT_TIMESTAMP';
            }

            try {
                db.exec(sql);
                console.log(`  ✅ Added column: ${column}`);
            } catch (error) {
                console.error(`  ❌ Failed to add ${column}:`, error.message);
            }
        }
    } else {
        console.log('✅ All required columns exist');
    }

    console.log('');
    console.log('🔍 Verifying table structure after migration...');
    const updatedTableInfo = db.prepare("PRAGMA table_info(sponsors)").all();
    console.log('');
    console.log('Final columns:');
    updatedTableInfo.forEach(col => {
        console.log(`  - ${col.name} (${col.type})`);
    });

    console.log('');
    console.log('🔍 Checking existing data...');
    const count = db.prepare('SELECT COUNT(*) as count FROM sponsors').get();
    console.log(`  Total sponsors: ${count.count}`);

    if (count.count > 0) {
        const sponsors = db.prepare('SELECT id, name, package, active FROM sponsors').all();
        console.log('');
        console.log('Existing sponsors:');
        sponsors.forEach(sponsor => {
            console.log(`  - ID ${sponsor.id}: ${sponsor.name} (${sponsor.package || 'no package'}) - ${sponsor.active ? 'Active' : 'Inactive'}`);
        });
    }

    console.log('');
    console.log('✨ Migration completed successfully!');
    console.log('');

} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
