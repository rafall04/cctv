/*
 * Purpose: Seal plaintext share keys sitting in playback_tokens.share_key_prefix. That column
 *          held the FULL share key verbatim — a DB dump alone could mint share links for every
 *          playback token. New writes already store the AES-256-GCM blob (playbackTokenService
 *          sealShareKey); this pass converts rows written before the seal existed.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db, services/totpService.js (AES envelope keyed off JWT_SECRET).
 * MainFuncs: rewrite plaintext share_key_prefix -> sealed blob.
 * SideEffects: rewrites share_key_prefix in place (same key, encrypted at rest). IDEMPOTENT:
 *              rows already sealed (blob shape) are skipped; runs no-op when JWT secret absent.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: seal plaintext playback share keys...');

// Matches the blob envelope produced by totpService.encryptSecret: <b64>.<b64>.<b64>.
const SECRET_BLOB_RE = /^[A-Za-z0-9+/]{8,}={0,2}\.[A-Za-z0-9+/]{8,}={0,2}\.[A-Za-z0-9+/]+=*$/;

try {
    let encryptSecret;
    try {
        ({ encryptSecret } = await import('../../services/totpService.js'));
    } catch (error) {
        console.warn(`   share-key seal unavailable (${error.message}) — skipped; app keeps reading plaintext rows`);
    }

    if (encryptSecret) {
        const hasColumn = db.prepare('PRAGMA table_info(playback_tokens)').all().some((c) => c.name === 'share_key_prefix');
        if (!hasColumn) {
            console.log('   playback_tokens.share_key_prefix absent — nothing to seal');
        } else {
            const rows = db.prepare(
                "SELECT id, share_key_prefix AS k FROM playback_tokens WHERE share_key_prefix IS NOT NULL AND share_key_prefix != ''"
            ).all();
            const update = db.prepare('UPDATE playback_tokens SET share_key_prefix = ? WHERE id = ?');
            let sealed = 0;
            const sealAll = db.transaction(() => {
                for (const row of rows) {
                    const raw = String(row.k || '').trim();
                    if (!raw || SECRET_BLOB_RE.test(raw)) continue;
                    try {
                        sealed += update.run(encryptSecret(raw), row.id).changes;
                    } catch (error) {
                        console.warn(`   playback_tokens id=${row.id}: seal failed (${error.message}) — left as-is`);
                    }
                }
            });
            sealAll();
            if (sealed > 0) console.log(`   playback_tokens.share_key_prefix: ${sealed} row(s) sealed`);
            else console.log('   playback_tokens.share_key_prefix: nothing to seal');
        }
    }

    console.log('Share-key seal migration completed successfully');
} catch (error) {
    console.error('Share-key seal migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
