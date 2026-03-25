import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getEffectiveDeliveryType, getPrimaryExternalStreamUrl } from '../utils/cameraDelivery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Running migration: backfill_camera_delivery_types');
console.log('Database path:', dbPath);

const db = new Database(dbPath);
const tableInfo = db.prepare('PRAGMA table_info(cameras)').all();

const hasDeliveryType = tableInfo.some((column) => column.name === 'delivery_type');
const hasExternalStreamUrl = tableInfo.some((column) => column.name === 'external_stream_url');

if (!hasDeliveryType || !hasExternalStreamUrl) {
    console.log('Required delivery columns do not exist yet, skipping backfill');
    db.close();
    process.exit(0);
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

db.close();
console.log(`Backfilled delivery_type for ${cameras.length} camera rows`);
