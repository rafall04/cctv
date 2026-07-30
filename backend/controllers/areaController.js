import areaService from '../services/areaService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

export async function getAllAreas(request, reply) {
    try {
        const result = areaService.getAllAreas();
        return reply.send({
            success: true,
            data: result.areas,
            cached: result.isCached
        });
    } catch (error) {
        console.error('Get all areas error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Public landing-page variant: camera counts include community-class cameras only,
// so rented/private cameras never leak (even as a count) into public surfaces.
export async function getPublicAreas(request, reply) {
    try {
        const result = areaService.getAllAreas({ publicOnly: true });
        return reply.send({
            success: true,
            data: result.areas,
            cached: result.isCached
        });
    } catch (error) {
        console.error('Get public areas error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function getAreaFilters(request, reply) {
    try {
        const result = areaService.getAreaFilters();
        return reply.send({
            success: true,
            data: result.data,
            cached: result.isCached
        });
    } catch (error) {
        console.error('Get area filters error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function getAreaSummary(request, reply) {
    try {
        const result = areaService.getAreaSummary();
        return reply.send({
            success: true,
            data: result.data,
            cached: result.isCached,
        });
    } catch (error) {
        console.error('Get area summary error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function getAreaAdminOverview(request, reply) {
    try {
        const result = areaService.getAdminOverview();
        return reply.send({
            success: true,
            data: result.data,
            cached: result.isCached,
        });
    } catch (error) {
        console.error('Get area admin overview error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function getAreaById(request, reply) {
    try {
        const { id } = request.params;
        const area = areaService.getAreaById(id);
        return reply.send({ success: true, data: area });
    } catch (error) {
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Get area by id error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function createArea(request, reply) {
    try {
        const newArea = areaService.createArea(request.body);
        logAdminAction({
            action: 'CREATE_AREA',
            targetType: 'area',
            targetId: newArea?.id,
            details: { name: newArea?.name, kecamatan: newArea?.kecamatan },
            userId: request.user?.id,
        }, request);
        return reply.code(201).send({
            success: true,
            message: 'Area created successfully',
            data: newArea,
        });
    } catch (error) {
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        console.error('Create area error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function updateArea(request, reply) {
    try {
        const { id } = request.params;
        // Read before the write: an audit trail exists to answer "what was it before".
        const before = areaService.getAreaById(id);
        const updatedArea = areaService.updateArea(id, request.body);
        logAdminAction({
            action: 'UPDATE_AREA',
            targetType: 'area',
            targetId: Number(id),
            details: {
                name: updatedArea?.name,
                // Only the fields that change what the PUBLIC sees are worth carrying.
                from: before && {
                    name: before.name,
                    show_on_grid_default: before.show_on_grid_default,
                    coverage_scope: before.coverage_scope,
                },
                to: {
                    name: updatedArea?.name,
                    show_on_grid_default: updatedArea?.show_on_grid_default,
                    coverage_scope: updatedArea?.coverage_scope,
                },
            },
            userId: request.user?.id,
        }, request);
        return reply.send({
            success: true,
            message: 'Area updated successfully',
            data: updatedArea,
        });
    } catch (error) {
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Update area error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

export async function deleteArea(request, reply) {
    try {
        const { id } = request.params;
        // Capture identity BEFORE deletion — afterwards the row is gone, and a log that can only
        // say "area 12 was deleted" is useless when reconstructing what happened.
        const before = areaService.getAreaById(id);
        areaService.deleteArea(id);
        logAdminAction({
            action: 'DELETE_AREA',
            targetType: 'area',
            targetId: Number(id),
            details: { name: before?.name, kecamatan: before?.kecamatan },
            userId: request.user?.id,
        }, request);
        return reply.send({ success: true, message: 'Area deleted successfully' });
    } catch (error) {
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        console.error('Delete area error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}
