// Purpose: Give every rental plan a second, independently-priced dimension: recording.
// Caller: npm run migrate.
// Deps: better-sqlite3 database file, billing_plans table.
// MainFuncs: none (script).
// SideEffects: Adds billing_plans.recording_price_per_camera when missing. Idempotent.
//
// WHY A SEPARATE COLUMN RATHER THAN A SECOND PLAN ROW
// ---------------------------------------------------
// A rental camera that records costs materially more to run than one that is only
// watched live, and the gap is not small: measured on production, one camera writes
// 3.2 GB/day and another writes 50.7 GB/day — a 16x spread driven purely by
// resolution. So "recording" cannot be folded into price_per_camera without either
// losing money on the big cameras or overcharging the small ones.
//
// The owner chose a flat per-camera surcharge (simplest to sell) over duplicating the
// catalog into Live/Record variants. A column keeps that promise literal: one plan,
// two numbers, and no way for the two halves to drift apart or for a customer to end
// up on a "Basic Rekam" whose max_cameras silently disagrees with "Basic".
//
// DEFAULT 0 IS DELIBERATE, NOT LAZY
// ---------------------------------
// Every existing plan keeps costing exactly what it costs today. A migration that
// silently raised anyone's bill would be a billing incident, not a feature. The
// surcharge only ever applies once an admin types a number into the panel.
//
// NOT YET CHARGED
// ---------------
// This migration + the admin panel make the price manageable; the charging engine
// (_chargeAndSync in billingService) still bills price_per_camera alone. That wiring
// is a separate change because it touches the money path and needs its own tests —
// see the scope note in billingPlanService.normalizePlanPayload.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='billing_plans'")
        .get();

    if (!table) {
        console.log('billing_plans not present yet; skipping recording-price migration');
    } else {
        const columns = db.prepare('PRAGMA table_info(billing_plans)').all();
        const already = columns.some((c) => c.name === 'recording_price_per_camera');

        if (already) {
            console.log('billing_plans.recording_price_per_camera already present');
        } else {
            db.exec(`
                ALTER TABLE billing_plans
                ADD COLUMN recording_price_per_camera INTEGER NOT NULL DEFAULT 0
            `);
            console.log('billing_plans.recording_price_per_camera added (default 0 — no plan repriced)');
        }
    }
} catch (error) {
    console.error('recording price migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
