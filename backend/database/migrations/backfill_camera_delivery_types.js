import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, isAbsolute, join } from 'path';
import { config } from '../../config/config.js';
import { getEffectiveDeliveryType, getPrimaryExternalStreamUrl } from '../../utils/cameraDelivery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function resolveMigrationDatabasePath() {
    if (isAbsolute(config.database.path)) {
        return config.database.path;
    }

    return join(__dirname, '..', '..', config.database.path);
}

export function runBackfillCameraDeliveryTypes() {
    const dbPath = resolveMigrationDatabasePath();

    console.log('Running migration: backfill_camera_delivery_types');
    console.log('Database path:', dbPath);

    if (!existsSync(dbPath)) {
        console.log('Database file does not exist yet, skipping backfill');
        return { skipped: true, reason: 'missing_database', dbPath };
    }

    const db = new Database(dbPath);

    try {
        const tableInfo = db.prepare('PRAGMA table_info(cameras)').all();
        const hasDeliveryType = tableInfo.some((column) => column.name === 'delivery_type');
        const hasExternalStreamUrl = tableInfo.some((column) => column.name === 'external_stream_url');

        if (!hasDeliveryType || !hasExternalStreamUrl) {
            console.log('Required delivery columns do not exist yet, skipping backfill');
            return { skipped: true, reason: 'missing_columns', dbPath };
        }

        const cameras = db.prepare(`
            SELECT id, stream_source, delivery_type, external_hls_url, external_stream_url, external_embed_url
            FROM cameras
        `).all();

        const updateStmt = db.prepare(`
            UPDATE cameras
            SET delivery_type = ?,
                external_stream_url = ?,
                external_hls_url = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        const transaction = db.transaction((rows) => {
            for (const camera of rows) {
                const deliveryType = getEffectiveDeliveryType(camera);
                const primaryExternalUrl = getPrimaryExternalStreamUrl(camera);
                const externalStreamUrl = deliveryType === 'internal_hls' ? null : primaryExternalUrl;
                const externalHlsUrl = deliveryType === 'external_hls' ? primaryExternalUrl : null;

                updateStmt.run(deliveryType, externalStreamUrl, externalHlsUrl, camera.id);
            }
        });

        transaction(cameras);
        console.log(`Backfilled delivery_type for ${cameras.length} camera rows`);
        return { skipped: false, updatedRows: cameras.length, dbPath };
    } finally {
        db.close();
    }
}

const executedDirectly = process.argv[1]
    ? pathToFileURL(process.argv[1]).href === import.meta.url
    : false;

if (executedDirectly) {
    runBackfillCameraDeliveryTypes();
}
