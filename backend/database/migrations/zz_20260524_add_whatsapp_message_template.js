/**
 * Migration: add the `whatsapp_message_template` branding key.
 *
 * F6 lets admins fully customize the pre-filled WhatsApp message text
 * that public landing/playback contact links open with. The template
 * supports placeholders ({{company_name}}, {{city_name}}, {{page}},
 * {{camera_name}}); the frontend's buildWhatsappLink utility does the
 * substitution at render time. Empty string falls back to a sensible
 * default ("Halo Admin {{company_name}}, ...").
 *
 * Forward-only and idempotent — only inserts the row when missing, so
 * re-runs on a populated database are no-ops.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const DEFAULT_WHATSAPP_TEMPLATE =
    'Halo Admin {{company_name}}, saya ingin tanya soal {{page}}.';

console.log('Starting migration: add whatsapp_message_template branding key...');

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
            .get('whatsapp_message_template');

        if (existing) {
            console.log('   whatsapp_message_template already present — skip');
        } else {
            db.prepare(
                `INSERT INTO branding_settings (key, value, description)
                 VALUES (?, ?, ?)`
            ).run(
                'whatsapp_message_template',
                DEFAULT_WHATSAPP_TEMPLATE,
                'Template pesan WhatsApp default ({{company_name}}, {{city_name}}, {{page}}, {{camera_name}})'
            );
            console.log('   whatsapp_message_template inserted with default template');
        }
    }

    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
