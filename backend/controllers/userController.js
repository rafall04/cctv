import bcrypt from 'bcrypt';
import { query, queryOne, execute } from '../database/database.js';
import { validatePassword, getPasswordRequirements } from '../services/passwordValidator.js';
import { addPasswordToHistory, wasPasswordUsedBefore } from '../services/passwordHistory.js';
import { updatePasswordChangedAt, checkPasswordExpiryWarning } from '../services/passwordExpiry.js';
import { invalidateUserSessionsOnPasswordChange } from '../services/sessionManager.js';
import { 
    logUserCreated, 
    logUserUpdated, 
    logUserDeleted, 
    logPasswordChanged,
    logPasswordValidationFailed 
} from '../services/securityAuditLogger.js';

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

        // Validate password against security policy (Requirements 6.1, 6.2, 6.3, 6.4)
        const passwordValidation = validatePassword(password, username);
        if (!passwordValidation.valid) {
            logPasswordValidationFailed({
                username,
                errors: passwordValidation.errors,
                action: 'create_user'
            }, request);
            
            return reply.code(400).send({
                success: false,
                message: 'Password does not meet security requirements',
                errors: passwordValidation.errors,
                requirements: getPasswordRequirements()
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

        // Insert user with password_changed_at timestamp
        const result = execute(
            'INSERT INTO users (username, password_hash, role, password_changed_at) VALUES (?, ?, ?, ?)',
            [username, passwordHash, role || 'admin', new Date().toISOString()]
        );

        // Add password to history (Requirement 6.7)
        addPasswordToHistory(result.lastInsertRowid, passwordHash);

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CREATE_USER', `Created user: ${username}`, request.ip]
        );

        // Log to security audit
        logUserCreated({
            newUserId: result.lastInsertRowid,
            newUsername: username,
            createdByUserId: request.user.id,
            createdByUsername: request.user.username,
            role: role || 'admin'
        }, request);

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

        // Log to security audit
        logUserUpdated({
            targetUserId: parseInt(id),
            targetUsername: existingUser.username,
            updatedByUserId: request.user.id,
            updatedByUsername: request.user.username,
            changes: { username, role }
        }, request);

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

        // Check if user exists
        const user = queryOne('SELECT id, username, password_hash FROM users WHERE id = ?', [id]);
        if (!user) {
            return reply.code(404).send({
                success: false,
                message: 'User not found',
            });
        }

        // Validate password against security policy (Requirements 6.1, 6.2, 6.3, 6.4)
        const passwordValidation = validatePassword(password, user.username);
        if (!passwordValidation.valid) {
            logPasswordValidationFailed({
                username: user.username,
                errors: passwordValidation.errors,
                action: 'change_password'
            }, request);
            
            return reply.code(400).send({
                success: false,
                message: 'Password does not meet security requirements',
                errors: passwordValidation.errors,
                requirements: getPasswordRequirements()
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

        // Check password history (Requirement 6.7)
        const wasUsedBefore = await wasPasswordUsedBefore(parseInt(id), password);
        if (wasUsedBefore) {
            return reply.code(400).send({
                success: false,
                message: 'Password has been used recently. Please choose a different password.',
            });
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(password, 10);

        // Update password and timestamp
        execute('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?', 
            [passwordHash, new Date().toISOString(), id]);

        // Add to password history (Requirement 6.7)
        addPasswordToHistory(parseInt(id), passwordHash);

        // Invalidate all sessions for this user (Requirement 6.5)
        invalidateUserSessionsOnPasswordChange(parseInt(id));

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CHANGE_PASSWORD', `Changed password for user: ${user.username}`, request.ip]
        );

        // Log to security audit
        logPasswordChanged({
            userId: parseInt(id),
            username: user.username,
            changedBy: request.user.username
        }, request);

        return reply.send({
            success: true,
            message: 'Password changed successfully. All sessions have been invalidated.',
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

        // Log to security audit
        logUserDeleted({
            deletedUserId: parseInt(id),
            deletedUsername: user.username,
            deletedByUserId: request.user.id,
            deletedByUsername: request.user.username
        }, request);

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
            `SELECT id, username, role, created_at, password_changed_at FROM users WHERE id = ?`,
            [request.user.id]
        );

        if (!user) {
            return reply.code(404).send({
                success: false,
                message: 'User not found',
            });
        }

        // Check password expiry warning (Requirement 6.6)
        const expiryWarning = checkPasswordExpiryWarning(request.user.id);

        return reply.send({
            success: true,
            data: {
                ...user,
                passwordExpiryWarning: expiryWarning.shouldWarn ? expiryWarning : null
            },
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

        // Get user
        const user = queryOne('SELECT username, password_hash FROM users WHERE id = ?', [userId]);
        if (!user) {
            return reply.code(404).send({
                success: false,
                message: 'User not found',
            });
        }

        // Validate new password against security policy (Requirements 6.1, 6.2, 6.3, 6.4)
        const passwordValidation = validatePassword(new_password, user.username);
        if (!passwordValidation.valid) {
            logPasswordValidationFailed({
                username: user.username,
                errors: passwordValidation.errors,
                action: 'change_own_password'
            }, request);
            
            return reply.code(400).send({
                success: false,
                message: 'Password does not meet security requirements',
                errors: passwordValidation.errors,
                requirements: getPasswordRequirements()
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

        // Check password history (Requirement 6.7)
        const wasUsedBefore = await wasPasswordUsedBefore(userId, new_password);
        if (wasUsedBefore) {
            return reply.code(400).send({
                success: false,
                message: 'Password has been used recently. Please choose a different password.',
            });
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(new_password, 10);

        // Update password and timestamp
        execute('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?', 
            [passwordHash, new Date().toISOString(), userId]);

        // Add to password history (Requirement 6.7)
        addPasswordToHistory(userId, passwordHash);

        // Invalidate all sessions for this user (Requirement 6.5)
        invalidateUserSessionsOnPasswordChange(userId);

        // Log action
        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'CHANGE_OWN_PASSWORD', 'Changed own password', request.ip]
        );

        // Log to security audit
        logPasswordChanged({
            userId: userId,
            username: user.username,
            changedBy: user.username
        }, request);

        return reply.send({
            success: true,
            message: 'Password changed successfully. Please login again.',
        });
    } catch (error) {
        console.error('Change own password error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
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
