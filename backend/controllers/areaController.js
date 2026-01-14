import { query, queryOne, execute, transaction } from '../database/database.js';
import cache, { CacheTTL, CacheNamespace, cacheKey } from '../services/cacheService.js';

// Cache keys
const CACHE_ALL_AREAS = cacheKey(CacheNamespace.AREAS, 'all');
const CACHE_AREA_FILTERS = cacheKey(CacheNamespace.AREAS, 'filters');

/**
 * Invalidate all area-related caches
 */
function invalidateAreaCache() {
    cache.invalidate(`${CacheNamespace.AREAS}:`);
    // Also invalidate camera cache karena area_name bisa berubah
    cache.invalidate(`${CacheNamespace.CAMERAS}:`);
    console.log('[Cache] Area cache invalidated');
}

export async function getAllAreas(request, reply) {
    try {
        // Try cache first
        const cached = cache.get(CACHE_ALL_AREAS);
        if (cached) {
            return reply.send({
                success: true,
                data: cached,
                cached: true
            });
        }

        const areas = query(`
            SELECT a.*, 
                   (SELECT COUNT(*) FROM cameras c WHERE c.area_id = a.id) as camera_count
            FROM areas a 
            ORDER BY a.kecamatan, a.kelurahan, a.rw, a.rt, a.name ASC
        `);

        // Cache for 5 minutes
        cache.set(CACHE_ALL_AREAS, areas, CacheTTL.LONG);

        return reply.send({
            success: true,
            data: areas,
        });
    } catch (error) {
        console.error('Get all areas error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Get unique filter options for hierarchical filtering
export async function getAreaFilters(request, reply) {
    try {
        // Try cache first
        const cached = cache.get(CACHE_AREA_FILTERS);
        if (cached) {
            return reply.send({
                success: true,
                data: cached,
                cached: true
            });
        }

        const kecamatans = query(`SELECT DISTINCT kecamatan FROM areas WHERE kecamatan IS NOT NULL AND kecamatan != '' ORDER BY kecamatan`);
        const kelurahans = query(`SELECT DISTINCT kelurahan, kecamatan FROM areas WHERE kelurahan IS NOT NULL AND kelurahan != '' ORDER BY kelurahan`);
        const rws = query(`SELECT DISTINCT rw, kelurahan, kecamatan FROM areas WHERE rw IS NOT NULL AND rw != '' ORDER BY rw`);
        
        const data = {
            kecamatans: kecamatans.map(k => k.kecamatan),
            kelurahans,
            rws,
        };

        // Cache for 15 minutes (filters rarely change)
        cache.set(CACHE_AREA_FILTERS, data, CacheTTL.VERY_LONG);

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        console.error('Get area filters error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getAreaById(request, reply) {
    try {
        const { id } = request.params;
        const area = queryOne('SELECT * FROM areas WHERE id = ?', [id]);

        if (!area) {
            return reply.code(404).send({
                success: false,
                message: 'Area not found',
            });
        }

        return reply.send({
            success: true,
            data: area,
        });
    } catch (error) {
        console.error('Get area by id error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function createArea(request, reply) {
    try {
        const { name, description, rt, rw, kelurahan, kecamatan, latitude, longitude } = request.body;

        if (!name) {
            return reply.code(400).send({
                success: false,
                message: 'Area name is required',
            });
        }

        const result = execute(
            'INSERT INTO areas (name, description, rt, rw, kelurahan, kecamatan, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, description || null, rt || null, rw || null, kelurahan || null, kecamatan || null, latitude || null, longitude || null]
        );

        const newArea = queryOne('SELECT * FROM areas WHERE id = ?', [result.lastInsertRowid]);

        // Invalidate area cache
        invalidateAreaCache();

        return reply.code(201).send({
            success: true,
            message: 'Area created successfully',
            data: newArea,
        });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            return reply.code(400).send({
                success: false,
                message: 'Area name already exists',
            });
        }
        console.error('Create area error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function updateArea(request, reply) {
    try {
        const { id } = request.params;
        const { name, description, rt, rw, kelurahan, kecamatan, latitude, longitude } = request.body;

        const area = queryOne('SELECT * FROM areas WHERE id = ?', [id]);
        if (!area) {
            return reply.code(404).send({
                success: false,
                message: 'Area not found',
            });
        }

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

        // Invalidate area cache
        invalidateAreaCache();

        return reply.send({
            success: true,
            message: 'Area updated successfully',
            data: updatedArea,
        });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            return reply.code(400).send({
                success: false,
                message: 'Area name already exists',
            });
        }
        console.error('Update area error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function deleteArea(request, reply) {
    try {
        const { id } = request.params;

        const area = queryOne('SELECT * FROM areas WHERE id = ?', [id]);
        if (!area) {
            return reply.code(404).send({
                success: false,
                message: 'Area not found',
            });
        }

        // Check if cameras are using this area
        const camerasCount = queryOne('SELECT COUNT(*) as count FROM cameras WHERE area_id = ?', [id]).count;
        if (camerasCount > 0) {
            return reply.code(400).send({
                success: false,
                message: `Cannot delete area. It is currently assigned to ${camerasCount} cameras.`,
            });
        }

        execute('DELETE FROM areas WHERE id = ?', [id]);

        // Invalidate area cache
        invalidateAreaCache();

        return reply.send({
            success: true,
            message: 'Area deleted successfully',
        });
    } catch (error) {
        console.error('Delete area error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
