import { query, execute } from '../database/connectionPool.js';
import JogjaScraper from './scrapers/jogjaScraper.js';

/**
 * A simple implementation of the Haversine formula to calculate the distance between two points on the Earth (in meters).
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity; // Invalid coordinates

    const R = 6371e3; // Earth radius in meters
    const radLat1 = lat1 * Math.PI / 180;
    const radLat2 = lat2 * Math.PI / 180;
    const deltaLat = (lat2 - lat1) * Math.PI / 180;
    const deltaLon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(radLat1) * Math.cos(radLat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

class DiscoveryService {
    constructor() {
        this.scrapers = {
            'jogja_atcs': new JogjaScraper()
        };
    }

    /**
     * Executes the scraper for a given source and loads items into the `camera_discovery` staging table safely.
     * @param {string} source_type - The key identifier of the scraper (e.g. 'jogja_atcs')
     * @returns {Promise<Object>} Results of the operation
     */
    async discoverCameras(source_type) {
        if (!this.scrapers[source_type]) {
            throw new Error(`Scraper not found for source type: ${source_type}`);
        }

        const scraper = this.scrapers[source_type];
        const discoveredItems = await scraper.scrape(); // e.g. [{name, latitude, longitude, hls_url, external_id}, ...]

        // 1. Fetch all existing cameras to detect duplicates
        const existingCameras = this._getAllExistingCameras();

        let newCount = 0;
        let duplicateCount = 0;
        let updateCount = 0;

        // Process each discovered item
        for (const item of discoveredItems) {
            // Check if this specific item already exists in the staging table to avoid double-insertion during daily runs
            const existingStagingItem = query(
                'SELECT id, hls_url FROM camera_discovery WHERE source_type = ? AND external_id = ? AND name = ?', 
                [item.source_type, item.external_id, item.name]
            );

            if (existingStagingItem && existingStagingItem.length > 0) {
                // Already in staging. Should we update the URL if changed?
                const stageItem = existingStagingItem[0];
                if (stageItem.hls_url !== item.hls_url) {
                    execute(
                        "UPDATE camera_discovery SET hls_url = ?, status = 'link_changed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        [item.hls_url, stageItem.id]
                    );
                    updateCount++;
                }
            } else {
                // Not in staging. Deduplicate logic against REAL cameras
                let matchedCameraId = null;
                let computedStatus = 'pending';

                for (const realCam of existingCameras) {
                    // A) URL Match
                    if (realCam.stream_source === 'external' && realCam.external_hls_url === item.hls_url) {
                        matchedCameraId = realCam.id;
                        computedStatus = 'duplicate';
                        break;
                    }
                    
                    // B) Distance Proximity (Less than 20 meters)
                    const distance = calculateDistanceMeters(item.latitude, item.longitude, realCam.latitude, realCam.longitude);
                    if (distance < 20) {
                        matchedCameraId = realCam.id;
                        computedStatus = 'duplicate';
                        console.log(`[Discovery] Found duplicate based on coordinates (${distance}m): ${item.name} equals ${realCam.name}`);
                        break;
                    }

                    // C) Exact Name Match
                    if (realCam.name.toLowerCase() === item.name.toLowerCase()) {
                        matchedCameraId = realCam.id;
                        computedStatus = 'duplicate';
                        break;
                    }
                }

                // Insert new staging item
                execute(`
                    INSERT INTO camera_discovery 
                    (source_type, external_id, name, latitude, longitude, hls_url, status, matched_camera_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    item.source_type,
                    item.external_id,
                    item.name,
                    item.latitude || null,
                    item.longitude || null,
                    item.hls_url,
                    computedStatus,
                    matchedCameraId
                ]);

                if (computedStatus === 'duplicate') duplicateCount++;
                else newCount++;
            }
        }

        return {
            total_discovered: discoveredItems.length,
            newly_added: newCount,
            duplicates_flagged: duplicateCount,
            links_updated: updateCount
        };
    }

    /**
     * Gets all discovery items safely
     */
    getAllDiscoveryItems() {
        return query('SELECT * FROM camera_discovery ORDER BY created_at DESC');
    }

    /**
     * Imports selected staging items into the main cameras table.
     * @param {Array<number>} discoveryIds - Array of camera_discovery.id
     * @param {number} targetAreaId - Foreign key to areas.id
     * @returns {Promise<Object>} results
     */
    async importToCameras(discoveryIds, targetAreaId) {
        if (!discoveryIds || discoveryIds.length === 0) return { imported: 0 };
    
        const placeholders = discoveryIds.map(() => '?').join(',');
        const itemsToImport = query(`SELECT * FROM camera_discovery WHERE id IN (${placeholders}) AND status != 'imported'`, discoveryIds);
    
        let importedCount = 0;
    
        for (const item of itemsToImport) {
            // Default configuration for imported external cameras
            const streamSource = 'external';
            const status = 'online';
            const isOnline = 1;
            const externalUseProxy = 1; // Default to proxy for CORS safety
            const externalTlsMode = 'auto';
    
            const result = execute(`
                INSERT INTO cameras (
                    name, area_id, status, is_online,
                    stream_source, external_hls_url, external_use_proxy, external_tls_mode,
                    latitude, longitude
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                item.name,
                targetAreaId,
                status,
                isOnline,
                streamSource,
                item.hls_url,
                externalUseProxy,
                externalTlsMode,
                item.latitude,
                item.longitude
            ]);
    
            if (result.changes > 0) {
                // Mark as imported
                const newCameraId = result.lastInsertRowid;
                execute(`UPDATE camera_discovery SET status = 'imported', matched_camera_id = ? WHERE id = ?`, [newCameraId, item.id]);
                importedCount++;
            }
        }
    
        return { imported_count: importedCount };
    }

    /**
     * Rejects (hides) selected staging items
     * @param {Array<number>} discoveryIds
     */
    rejectItems(discoveryIds) {
        if (!discoveryIds || discoveryIds.length === 0) return { rejected: 0 };
        const placeholders = discoveryIds.map(() => '?').join(',');
        const result = execute(`UPDATE camera_discovery SET status = 'rejected' WHERE id IN (${placeholders})`, discoveryIds);
        return { rejected: result.changes };
    }

    // --- Private Utilities ---
    _getAllExistingCameras() {
        return query('SELECT id, name, area_id, stream_source, external_hls_url, latitude, longitude FROM cameras');
    }
}

export const discoveryService = new DiscoveryService();
