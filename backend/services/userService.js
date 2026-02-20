import bcrypt from 'bcrypt';
import { query, queryOne, execute } from '../database/database.js';
import { validatePassword, getPasswordRequirements } from './passwordValidator.js';
import { addPasswordToHistory, wasPasswordUsedBefore } from './passwordHistory.js';
import { updatePasswordChangedAt, checkPasswordExpiryWarning } from './passwordExpiry.js';
import { invalidateUserSessionsOnPasswordChange } from './sessionManager.js';
import {
    logUserCreated,
    logUserUpdated,
    logUserDeleted,
    logPasswordChanged,
    logPasswordValidationFailed
} from './securityAuditLogger.js';

class UserService {
    getAllUsers() {
        return query(`SELECT id, username, role, created_at FROM users ORDER BY id ASC`);
    }

    getUserById(id) {
        const user = queryOne(`SELECT id, username, role, created_at FROM users WHERE id = ?`, [id]);
        if (!user) {
            const err = new Error('User not found');
            err.statusCode = 404;
            throw err;
        }
        return user;
    }

    async createUser(data, request) {
        const { username, password, role } = data;

        if (!username || !password) {
            const err = new Error('Username and password are required');
            err.statusCode = 400;
            throw err;
        }

        if (username.length < 3 || username.length > 50) {
            const err = new Error('Username must be between 3 and 50 characters');
            err.statusCode = 400;
            throw err;
        }

        const passwordValidation = validatePassword(password, username);
        if (!passwordValidation.valid) {
            logPasswordValidationFailed({
                username,
                errors: passwordValidation.errors,
                action: 'create_user'
            }, request);

            const err = new Error('Password does not meet security requirements');
            err.statusCode = 400;
            err.errors = passwordValidation.errors;
            err.requirements = getPasswordRequirements();
            throw err;
        }

        const existingUser = queryOne('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUser) {
            const err = new Error('Username already exists');
            err.statusCode = 400;
            throw err;
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        const result = execute(
            'INSERT INTO users (username, password_hash, role, password_changed_at) VALUES (?, ?, ?, ?)',
            [username, passwordHash, role || 'admin', new Date().toISOString()]
        );

        addPasswordToHistory(result.lastInsertRowid, passwordHash);

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CREATE_USER', `Created user: ${username}`, request.ip]
        );

        logUserCreated({
            newUserId: result.lastInsertRowid,
            newUsername: username,
            createdByUserId: request.user.id,
            createdByUsername: request.user.username,
            role: role || 'admin'
        }, request);

        return {
            id: result.lastInsertRowid,
            username,
            role: role || 'admin',
        };
    }

    async updateUser(id, data, request) {
        const { username, role } = data;

        const existingUser = queryOne('SELECT id, username FROM users WHERE id = ?', [id]);
        if (!existingUser) {
            const err = new Error('User not found');
            err.statusCode = 404;
            throw err;
        }

        const updates = [];
        const values = [];

        if (username !== undefined) {
            const duplicateUser = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
            if (duplicateUser) {
                const err = new Error('Username already exists');
                err.statusCode = 400;
                throw err;
            }
            updates.push('username = ?');
            values.push(username);
        }

        if (role !== undefined) {
            updates.push('role = ?');
            values.push(role);
        }

        if (updates.length === 0) {
            const err = new Error('No fields to update');
            err.statusCode = 400;
            throw err;
        }

        values.push(id);

        execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'UPDATE_USER', `Updated user ID: ${id}`, request.ip]
        );

        logUserUpdated({
            targetUserId: parseInt(id),
            targetUsername: existingUser.username,
            updatedByUserId: request.user.id,
            updatedByUsername: request.user.username,
            changes: { username, role }
        }, request);
    }

    async changePassword(id, data, request) {
        const { password, current_password } = data;

        const user = queryOne('SELECT id, username, password_hash FROM users WHERE id = ?', [id]);
        if (!user) {
            const err = new Error('User not found');
            err.statusCode = 404;
            throw err;
        }

        const passwordValidation = validatePassword(password, user.username);
        if (!passwordValidation.valid) {
            logPasswordValidationFailed({
                username: user.username,
                errors: passwordValidation.errors,
                action: 'change_password'
            }, request);

            const err = new Error('Password does not meet security requirements');
            err.statusCode = 400;
            err.errors = passwordValidation.errors;
            err.requirements = getPasswordRequirements();
            throw err;
        }

        if (request.user.id === parseInt(id) && current_password) {
            const isValidPassword = await bcrypt.compare(current_password, user.password_hash);
            if (!isValidPassword) {
                const err = new Error('Current password is incorrect');
                err.statusCode = 400;
                throw err;
            }
        }

        const wasUsedBefore = await wasPasswordUsedBefore(parseInt(id), password);
        if (wasUsedBefore) {
            const err = new Error('Password has been used recently. Please choose a different password.');
            err.statusCode = 400;
            throw err;
        }

        const passwordHash = await bcrypt.hash(password, 10);

        execute('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?',
            [passwordHash, new Date().toISOString(), id]);

        addPasswordToHistory(parseInt(id), passwordHash);
        invalidateUserSessionsOnPasswordChange(parseInt(id));

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'CHANGE_PASSWORD', `Changed password for user: ${user.username}`, request.ip]
        );

        logPasswordChanged({
            userId: parseInt(id),
            username: user.username,
            changedBy: request.user.username
        }, request);
    }

    async deleteUser(id, request) {
        if (request.user.id === parseInt(id)) {
            const err = new Error('Cannot delete your own account');
            err.statusCode = 400;
            throw err;
        }

        const user = queryOne('SELECT id, username FROM users WHERE id = ?', [id]);
        if (!user) {
            const err = new Error('User not found');
            err.statusCode = 404;
            throw err;
        }

        const adminCount = queryOne('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin']);
        if (adminCount.count <= 1) {
            const err = new Error('Cannot delete the last admin user');
            err.statusCode = 400;
            throw err;
        }

        execute('DELETE FROM users WHERE id = ?', [id]);

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [request.user.id, 'DELETE_USER', `Deleted user: ${user.username} (ID: ${id})`, request.ip]
        );

        logUserDeleted({
            deletedUserId: parseInt(id),
            deletedUsername: user.username,
            deletedByUserId: request.user.id,
            deletedByUsername: request.user.username
        }, request);
    }

    getProfile(request) {
        const user = queryOne(
            `SELECT id, username, role, created_at, password_changed_at FROM users WHERE id = ?`,
            [request.user.id]
        );

        if (!user) {
            const err = new Error('User not found');
            err.statusCode = 404;
            throw err;
        }

        const expiryWarning = checkPasswordExpiryWarning(request.user.id);

        return {
            ...user,
            passwordExpiryWarning: expiryWarning.shouldWarn ? expiryWarning : null
        };
    }

    async updateProfile(data, request) {
        const { username } = data;
        const userId = request.user.id;

        if (username) {
            const duplicateUser = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
            if (duplicateUser) {
                const err = new Error('Username already exists');
                err.statusCode = 400;
                throw err;
            }

            execute('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
        }

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'UPDATE_PROFILE', 'Updated own profile', request.ip]
        );
    }

    async changeOwnPassword(data, request) {
        const { current_password, new_password } = data;
        const userId = request.user.id;

        if (!current_password || !new_password) {
            const err = new Error('Current password and new password are required');
            err.statusCode = 400;
            throw err;
        }

        const user = queryOne('SELECT username, password_hash FROM users WHERE id = ?', [userId]);
        if (!user) {
            const err = new Error('User not found');
            err.statusCode = 404;
            throw err;
        }

        const passwordValidation = validatePassword(new_password, user.username);
        if (!passwordValidation.valid) {
            logPasswordValidationFailed({
                username: user.username,
                errors: passwordValidation.errors,
                action: 'change_own_password'
            }, request);

            const err = new Error('Password does not meet security requirements');
            err.statusCode = 400;
            err.errors = passwordValidation.errors;
            err.requirements = getPasswordRequirements();
            throw err;
        }

        const isValidPassword = await bcrypt.compare(current_password, user.password_hash);
        if (!isValidPassword) {
            const err = new Error('Current password is incorrect');
            err.statusCode = 400;
            throw err;
        }

        const wasUsedBefore = await wasPasswordUsedBefore(userId, new_password);
        if (wasUsedBefore) {
            const err = new Error('Password has been used recently. Please choose a different password.');
            err.statusCode = 400;
            throw err;
        }

        const passwordHash = await bcrypt.hash(new_password, 10);

        execute('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?',
            [passwordHash, new Date().toISOString(), userId]);

        addPasswordToHistory(userId, passwordHash);

        invalidateUserSessionsOnPasswordChange(userId);

        execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'CHANGE_OWN_PASSWORD', 'Changed own password', request.ip]
        );

        logPasswordChanged({
            userId: userId,
            username: user.username,
            changedBy: user.username
        }, request);
    }
}

export default new UserService();
