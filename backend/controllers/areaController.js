import areaService from '../services/areaService.js';

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
        const updatedArea = areaService.updateArea(id, request.body);
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
        areaService.deleteArea(id);
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
