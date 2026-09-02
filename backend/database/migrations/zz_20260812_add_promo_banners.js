/*
Purpose: Create the provider promo-banner tables (banner, targeting, daily stats).
Caller: `npm run migrate` via database/run-all-migrations.js.
Deps: better-sqlite3, backend/data/cctv.db.
MainFuncs: (top-level migration script).
SideEffects: Creates promo_banners, promo_banner_targets, promo_banner_stats + indexes.
*/

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: add promo banners...');

    /*
     * A promo banner is FIRST-PARTY house advertising (the provider's own
     * "pemasangan gratis" poster), deliberately kept separate from `sponsors`
     * and from the Adsterra `ads_*` settings:
     *   - sponsors are third parties whose logo overlays the video;
     *   - Adsterra slots are network ad code that the operator may switch off
     *     entirely. A house promo must keep showing when ads are off.
     *
     * `image_base` stores the shared basename of the generated WebP renditions
     * (`<base>-1200.webp` + `<base>-640.webp`), never a caller-supplied path —
     * see promoImageService for the filename allowlist that keeps this safe to
     * concatenate into a filesystem path.
     */
    db.exec(`
        CREATE TABLE IF NOT EXISTS promo_banners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            alt_text TEXT,
            image_base TEXT,
            image_width INTEGER,
            image_height INTEGER,
            image_bytes INTEGER,
            cta_label TEXT,
            cta_url TEXT,
            whatsapp_number TEXT,
            whatsapp_message TEXT,
            target_mode TEXT NOT NULL DEFAULT 'all',
            placements TEXT NOT NULL DEFAULT '["popup"]',
            active INTEGER NOT NULL DEFAULT 1,
            start_date TEXT,
            end_date TEXT,
            priority INTEGER NOT NULL DEFAULT 100,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ promo_banners table ready');

    // target_type is 'area' | 'camera'; rows only matter when the parent banner's
    // target_mode matches. ON DELETE CASCADE keeps targeting from outliving a banner.
    db.exec(`
        CREATE TABLE IF NOT EXISTS promo_banner_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            promo_id INTEGER NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER NOT NULL,
            UNIQUE (promo_id, target_type, target_id),
            FOREIGN KEY (promo_id) REFERENCES promo_banners(id) ON DELETE CASCADE
        )
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_promo_targets_lookup
        ON promo_banner_targets (target_type, target_id)
    `);
    console.log('✅ promo_banner_targets table ready');

    /*
     * Stats are aggregated per (banner, day) rather than one row per event.
     * A popup open on a busy public deck would otherwise write thousands of
     * rows a day for a number nobody reads at that resolution.
     */
    db.exec(`
        CREATE TABLE IF NOT EXISTS promo_banner_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            promo_id INTEGER NOT NULL,
            stat_date TEXT NOT NULL,
            impressions INTEGER NOT NULL DEFAULT 0,
            clicks INTEGER NOT NULL DEFAULT 0,
            UNIQUE (promo_id, stat_date),
            FOREIGN KEY (promo_id) REFERENCES promo_banners(id) ON DELETE CASCADE
        )
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_promo_stats_date
        ON promo_banner_stats (stat_date)
    `);
    console.log('✅ promo_banner_stats table ready');

    console.log('✅ Migration complete: promo banners');
} catch (error) {
    console.error('❌ Migration failed: add promo banners:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
