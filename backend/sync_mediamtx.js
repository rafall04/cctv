import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, 'data/cctv.db');
const MEDIAMTX_API_URL = 'http://127.0.0.1:9997/v3';

async function sync() {
    try {
        const db = new Database(dbPath);
        console.log('Connected to database at:', dbPath);

        const cameras = db.prepare('SELECT id, name, private_rtsp_url, enabled FROM cameras').all();
        console.log(`Found ${cameras.length} cameras in database.`);

        for (const camera of cameras) {
            if (camera.enabled && camera.private_rtsp_url) {
                const name = `camera${camera.id}`;
                const source = camera.private_rtsp_url;

                console.log(`[Sync] Syncing ${name} (${camera.name})...`);
                console.log(`       Source: ${source}`);

                const pathConfig = {
                    source: source,
                    sourceProtocol: 'tcp',
                    sourceOnDemand: true,
                    sourceOnDemandStartTimeout: '10s',
                    sourceOnDemandCloseAfter: '30s',
                };

                try {
                    // Try to add path first
                    await axios.post(`${MEDIAMTX_API_URL}/config/paths/add/${name}`, pathConfig);
                    console.log(`  ✓ ${name} added`);
                } catch (error) {
                    if (error.response && error.response.status === 400) {
                        // Path exists, try to patch
                        try {
                            await axios.patch(`${MEDIAMTX_API_URL}/config/paths/patch/${name}`, pathConfig);
                            console.log(`  ✓ ${name} updated`);
                        } catch (patchError) {
                            console.error(`  ✗ Failed to patch ${name}:`, patchError.message);
                        }
                    } else {
                        console.error(`  ✗ Failed to add ${name}:`, error.message);
                    }
                }
            } else {
                console.log(`[Skip] camera${camera.id} (${camera.name}) - disabled or no RTSP URL`);
            }
        }

        db.close();
        console.log('\nSync completed.');
        console.log('Test stream at: http://localhost:8888/camera1/index.m3u8');
    } catch (error) {
        console.error('Sync error:', error);
    }
}

sync();
