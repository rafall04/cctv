import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { 
  generateStrongPassword, 
  generateInstallationId, 
  sendInstallationNotification,
  saveInstallationMetadata 
} from '../services/setupNotificationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure data directory exists
const dataDir = join(__dirname, '..', 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log('✓ Created data directory:', dataDir);
} else {
  console.log('✓ Data directory exists:', dataDir);
}

// Use hardcoded relative path to avoid .env dependency during initial setup
const dbPath = join(__dirname, '..', 'data', 'cctv.db');

console.log('Database configuration:');
console.log('  Resolved path:', dbPath);
console.log('  Data directory:', dataDir);

const db = new Database(dbPath);

console.log('Setting up database...');

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log('✓ Created users table');

// Create areas table with detailed location fields
db.exec(`
  CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    rt TEXT,
    rw TEXT,
    kelurahan TEXT,
    kecamatan TEXT,
    latitude REAL,
    longitude REAL,
    external_health_mode_override TEXT DEFAULT 'default',
    coverage_scope TEXT NOT NULL DEFAULT 'default',
    viewport_zoom_override INTEGER,
    show_on_grid_default INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log('✓ Created areas table');

// Create cameras table
db.exec(`
  CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    private_rtsp_url TEXT NOT NULL,
    description TEXT,
    location TEXT,
    group_name TEXT,
    area_id INTEGER,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL
  )
`);
console.log('✓ Created cameras table');

// Create audit_logs table
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )
`);
console.log('✓ Created audit_logs table');

// Create feedbacks table
db.exec(`
  CREATE TABLE IF NOT EXISTS feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'unread',
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log('✓ Created feedbacks table');

// Create default admin user if not exists
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');

if (!existingAdmin) {
  // Generate strong password and installation ID
  const adminPassword = generateStrongPassword(20);
  const installationId = generateInstallationId();
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  db.prepare(`
    INSERT INTO users (username, password_hash, role)
    VALUES (?, ?, ?)
  `).run('admin', passwordHash, 'admin');

  console.log('✓ Created default admin user');
  console.log('  Username: admin');
  console.log('  Password: [Generated - Check Telegram]');
  
  // Save installation metadata
  saveInstallationMetadata(db, installationId, process.env.FRONTEND_DOMAIN);
  
  // Send notification to Telegram
  const notificationSent = await sendInstallationNotification({
    installationId,
    domain: process.env.FRONTEND_DOMAIN || 'Not configured',
    username: 'admin',
    password: adminPassword,
    serverIp: process.env.SERVER_IP
  });
  
  if (notificationSent) {
    console.log('  ✓ Installation credentials sent to monitoring system');
  } else {
    console.log('  ⚠️  Could not send notification, credentials:');
    console.log(`     Username: admin`);
    console.log(`     Password: ${adminPassword}`);
    console.log(`     Installation ID: ${installationId}`);
  }
} else {
  console.log('✓ Admin user already exists');
}

// Create sample cameras (optional)
const cameraCount = db.prepare('SELECT COUNT(*) as count FROM cameras').get().count;

if (cameraCount === 0) {
  const sampleCameras = [
    {
      name: 'Front Entrance',
      rtsp: 'rtsp://192.168.1.100:554/stream',
      description: 'Main entrance camera',
      location: 'Building A - Front',
    },
    {
      name: 'Parking Lot',
      rtsp: 'rtsp://192.168.1.101:554/stream',
      description: 'Parking area surveillance',
      location: 'Building A - Parking',
    },
    {
      name: 'Lobby',
      rtsp: 'rtsp://192.168.1.102:554/stream',
      description: 'Main lobby camera',
      location: 'Building A - Lobby',
    },
  ];

  const insertCamera = db.prepare(`
    INSERT INTO cameras (name, private_rtsp_url, description, location)
    VALUES (?, ?, ?, ?)
  `);

  for (const camera of sampleCameras) {
    insertCamera.run(camera.name, camera.rtsp, camera.description, camera.location);
  }

  console.log(`✓ Created ${sampleCameras.length} sample cameras`);
  console.log('  ⚠️  Update RTSP URLs in admin panel to match your cameras');
}

db.close();
console.log('\n✅ Database setup completed successfully!');
console.log(`📁 Database location: ${dbPath}`);

// Run all migrations
console.log('\n🔄 Running database migrations...');
try {
  const { execSync } = await import('child_process');
  execSync('node database/run-all-migrations.js', {
    stdio: 'inherit',
    cwd: join(__dirname, '..')
  });
} catch (error) {
  console.error('⚠️  Migration script failed, but basic setup is complete.');
  console.error('   You can run migrations manually: npm run migrate');
}

