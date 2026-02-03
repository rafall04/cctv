import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use hardcoded relative path instead of config to avoid .env dependency
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Security Migration - Database path:', dbPath);

const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

console.log('Running security database migration...\n');

// 1. Create security_logs table with indexes
console.log('Creating security_logs table...');
db.exec(`
  CREATE TABLE IF NOT EXISTS security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    fingerprint TEXT,
    username TEXT,
    endpoint TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create indexes for security_logs
db.exec(`CREATE INDEX IF NOT EXISTS idx_security_logs_event_type ON security_logs(event_type)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_security_logs_timestamp ON security_logs(timestamp)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_security_logs_ip_address ON security_logs(ip_address)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_security_logs_username ON security_logs(username)`);
console.log('✓ Created security_logs table with indexes');


// 2. Create api_keys table
console.log('Creating api_keys table...');
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT UNIQUE NOT NULL,
    client_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    last_used_at DATETIME,
    is_active INTEGER DEFAULT 1
  )
`);

// Create indexes for api_keys
db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active)`);
console.log('✓ Created api_keys table with indexes');

// 3. Create token_blacklist table
console.log('Creating token_blacklist table...');
db.exec(`
  CREATE TABLE IF NOT EXISTS token_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT UNIQUE NOT NULL,
    user_id INTEGER,
    blacklisted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    reason TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )
`);

// Create indexes for token_blacklist
db.exec(`CREATE INDEX IF NOT EXISTS idx_token_blacklist_token_hash ON token_blacklist(token_hash)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires_at ON token_blacklist(expires_at)`);
console.log('✓ Created token_blacklist table with indexes');

// 4. Create password_history table
console.log('Creating password_history table...');
db.exec(`
  CREATE TABLE IF NOT EXISTS password_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// Create index for password_history
db.exec(`CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id)`);
console.log('✓ Created password_history table with index');

// 5. Create login_attempts table
console.log('Creating login_attempts table...');
db.exec(`
  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    identifier_type TEXT NOT NULL,
    attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    success INTEGER DEFAULT 0
  )
`);

// Create indexes for login_attempts
db.exec(`CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier, identifier_type)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(attempt_time)`);
console.log('✓ Created login_attempts table with indexes');


// 6. Extend users table with security columns
console.log('Extending users table with security columns...');

// Check if columns already exist before adding
const userColumns = db.prepare("PRAGMA table_info(users)").all();
const columnNames = userColumns.map(col => col.name);

if (!columnNames.includes('password_changed_at')) {
  db.exec(`ALTER TABLE users ADD COLUMN password_changed_at DATETIME`);
  console.log('  ✓ Added password_changed_at column');
} else {
  console.log('  - password_changed_at column already exists');
}

if (!columnNames.includes('locked_until')) {
  db.exec(`ALTER TABLE users ADD COLUMN locked_until DATETIME`);
  console.log('  ✓ Added locked_until column');
} else {
  console.log('  - locked_until column already exists');
}

if (!columnNames.includes('failed_attempts')) {
  db.exec(`ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0`);
  console.log('  ✓ Added failed_attempts column');
} else {
  console.log('  - failed_attempts column already exists');
}

if (!columnNames.includes('last_login_at')) {
  db.exec(`ALTER TABLE users ADD COLUMN last_login_at DATETIME`);
  console.log('  ✓ Added last_login_at column');
} else {
  console.log('  - last_login_at column already exists');
}

if (!columnNames.includes('last_login_ip')) {
  db.exec(`ALTER TABLE users ADD COLUMN last_login_ip TEXT`);
  console.log('  ✓ Added last_login_ip column');
} else {
  console.log('  - last_login_ip column already exists');
}

if (!columnNames.includes('tokens_invalidated_at')) {
  db.exec(`ALTER TABLE users ADD COLUMN tokens_invalidated_at DATETIME`);
  console.log('  ✓ Added tokens_invalidated_at column');
} else {
  console.log('  - tokens_invalidated_at column already exists');
}

console.log('✓ Users table security columns updated');

db.close();

console.log('\n✅ Security database migration completed successfully!');
console.log(`📁 Database location: ${dbPath}`);
