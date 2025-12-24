import bcrypt from 'bcrypt';
import { query, queryOne, execute } from '../database/database.js';

// Get all users (admin only)
export async function getAllUsers(request, reply) {
    try {
        const users = query(
            `SELECT id, username, role, created_at FROM users ORDER BY id ASC`
        );

        return reply.send({
            success: true,
            data: users,
        });
    } catch (error) {
        console.error('Get all users error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Get user by ID (admin only)
export async function getUserById(request, reply) {
    try {
        const { id } = request.params;

        const user = queryOne(
            `SELECT id, username, role, created_at FROM users WHERE id = ?`,
            [id]
        );

        if (!user) {
            return reply.code(404).send({
                success: false,
                message: 'User not found',
            });
        }

        return reply.send({
            success: true,
            data: user,
        });
    } catch (error) {
        console.error('Get user by ID error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Create new user (admin only)
export async function createUser(request, reply) {
    try {
        const { username, password, role } = request.body;

        // Validate required fields
        if (!username || !password) {
            return reply.code(400).send({
                success: false,
                message: 'Username and password are required',
            });
        }

        // Validate username length
        if (username.length < 3 || username.length > 50) {
            return reply.code(400).send({
                success: false,
                message: 'Username must be between 3 and 50 characters',
            });
        }

        // Validate password length
        if (password.length < 6) {
            return reply.code(400).send({
                success: false,
                message: 'Password must be at least 6 characters',
            });
        }

        // Check if username already exists
        const existingUser = queryOne('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUser) {
            return reply.code(400).send({
                success: false,
                message: 'Username already exists',
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Insert user
        const result = execute(
            'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
            [username, passwordHash, role || 'admin']
        );

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CREATE_USER', `Created user: ${username}`, request.ip]
        );

        return reply.code(201).send({
            success: true,
            message: 'User created successfully',
            data: {
                id: result.lastInsertRowid,
                username,
                role: role || 'admin',
            },
        });
    } catch (error) {
        console.error('Create user error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Update user (admin only)
export async function updateUser(request, reply) {
    try {
        const { id } = request.params;
        const { username, role } = request.body;

        // Check if user exists
        const existingUser = queryOne('SELECT id, username FROM users WHERE id = ?', [id]);
        if (!existingUser) {
            return reply.code(404).send({
                success: false,
                message: 'User not found',
            });
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (username !== undefined) {
            // Check if new username already exists (for different user)
            const duplicateUser = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
            if (duplicateUser) {
                return reply.code(400).send({
                    success: false,
                    message: 'Username already exists',
                });
            }
            updates.push('username = ?');
            values.push(username);
        }

        if (role !== undefined) {
            updates.push('role = ?');
            values.push(role);
        }

        if (updates.length === 0) {
            return reply.code(400).send({
                success: false,
                message: 'No fields to update',
            });
        }

        values.push(id);

        execute(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'UPDATE_USER', `Updated user ID: ${id}`, request.ip]
        );

        return reply.send({
            success: true,
            message: 'User updated successfully',
        });
    } catch (error) {
        console.error('Update user error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Change user password (admin only)
export async function changePassword(request, reply) {
    try {
        const { id } = request.params;
        const { password, current_password } = request.body;

        // Validate password
        if (!password || password.length < 6) {
            return reply.code(400).send({
                success: false,
                message: 'Password must be at least 6 characters',
            });
        }

        // Check if user exists
        const user = queryOne('SELECT id, username, password_hash FROM users WHERE id = ?', [id]);
        if (!user) {
            return reply.code(404).send({
                success: false,
                message: 'User not found',
            });
        }

        // If changing own password, verify current password
        if (request.user.id === parseInt(id) && current_password) {
            const isValidPassword = await bcrypt.compare(current_password, user.password_hash);
            if (!isValidPassword) {
                return reply.code(400).send({
                    success: false,
                    message: 'Current password is incorrect',
                });
            }
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(password, 10);

        // Update password
        execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CHANGE_PASSWORD', `Changed password for user: ${user.username}`, request.ip]
        );

        return reply.send({
            success: true,
            message: 'Password changed successfully',
        });
    } catch (error) {
        console.error('Change password error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Delete user (admin only)
export async function deleteUser(request, reply) {
    try {
        const { id } = request.params;

        // Prevent deleting own account
        if (request.user.id === parseInt(id)) {
            return reply.code(400).send({
                success: false,
                message: 'Cannot delete your own account',
            });
        }

        // Check if user exists
        const user = queryOne('SELECT id, username FROM users WHERE id = ?', [id]);
        if (!user) {
            return reply.code(404).send({
                success: false,
                message: 'User not found',
            });
        }

        // Check if this is the last admin
        const adminCount = queryOne('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin']);
        if (adminCount.count <= 1) {
            return reply.code(400).send({
                success: false,
                message: 'Cannot delete the last admin user',
            });
        }

        // Delete user
        execute('DELETE FROM users WHERE id = ?', [id]);

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'DELETE_USER', `Deleted user: ${user.username} (ID: ${id})`, request.ip]
        );

        return reply.send({
            success: true,
            message: 'User deleted successfully',
        });
    } catch (error) {
        console.error('Delete user error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Get current user profile
export async function getProfile(request, reply) {
    try {
        const user = queryOne(
            `SELECT id, username, role, created_at FROM users WHERE id = ?`,
            [request.user.id]
        );

        if (!user) {
            return reply.code(404).send({
                success: false,
                message: 'User not found',
            });
        }

        return reply.send({
            success: true,
            data: user,
        });
    } catch (error) {
        console.error('Get profile error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Update current user profile
export async function updateProfile(request, reply) {
    try {
        const { username } = request.body;
        const userId = request.user.id;

        if (username) {
            // Check if username already exists
            const duplicateUser = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
            if (duplicateUser) {
                return reply.code(400).send({
                    success: false,
                    message: 'Username already exists',
                });
            }

            execute('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
        }

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'UPDATE_PROFILE', 'Updated own profile', request.ip]
        );

        return reply.send({
            success: true,
            message: 'Profile updated successfully',
        });
    } catch (error) {
        console.error('Update profile error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Change own password
export async function changeOwnPassword(request, reply) {
    try {
        const { current_password, new_password } = request.body;
        const userId = request.user.id;

        // Validate inputs
        if (!current_password || !new_password) {
            return reply.code(400).send({
                success: false,
                message: 'Current password and new password are required',
            });
        }

        if (new_password.length < 6) {
            return reply.code(400).send({
                success: false,
                message: 'New password must be at least 6 characters',
            });
        }

        // Get user
        const user = queryOne('SELECT password_hash FROM users WHERE id = ?', [userId]);
        if (!user) {
            return reply.code(404).send({
                success: false,
                message: 'User not found',
            });
        }

        // Verify current password
        const isValidPassword = await bcrypt.compare(current_password, user.password_hash);
        if (!isValidPassword) {
            return reply.code(400).send({
                success: false,
                message: 'Current password is incorrect',
            });
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(new_password, 10);

        // Update password
        execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'CHANGE_OWN_PASSWORD', 'Changed own password', request.ip]
        );

        return reply.send({
            success: true,
            message: 'Password changed successfully',
        });
    } catch (error) {
        console.error('Change own password error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
