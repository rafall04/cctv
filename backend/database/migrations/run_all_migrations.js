#!/usr/bin/env node

/**
 * Purpose: DEPRECATED compatibility shim. Delegates to the active runner so running this file
 *          can NEVER produce a stale/partial schema. Do not add migrations here.
 * Caller: Nobody should import this — `npm run migrate` and deploy scripts use
 *         `../run-all-migrations.js` (hyphen). Kept only so a manual/legacy invocation still works.
 * Deps: ../run-all-migrations.js (the active, auto-discovering runner).
 * MainFuncs: thin delegation to runMigrations().
 * SideEffects: Applies ALL forward-only migrations via the active runner (full schema).
 *
 * History: this file used to carry a hardcoded MIGRATIONS array that drifted out of date (it stopped
 * at zz_20260518_repair_recording_segment_timezone.js and silently omitted billing/approval/promo/
 * voucher migrations). The active runner `database/run-all-migrations.js` (hyphen) auto-discovers
 * every `.js` in migrations/ and `.sort()`s them, and already excludes this filename via
 * AGGREGATE_MIGRATION_RUNNERS — so delegating here is safe (no recursion) and always complete.
 */

import { runMigrations } from '../run-all-migrations.js';

console.warn(
    '[DEPRECATED] backend/database/migrations/run_all_migrations.js is a thin shim.\n' +
    '             Use `npm run migrate` (database/run-all-migrations.js, with a hyphen).\n' +
    '             Delegating to the active auto-discovering runner so the full schema is applied...\n'
);

runMigrations().catch((error) => {
    console.error('\nFatal error running migrations:', error.message);
    if (error.failed) {
        error.failed.forEach(({ file, error: itemError }) => {
            console.error(`- ${file}: ${itemError}`);
        });
    }
    process.exit(1);
});
