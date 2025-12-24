import { query, queryOne, execute, transaction } from '../database/database.js';

export async function getAllAreas(request, reply) {
    try {
        const areas = query('SELECT * FROM areas ORDER BY name ASC');
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
        const { name, description } = request.body;

        if (!name) {
            return reply.code(400).send({
                success: false,
                message: 'Area name is required',
            });
        }

        const result = execute(
            'INSERT INTO areas (name, description) VALUES (?, ?)',
            [name, description]
        );

        const newArea = queryOne('SELECT * FROM areas WHERE id = ?', [result.lastInsertRowid]);

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
        const { name, description } = request.body;

        const area = queryOne('SELECT * FROM areas WHERE id = ?', [id]);
        if (!area) {
            return reply.code(404).send({
                success: false,
                message: 'Area not found',
            });
        }

        execute(
            'UPDATE areas SET name = ?, description = ? WHERE id = ?',
            [name || area.name, description !== undefined ? description : area.description, id]
        );

        const updatedArea = queryOne('SELECT * FROM areas WHERE id = ?', [id]);

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
