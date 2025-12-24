import axios from 'axios';
import { config } from '../config/config.js';

const MEDIAMTX_API_URL = `${config.mediamtx.apiUrl}/v3`;

export const mediaMtxService = {
    // Add or Update a path configuration
    async addPath(name, source) {
        try {
            console.log(`[MediaMTX] Adding/Updating path: ${name}, source: ${source}`);

            // MediaMTX v3 API: POST /config/paths/add/{name}
            // Payload: { source: "..." }
            // Note: If path exists, we might need to use PATCH or replace it. 
            // For simplicity in v3, we often check existence first or just try to add.

            // First, try to get the path to see if it exists
            try {
                await axios.get(`${MEDIAMTX_API_URL}/config/paths/get/${name}`);
                // If successful, it exists. We should update it.
                // PUT /config/paths/replace/{name}
                await axios.post(`${MEDIAMTX_API_URL}/config/paths/replace/${name}`, {
                    source: source,
                    sourceOnDemand: true,
                });
                console.log(`[MediaMTX] Path ${name} updated successfully`);
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    // Path doesn't exist, create it
                    await axios.post(`${MEDIAMTX_API_URL}/config/paths/add/${name}`, {
                        source: source,
                        sourceOnDemand: true,
                    });
                    console.log(`[MediaMTX] Path ${name} created successfully`);
                } else {
                    throw error;
                }
            }
            return true;
        } catch (error) {
            console.error('[MediaMTX] Add/Update path error:', error.message);
            // Don't throw, just log. We don't want to break the main app flow if MediaMTX is down.
            return false;
        }
    },

    // Remove a path
    async removePath(name) {
        try {
            console.log(`[MediaMTX] Removing path: ${name}`);
            await axios.delete(`${MEDIAMTX_API_URL}/config/paths/delete/${name}`);
            console.log(`[MediaMTX] Path ${name} removed successfully`);
            return true;
        } catch (error) {
            // Ignore 404 (already deleted)
            if (error.response && error.response.status === 404) return true;

            console.error('[MediaMTX] Remove path error:', error.message);
            return false;
        }
    },

    // Get global stats (paths, sessions, etc.)
    async getStats() {
        try {
            const [paths, sessions] = await Promise.all([
                axios.get(`${MEDIAMTX_API_URL}/paths/list`),
                axios.get(`${MEDIAMTX_API_URL}/sessions/list`)
            ]);

            return {
                paths: paths.data.items || [],
                sessions: sessions.data.items || [],
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('[MediaMTX] Get stats error:', error.message);
            return {
                paths: [],
                sessions: [],
                error: error.message
            };
        }
    }
};
