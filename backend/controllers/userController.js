import userService from '../services/userService.js';
import { getPasswordRequirements } from '../services/passwordValidator.js';

// Get all users (admin only)
export async function getAllUsers(request, reply) {
    try {
        const users = await userService.getAllUsers();
        return reply.send({ success: true, data: users });
    } catch (error) {
        console.error('Get all users error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get user by ID (admin only)
export async function getUserById(request, reply) {
    try {
        const { id } = request.params;
        const user = await userService.getUserById(id);
        return reply.send({ success: true, data: user });
    } catch (error) {
        console.error('Get user by ID error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Create new user (admin only)
export async function createUser(request, reply) {
    try {
        const result = await userService.createUser(request.body, request);
        return reply.code(201).send({
            success: true,
            message: 'User created successfully',
            data: result,
        });
    } catch (error) {
        console.error('Create user error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({
                success: false,
                message: error.message,
                errors: error.errors,
                requirements: error.requirements
            });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Update user (admin only)
export async function updateUser(request, reply) {
    try {
        const { id } = request.params;
        await userService.updateUser(id, request.body, request);
        return reply.send({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Update user error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Change user password (admin only)
export async function changePassword(request, reply) {
    try {
        const { id } = request.params;
        await userService.changePassword(id, request.body, request);
        return reply.send({ success: true, message: 'Password changed successfully. All sessions have been invalidated.' });
    } catch (error) {
        console.error('Change password error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({
                success: false,
                message: error.message,
                errors: error.errors,
                requirements: error.requirements
            });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Delete user (admin only)
export async function deleteUser(request, reply) {
    try {
        const { id } = request.params;
        await userService.deleteUser(id, request);
        return reply.send({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get current user profile
export async function getProfile(request, reply) {
    try {
        const profile = await userService.getProfile(request);
        return reply.send({ success: true, data: profile });
    } catch (error) {
        console.error('Get profile error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Update current user profile
export async function updateProfile(request, reply) {
    try {
        await userService.updateProfile(request.body, request);
        return reply.send({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Update profile error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Change own password
export async function changeOwnPassword(request, reply) {
    try {
        await userService.changeOwnPassword(request.body, request);
        return reply.send({ success: true, message: 'Password changed successfully. Please login again.' });
    } catch (error) {
        console.error('Change own password error:', error);
        if (error.statusCode === 400) {
            return reply.code(400).send({
                success: false,
                message: error.message,
                errors: error.errors,
                requirements: error.requirements
            });
        }
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

// Get password requirements (public endpoint for UI)
export async function getPasswordPolicyRequirements(request, reply) {
    try {
        return reply.send({
            success: true,
            data: {
                requirements: getPasswordRequirements()
            },
        });
    } catch (error) {
        console.error('Get password requirements error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
