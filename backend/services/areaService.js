import { query, queryOne, execute } from '../database/connectionPool.js';
import cache, { CacheTTL, CacheNamespace, cacheKey } from './cacheService.js';

const CACHE_ALL_AREAS = cacheKey(CacheNamespace.AREAS, 'all');
const CACHE_AREA_FILTERS = cacheKey(CacheNamespace.AREAS, 'filters');

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
