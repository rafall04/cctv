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
            if (camera.enabled) {
                const name = `camera${camera.id}`;
                const source = camera.private_rtsp_url;

                console.log(`[Sync] Syncing ${name} (${camera.name})...`);

                try {
                    // Try to add/replace path
                    try {
                        await axios.get(`${MEDIAMTX_API_URL}/config/paths/get/${name}`);
                        // Exists, replace
                        await axios.post(`${MEDIAMTX_API_URL}/config/paths/replace/${name}`, {
                            source: source,
                            sourceOnDemand: false,
                        });
                        console.log(`  ✓ ${name} updated`);
                    } catch (error) {
                        if (error.response && error.response.status === 404) {
                            // Doesn't exist, add
                            await axios.post(`${MEDIAMTX_API_URL}/config/paths/add/${name}`, {
                                source: source,
                                sourceOnDemand: false,
                            });
                            console.log(`  ✓ ${name} added`);
                        } else {
                            throw error;
                        }
                    }
                } catch (error) {
                    console.error(`  ✗ Failed to sync ${name}:`, error.message);
                }
            }
        }

        db.close();
        console.log('Sync completed.');
    } catch (error) {
        console.error('Sync error:', error);
    }
}

sync();
