/**
 * Password History Service
 * Manages password history to prevent reuse of previous passwords.
 * 
 * Requirements: 6.7
 * 
 * - Store last 5 password hashes
 * - Prevent reuse of previous passwords
 */

import bcrypt from 'bcrypt';
import { query, execute } from '../database/database.js';
import { PASSWORD_POLICY } from './passwordValidator.js';

/**
 * Add password to history
 * @param {number} userId - User ID
 * @param {string} passwordHash - Hashed password to store
 * @returns {boolean} Success status
 */
export function addPasswordToHistory(userId, passwordHash) {
    try {
        // Insert new password hash
        execute(
            'INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)',
            [userId, passwordHash]
        );
        
        // Clean up old entries (keep only last N passwords)
        cleanupOldPasswords(userId);
        
        return true;
    } catch (error) {
        console.error('Error adding password to history:', error);
        return false;
    }
}

/**
 * Check if password was used before
 * @param {number} userId - User ID
 * @param {string} newPassword - Plain text password to check
 * @returns {Promise<boolean>} True if password was used before
 */
export async function wasPasswordUsedBefore(userId, newPassword) {
    try {
        // Get password history for user
        const history = query(
            `SELECT password_hash FROM password_history 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT ?`,
            [userId, PASSWORD_POLICY.historyCount]
        );
        
        // Check each historical password
        for (const entry of history) {
            const isMatch = await bcrypt.compare(newPassword, entry.password_hash);
            if (isMatch) {
                return true;
            }
        }
        
        // Also check current password in users table
        const currentPassword = query(
            'SELECT password_hash FROM users WHERE id = ?',
            [userId]
        );
        
        if (currentPassword.length > 0) {
            const isCurrentMatch = await bcrypt.compare(newPassword, currentPassword[0].password_hash);
            if (isCurrentMatch) {
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.error('Error checking password history:', error);
        return false;
    }
}

/**
 * Get password history count for user
 * @param {number} userId - User ID
 * @returns {number} Number of passwords in history
 */
export function getPasswordHistoryCount(userId) {
    try {
        const result = query(
            'SELECT COUNT(*) as count FROM password_history WHERE user_id = ?',
            [userId]
        );
        return result[0]?.count || 0;
    } catch (error) {
        console.error('Error getting password history count:', error);
        return 0;
    }
}

/**
 * Clean up old password entries (keep only last N)
 * @param {number} userId - User ID
 */
function cleanupOldPasswords(userId) {
    try {
        // Get IDs of passwords to keep
        const toKeep = query(
            `SELECT id FROM password_history 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT ?`,
            [userId, PASSWORD_POLICY.historyCount]
        );
        
        if (toKeep.length === 0) return;
        
        const keepIds = toKeep.map(p => p.id);
        
        // Delete passwords not in the keep list
        execute(
            `DELETE FROM password_history 
             WHERE user_id = ? AND id NOT IN (${keepIds.join(',')})`,
            [userId]
        );
    } catch (error) {
        console.error('Error cleaning up old passwords:', error);
    }
}

/**
 * Clear all password history for a user (used when user is deleted)
 * @param {number} userId - User ID
 * @returns {boolean} Success status
 */
export function clearPasswordHistory(userId) {
    try {
        execute('DELETE FROM password_history WHERE user_id = ?', [userId]);
        return true;
    } catch (error) {
        console.error('Error clearing password history:', error);
        return false;
    }
}

/**
 * Get last password change date
 * @param {number} userId - User ID
 * @returns {Date|null} Last password change date or null
 */
export function getLastPasswordChangeDate(userId) {
    try {
        const result = query(
            `SELECT created_at FROM password_history 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 1`,
            [userId]
        );
        
        if (result.length > 0) {
            return new Date(result[0].created_at);
        }
        
        return null;
    } catch (error) {
        console.error('Error getting last password change date:', error);
        return null;
    }
}

export default {
    addPasswordToHistory,
    wasPasswordUsedBefore,
    getPasswordHistoryCount,
    clearPasswordHistory,
    getLastPasswordChangeDate
};
