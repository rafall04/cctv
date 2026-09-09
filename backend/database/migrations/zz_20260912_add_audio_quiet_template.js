/*
 * Purpose: Two quick-win pieces for Audio Broadcast operations:
 *   (1) Per-area "quiet hours" + loop ceiling — areas.quiet_start / quiet_end (WIB HH:MM) + max_loop.
 *       A manual broadcast whose target area is in quiet hours needs an explicit confirm (not a hard
 *       block); max_loop caps how many times a clip repeats on that area's cameras.
 *   (2) Announcement templates — a small library of fill-in-the-blank scripts ("{nama}" placeholders)
 *       an operator turns into speech via TTS or reads over live talk.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds areas.quiet_start/quiet_end/max_loop; creates audio_templates (+ seeds a few).
 * SideEffects: schema + a one-time seed (only when the table is empty); additive + idempotent.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding audio quiet-hours + templates schema...');
    const areaCols = db.prepare('PRAGMA table_info(areas)').all().map((c) => c.name);
    const addArea = (name, ddl) => {
        if (areaCols.includes(name)) { console.log(`  = areas.${name} already present`); }
        else { db.exec(`ALTER TABLE areas ADD COLUMN ${ddl}`); console.log(`  + added areas.${name}`); }
    };
    addArea('quiet_start', 'quiet_start TEXT');  // WIB HH:MM, null = no quiet hours
    addArea('quiet_end', 'quiet_end TEXT');
    addArea('max_loop', 'max_loop INTEGER');     // null = no cap

    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_templates (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            category   TEXT,
            body       TEXT    NOT NULL,
            created_by INTEGER,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    `);

    // Seed a few common village-PA templates the first time only ({placeholders} filled in the UI).
    const count = db.prepare('SELECT COUNT(*) AS n FROM audio_templates').get().n;
    if (count === 0) {
        const seed = db.prepare('INSERT INTO audio_templates (name, category, body) VALUES (?, ?, ?)');
        const rows = [
            ['Kehilangan', 'Warga', 'Diberitahukan kepada seluruh warga, telah kehilangan {barang} milik Bapak/Ibu {nama} di sekitar {lokasi}. Bagi yang menemukan mohon menghubungi {kontak}. Terima kasih.'],
            ['Kerja bakti', 'Warga', 'Diberitahukan kepada seluruh warga {rt_rw}, akan diadakan kerja bakti pada hari {hari} pukul {jam}. Mohon kehadiran dan partisipasinya. Terima kasih.'],
            ['Panggilan warga', 'Warga', 'Diumumkan kepada Bapak/Ibu {nama}, dimohon segera hadir di {lokasi}. Sekali lagi, Bapak/Ibu {nama} ditunggu di {lokasi}. Terima kasih.'],
            ['Duka cita', 'Warga', 'Innalillahi wa inna ilaihi raji un. Telah berpulang ke rahmatullah, {nama}, pada {waktu}. Jenazah akan dimakamkan {info}. Mohon dimaafkan segala kesalahan almarhum.'],
            ['Pengumuman umum', 'Umum', 'Perhatian, perhatian. Diberitahukan kepada seluruh warga bahwa {pesan}. Demikian pengumuman ini disampaikan. Terima kasih.'],
        ];
        const tx = db.transaction(() => rows.forEach((r) => seed.run(...r)));
        tx();
        console.log(`  + seeded ${rows.length} announcement templates`);
    } else {
        console.log(`  = audio_templates already has ${count} row(s), skip seed`);
    }

    console.log('Audio quiet/template migration completed successfully');
} catch (error) {
    console.error('Audio quiet/template migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
