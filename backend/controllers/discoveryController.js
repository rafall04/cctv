import { discoveryService } from '../services/discoveryService.js';

export async function getDiscoveryItems(request, reply) {
    try {
        const items = discoveryService.getAllDiscoveryItems();
        return reply.send({ success: true, data: items });
    } catch (error) {
        console.error('[DiscoveryController] Get Items Error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function runScraper(request, reply) {
    try {
        const { source_type } = request.body;
        if (!source_type) {
            const err = new Error('source_type is required');
            err.statusCode = 400;
            throw err;
        }

        const result = await discoveryService.discoverCameras(source_type);
        return reply.send({ 
            success: true, 
            message: `Scraper executed successfully for ${source_type}`,
            data: result 
        });
    } catch (error) {
        console.error('[DiscoveryController] Run Scraper Error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: error.message || 'Internal server error' });
    }
}

export async function importSelected(request, reply) {
    try {
        const { ids, target_area_id } = request.body;
        
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            const err = new Error('ids array is required and cannot be empty');
            err.statusCode = 400;
            throw err;
        }

        if (!target_area_id) {
            const err = new Error('target_area_id is required');
            err.statusCode = 400;
            throw err;
        }

        const result = await discoveryService.importToCameras(ids, target_area_id);
        
        return reply.send({ 
            success: true, 
            message: `${result.imported_count} cameras imported successfully`,
            data: result 
        });
    } catch (error) {
        console.error('[DiscoveryController] Import Selected Error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function rejectSelected(request, reply) {
    try {
        const { ids } = request.body;
        
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            const err = new Error('ids array is required and cannot be empty');
            err.statusCode = 400;
            throw err;
        }

        const result = discoveryService.rejectItems(ids);
        
        return reply.send({ 
            success: true, 
            message: `${result.rejected} items rejected successfully`,
            data: result 
        });
    } catch (error) {
        console.error('[DiscoveryController] Reject Items Error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
