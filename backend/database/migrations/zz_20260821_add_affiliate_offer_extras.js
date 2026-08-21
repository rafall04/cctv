/*
Purpose: Let one affiliate offer carry a WhatsApp CTA, a product photo and a price — each
         independently optional, so the operator decides per offer what appears.
Caller: run-all-migrations (filename order).
Deps: better-sqlite3 against backend/data/cctv.db.
SideEffects: ALTER TABLE affiliate_offers ADD COLUMN x7, affiliate_offer_stats ADD whatsapp_clicks.
             Idempotent.

WHY PRESENCE IS THE SWITCH, NOT A FLAG
--------------------------------------
Every one of these is nullable and nothing else gates it: fill the WhatsApp number and the button
appears, clear it and it is gone. No `show_price` boolean beside `price`, because two pieces of
state describing one thing eventually disagree — a price that is set but hidden, or shown but
empty, and no way to tell which was intended. The promo banner already works this way (an empty
whatsapp_number falls back to the plain link), so the operator has seen the pattern.

WHY THE PRICE COLUMN IS NAMED THIS WAY
--------------------------------------
`product_price_rupiah` is the PRODUCT's price, shown to visitors. It is not `affiliate_partners.
price_rupiah`, which is what the operator charges the shop and never leaves the admin panel. Two
different numbers, two different audiences, so two clearly different names — a shared name like
`price` would eventually be read as the other one by someone in a hurry.

INTEGER, never floating point, per the Critical Invariant. Note the money guardrail could NOT have
caught this column before today: its pattern anchored with `\b(price|...)`, and `\b` cannot match
after an underscore, so every prefixed money column passed a green suite. The pattern was widened
in the same change that added this column.

NULL is meaningful here and 0 is not the same thing: NULL means "do not show a price", 0 would
mean "this costs nothing". Do not add a DEFAULT.
*/

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

/*
 * A WhatsApp tap is a different intent from a product-link tap — it is someone starting a
 * conversation, not browsing — so it gets its own counter rather than being folded into
 * product_clicks. Folding them would make the two numbers unreadable the moment both are enabled.
 */
const STAT_COLUMNS = [
    ['whatsapp_clicks', 'INTEGER NOT NULL DEFAULT 0'],
];

const NEW_COLUMNS = [
    ['whatsapp_number', 'TEXT'],
    ['whatsapp_message', 'TEXT'],
    ['product_price_rupiah', 'INTEGER'],
    ['image_base', 'TEXT'],
    ['image_width', 'INTEGER'],
    ['image_height', 'INTEGER'],
    ['image_bytes', 'INTEGER'],
];

function existingColumns(table) {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

try {
    const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='affiliate_offers'")
        .get();

    if (!tableExists) {
        console.log('affiliate_offers not present yet — nothing to alter');
    } else {
        const present = existingColumns('affiliate_offers');
        const missing = NEW_COLUMNS.filter(([name]) => !present.has(name));

        if (missing.length === 0) {
            console.log('affiliate_offers extras already present');
        } else {
            db.exec('BEGIN');
            for (const [name, type] of missing) {
                db.exec(`ALTER TABLE affiliate_offers ADD COLUMN ${name} ${type}`);
            }
            db.exec('COMMIT');
            console.log(`Added affiliate_offers columns: ${missing.map(([n]) => n).join(', ')}`);
        }

        const statsPresent = existingColumns('affiliate_offer_stats');
        const missingStats = STAT_COLUMNS.filter(([name]) => !statsPresent.has(name));

        if (missingStats.length > 0) {
            db.exec('BEGIN');
            for (const [name, type] of missingStats) {
                db.exec(`ALTER TABLE affiliate_offer_stats ADD COLUMN ${name} ${type}`);
            }
            db.exec('COMMIT');
            console.log(`Added affiliate_offer_stats columns: ${missingStats.map(([n]) => n).join(', ')}`);
        }
    }
} catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
