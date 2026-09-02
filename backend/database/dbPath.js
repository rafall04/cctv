/**
 * Purpose: Single source of truth for the SQLite file location, so setup, migrations, and the
 *          runtime pool never disagree. Mirrors connectionPool.js exactly: DATABASE_PATH if set
 *          (absolute used as-is, relative resolved from backend/), else ./data/cctv.db.
 * Caller: database/setup.js, database/run-all-migrations.js, every migration that opens a DB.
 * Deps: node path/url only (NO config import — safe to use during initial setup before .env exists).
 * MainFuncs: resolveDbPath.
 * SideEffects: None.
 *
 * Why this file exists: setup.js and 89 migrations used to hardcode `.../data/cctv.db` while the
 * runtime honoured DATABASE_PATH — so pointing the DB at another disk produced an empty file at the
 * custom path and a fully-migrated one at the default. (Audit v1.2.0, B-01.)
 */
import { fileURLToPath } from 'url';
import { dirname, isAbsolute, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveDbPath() {
    const configured = process.env.DATABASE_PATH || './data/cctv.db';
    return isAbsolute(configured) ? configured : join(__dirname, '..', configured);
}

export default resolveDbPath;
