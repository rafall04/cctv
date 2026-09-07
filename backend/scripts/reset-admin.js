// Purpose: Recover admin access without editing the DB by hand — set (or generate) the admin
//          password from the CLI. Backs the DB up first (AGENTS.md: always back up before a manual
//          DB op) and writes the credential to the same 0600 file the installer uses.
// Usage:   npm run reset-admin            → generate a strong random password
//          npm run reset-admin "MyPass1!"  → set this exact password (min 8 chars)
// Deps: better-sqlite3, bcrypt, database/dbPath.js, services/setupNotificationService.js.

import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { join, dirname } from 'path';
import { writeFileSync, chmodSync } from 'fs';
import { resolveDbPath } from '../database/dbPath.js';
import { generateStrongPassword } from '../services/setupNotificationService.js';

const dbPath = resolveDbPath();
const dataDir = dirname(dbPath);

const arg = process.argv[2];
if (arg && arg.length < 8) {
    console.error('❌ Password minimal 8 karakter. Kosongkan argumen untuk membuat password acak.');
    process.exit(1);
}
const newPassword = arg || generateStrongPassword(20);

const db = new Database(dbPath);
try {
    // WAL-safe consistent snapshot BEFORE any write.
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const bak = join(dataDir, `cctv.db.backup-resetadmin-${ts}`);
    await db.backup(bak);
    console.log('✓ Database dicadangkan:', bak);

    const hash = await bcrypt.hash(newPassword, 10);
    const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
    if (admin) {
        db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, 'admin');
        console.log('✓ Password admin di-reset.');
    } else {
        db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
            .run('admin', hash, 'admin');
        console.log('✓ Akun admin dibuat.');
    }

    const credPath = join(dataDir, 'INITIAL_ADMIN_PASSWORD.txt');
    try {
        writeFileSync(credPath,
            `RAF NET CCTV — kredensial admin (reset)\n`
            + `========================================\n`
            + `Username : admin\n`
            + `Password : ${newPassword}\n\n`
            + `Login, ganti password dari menu Profil, lalu HAPUS berkas ini.\n`,
            { encoding: 'utf8' });
        try { chmodSync(credPath, 0o600); } catch { /* Windows: chmod tak didukung */ }
    } catch (err) {
        console.log('  ⚠️  Gagal menulis berkas kredensial:', err.message);
    }

    console.log('');
    console.log('  ============================================');
    console.log('     Username : admin');
    console.log(`     Password : ${newPassword}`);
    console.log(`   Tersimpan di: ${credPath}`);
    console.log('  ============================================');
} finally {
    db.close();
}
