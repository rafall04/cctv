import { query, queryOne, execute } from '../database/connectionPool.js';
import cache, { CacheTTL, CacheNamespace, cacheKey } from './cacheService.js';
import cameraHealthService from './cameraHealthService.js';
import { getCameraDeliveryProfile } from '../utils/cameraDelivery.js';

const CACHE_ALL_AREAS = cacheKey(CacheNamespace.AREAS, 'all');
const CACHE_AREA_FILTERS = cacheKey(CacheNamespace.AREAS, 'filters');
const CACHE_AREA_SUMMARY = cacheKey(CacheNamespace.AREAS, 'summary');

class AreaService {
    invalidateAreaCache() {
        cache.invalidate(`${CacheNamespace.AREAS}:`);
        cache.invalidate(`${CacheNamespace.CAMERAS}:`);
        console.log('[Cache] Area cache invalidated');
    }

    getAllAreas() {
        const cached = cache.get(CACHE_ALL_AREAS);
        if (cached) {
            return { areas: cached, isCached: true };
        }

        const areas = query(`
            SELECT a.*, 
                   (SELECT COUNT(*) FROM cameras c WHERE c.area_id = a.id) as camera_count
            FROM areas a 
            ORDER BY a.kecamatan, a.kelurahan, a.rw, a.rt, a.name ASC
        `);

        cache.set(CACHE_ALL_AREAS, areas, CacheTTL.LONG);
        return { areas, isCached: false };
    }

    getAreaFilters() {
        const cached = cache.get(CACHE_AREA_FILTERS);
        if (cached) {
            return { data: cached, isCached: true };
        }

        const kecamatans = query(`SELECT DISTINCT kecamatan FROM areas WHERE kecamatan IS NOT NULL AND kecamatan != '' ORDER BY kecamatan`);
        const kelurahans = query(`SELECT DISTINCT kelurahan, kecamatan FROM areas WHERE kelurahan IS NOT NULL AND kelurahan != '' ORDER BY kelurahan`);
        const rws = query(`SELECT DISTINCT rw, kelurahan, kecamatan FROM areas WHERE rw IS NOT NULL AND rw != '' ORDER BY rw`);

        const data = {
            kecamatans: kecamatans.map(k => k.kecamatan),
            kelurahans,
            rws,
        };

        cache.set(CACHE_AREA_FILTERS, data, CacheTTL.VERY_LONG);
        return { data, isCached: false };
    }

    getAreaSummary() {
        const cached = cache.get(CACHE_AREA_SUMMARY);
        if (cached) {
            return { data: cached, isCached: true };
        }

        const areas = query(`
            SELECT a.id, a.name, a.kecamatan, a.kelurahan
            FROM areas a
            ORDER BY a.kecamatan, a.kelurahan, a.rw, a.rt, a.name ASC
        `);
        const cameras = query(`
            SELECT c.id, c.name, c.area_id, c.is_online, c.enable_recording, c.stream_source,
                   c.delivery_type, c.private_rtsp_url, c.external_hls_url, c.external_stream_url,
                   c.external_embed_url, c.external_snapshot_url
            FROM cameras c
            WHERE c.area_id IS NOT NULL
            ORDER BY c.area_id ASC, c.id ASC
        `);
        const healthItems = cameraHealthService.getHealthDebugSnapshot();
        const healthByCameraId = new Map(healthItems.map((item) => [item.cameraId, item]));

        const summaryByArea = new Map(
            areas.map((area) => [area.id, {
                areaId: area.id,
                areaName: area.name,
                kecamatan: area.kecamatan || null,
                kelurahan: area.kelurahan || null,
                total: 0,
                online: 0,
                offline: 0,
                internalValid: 0,
                externalValid: 0,
                externalUnresolved: 0,
                recordingEnabled: 0,
                topReasons: [],
            }])
        );

        for (const camera of cameras) {
            const summary = summaryByArea.get(camera.area_id);
            if (!summary) {
                continue;
            }

            const deliveryProfile = getCameraDeliveryProfile(camera);
            const healthItem = healthByCameraId.get(camera.id);

            summary.total += 1;
            if (camera.is_online === 1 || camera.is_online === true) {
                summary.online += 1;
            } else {
                summary.offline += 1;
            }
            if (camera.enable_recording === 1 || camera.enable_recording === true) {
                summary.recordingEnabled += 1;
            }

            if (deliveryProfile.classification === 'internal_hls') {
                summary.internalValid += 1;
            } else if (deliveryProfile.classification === 'external_unresolved') {
                summary.externalUnresolved += 1;
            } else {
                summary.externalValid += 1;
            }

            if (healthItem?.lastReason) {
                const existingReason = summary.topReasons.find((item) => item.reason === healthItem.lastReason);
                if (existingReason) {
                    existingReason.count += 1;
                } else {
                    summary.topReasons.push({ reason: healthItem.lastReason, count: 1 });
                }
            }
        }

        const data = areas.map((area) => {
            const summary = summaryByArea.get(area.id);
            summary.topReasons = summary.topReasons
                .sort((a, b) => b.count - a.count)
                .slice(0, 3);
            return summary;
        });

        cache.set(CACHE_AREA_SUMMARY, data, CacheTTL.SHORT);
        return { data, isCached: false };
    }

    getAreaById(id) {
        const area = queryOne('SELECT * FROM areas WHERE id = ?', [id]);
        if (!area) {
            const err = new Error('Area not found');
            err.statusCode = 404;
            throw err;
        }
        return area;
    }

    createArea(data) {
        const { name, description, rt, rw, kelurahan, kecamatan, latitude, longitude } = data;

        if (!name) {
            const err = new Error('Area name is required');
            err.statusCode = 400;
            throw err;
        }

        try {
            const result = execute(
                'INSERT INTO areas (name, description, rt, rw, kelurahan, kecamatan, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [name, description || null, rt || null, rw || null, kelurahan || null, kecamatan || null, latitude || null, longitude || null]
            );

            const newArea = queryOne('SELECT * FROM areas WHERE id = ?', [result.lastInsertRowid]);
            this.invalidateAreaCache();
            return newArea;
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                const err = new Error('Area name already exists');
                err.statusCode = 400;
                throw err;
            }
            throw error;
        }
    }

    updateArea(id, data) {
        const { name, description, rt, rw, kelurahan, kecamatan, latitude, longitude } = data;

        const area = queryOne('SELECT * FROM areas WHERE id = ?', [id]);
        if (!area) {
            const err = new Error('Area not found');
            err.statusCode = 404;
            throw err;
        }

        try {
            execute(
                'UPDATE areas SET name = ?, description = ?, rt = ?, rw = ?, kelurahan = ?, kecamatan = ?, latitude = ?, longitude = ? WHERE id = ?',
                [
                    name || area.name,
                    description !== undefined ? description : area.description,
                    rt !== undefined ? (rt || null) : area.rt,
                    rw !== undefined ? (rw || null) : area.rw,
                    kelurahan !== undefined ? (kelurahan || null) : area.kelurahan,
                    kecamatan !== undefined ? (kecamatan || null) : area.kecamatan,
                    latitude !== undefined ? (latitude || null) : area.latitude,
                    longitude !== undefined ? (longitude || null) : area.longitude,
                    id
                ]
            );

            const updatedArea = queryOne('SELECT * FROM areas WHERE id = ?', [id]);
            this.invalidateAreaCache();
            return updatedArea;
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                const err = new Error('Area name already exists');
                err.statusCode = 400;
                throw err;
            }
            throw error;
        }
    }

    deleteArea(id) {
        const area = queryOne('SELECT * FROM areas WHERE id = ?', [id]);
        if (!area) {
            const err = new Error('Area not found');
            err.statusCode = 404;
            throw err;
        }

        const camerasCount = queryOne('SELECT COUNT(*) as count FROM cameras WHERE area_id = ?', [id]).count;
        if (camerasCount > 0) {
            const err = new Error(`Cannot delete area. It is currently assigned to ${camerasCount} cameras.`);
            err.statusCode = 400;
            throw err;
        }

        execute('DELETE FROM areas WHERE id = ?', [id]);
        this.invalidateAreaCache();
    }
}

export default new AreaService();
