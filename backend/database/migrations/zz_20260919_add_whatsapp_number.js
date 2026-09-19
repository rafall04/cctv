/**
 * Migration: add the `whatsapp_number` branding key where missing.
 *
 * The key was appended to add_branding_settings.js's fresh-install seed
 * list after some production databases were already created, so existing
 * installs never got the row. getBrandingSettingsAdmin() is a plain
 * SELECT — no row means the admin panel skips the field entirely
 * (`if (!setting) return null`), the public endpoint returns null, and
 * updateBrandingSetting would 404 even if the input were reachable.
 *
 * The inserted value is EMPTY on purpose: buildWhatsappLink() returns ''
 * for an empty number, so public contact buttons stay hidden exactly as
 * before until an admin types a real number. Backfilling the seed's
 * default ('6289685645956') would publish someone's real number on the
 * public site without the operator ever choosing it.
 *
 * Forward-only and idempotent — only inserts the row when missing, so
 * re-runs on a populated database are no-ops.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();

console.log('Starting migration: add whatsapp_number branding key...');

const db = new Database(dbPath);

try {
    const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='branding_settings'")
        .get();

    if (!tableExists) {
        console.log('   branding_settings table missing — earlier migration will create it; nothing to do here.');
    } else {
        const existing = db
            .prepare('SELECT id FROM branding_settings WHERE key = ?')
            .get('whatsapp_number');

        if (existing) {
            console.log('   whatsapp_number already present — skip');
        } else {
            db.prepare(
                `INSERT INTO branding_settings (key, value, description)
                 VALUES (?, ?, ?)`
            ).run(
                'whatsapp_number',
                '',
                'Nomor WhatsApp untuk tombol kontak publik (format: 628xxx). Kosong = tombol disembunyikan.'
            );
            console.log('   whatsapp_number inserted (empty — admin fills it via Branding settings)');
        }
    }

    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
