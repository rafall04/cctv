/*
 * Purpose: Seed a few built-in announcement templates so the village operator starts with ready scripts —
 *          most importantly "Kabar Lelayu" (death announcement), one of the most frequent & sensitive desa
 *          broadcasts, which needs a guided, solemn script (innalillahi + name/age/address/burial time).
 *          Two routine ones (Kerja Bakti, Posyandu) double as examples of the dynamic {hari}/{tanggal}/{jam}
 *          variables that fill themselves at synth time.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db, table audio_templates.
 * MainFuncs: seeds templates if a template with the same name does not already exist (idempotent by name).
 * SideEffects: inserts rows into audio_templates; never overwrites an operator's edits.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

const SEEDS = [
    {
        name: 'Kabar Lelayu',
        category: 'Lelayu',
        body: "Assalamu'alaikum warahmatullahi wabarakatuh. Innaa lillaahi wa innaa ilaihi raaji'uun. "
            + 'Telah berpulang ke rahmatullah, {nama} bin/binti {ayah}, usia {umur} tahun, beralamat di {alamat}. '
            + 'Jenazah akan dimakamkan pada {waktu} di {pemakaman}. Segenap keluarga mengharap kehadiran dan doa, '
            + 'serta memohon dibukakan pintu maaf atas segala kesalahan almarhum atau almarhumah. '
            + 'Wassalamu\'alaikum warahmatullahi wabarakatuh.',
    },
    {
        name: 'Kerja Bakti',
        category: 'Warga',
        body: 'Diberitahukan kepada seluruh warga, akan diadakan kerja bakti pada hari {hari}, tanggal {tanggal}, '
            + 'mulai pukul {jam}. Diharapkan kehadiran dan partisipasi seluruh warga. Terima kasih.',
    },
    {
        name: 'Posyandu',
        category: 'Warga',
        body: 'Diberitahukan kepada ibu-ibu, kegiatan Posyandu akan dilaksanakan pada hari {hari}, tanggal {tanggal}, '
            + 'mulai pukul {jam}, bertempat di {tempat}. Mohon membawa buku KIA. Terima kasih.',
    },
];

try {
    console.log('Seeding built-in announcement templates...');
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audio_templates'").get();
    if (!hasTable) {
        console.log('  ? audio_templates not present, skip');
    } else {
        const exists = db.prepare('SELECT id FROM audio_templates WHERE name = ?');
        const ins = db.prepare('INSERT INTO audio_templates (name, category, body, created_by) VALUES (?, ?, ?, NULL)');
        for (const s of SEEDS) {
            if (exists.get(s.name)) { console.log(`  = template "${s.name}" already present`); continue; }
            ins.run(s.name, s.category, s.body);
            console.log(`  + seeded template "${s.name}"`);
        }
    }
    console.log('Announcement template seed completed successfully');
} catch (error) {
    console.error('Announcement template seed failed:', error);
    process.exit(1);
} finally {
    db.close();
}
