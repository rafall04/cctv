/**
 * Password Expiry Service
 * Manages password expiration and warnings.
 * 
 * Requirements: 6.6
 * 
 * - Track password_changed_at timestamp
 * - Enforce 90-day password change
 * - Return warning when password near expiry
 */

import { query, queryOne, execute } from '../database/connectionPool.js';
import { getPasswordPolicy } from './passwordValidator.js';

/**
 * Password expiry configuration
 */
/*
 * DEFAULTS ONLY — and this was the THIRD copy of "how old may a password get": once in
 * config.security.passwordMaxAgeDays (from .env, read by nothing), once in
 * passwordValidator.PASSWORD_POLICY.maxAge, and once here, which is the copy that actually
 * expires anyone. They agreed at 90 days purely by luck. getExpiryConfig() below is now the
 * single live answer; `warningDays` stays fixed because nothing has ever varied it.
 */
export const PASSWORD_EXPIRY_CONFIG = {
    maxAgeDays: 90,                    // Password expires after 90 days
    warningDays: 14,                   // Warn user 14 days before expiry
    maxAgeMs: 90 * 24 * 60 * 60 * 1000, // 90 days in milliseconds
    warningMs: 14 * 24 * 60 * 60 * 1000 // 14 days in milliseconds
};

/**
 * Live expiry policy: the max age comes from the admin panel (-> .env -> default).
 * @returns {typeof PASSWORD_EXPIRY_CONFIG}
 */
export function getExpiryConfig() {
    const maxAgeMs = getPasswordPolicy().maxAge;
    return {
        maxAgeDays: Math.round(maxAgeMs / (24 * 60 * 60 * 1000)),
        warningDays: PASSWORD_EXPIRY_CONFIG.warningDays,
        maxAgeMs,
        warningMs: PASSWORD_EXPIRY_CONFIG.warningMs,
    };
}

/**
 * Check if user's password is expired
 * @param {number} userId - User ID
 * @returns {Object} { expired: boolean, daysRemaining: number, expiresAt: Date|null }
 */
export function checkPasswordExpiry(userId) {
    try {
        const user = queryOne(
            'SELECT password_changed_at FROM users WHERE id = ?',
            [userId]
        );
        
        if (!user) {
            return { expired: false, daysRemaining: null, expiresAt: null };
        }
        
        // If password_changed_at is not set, consider it as not expired
        // (for backward compatibility with existing users)
        if (!user.password_changed_at) {
            return { expired: false, daysRemaining: null, expiresAt: null };
        }
        
        const passwordChangedAt = new Date(user.password_changed_at);
        const expiresAt = new Date(passwordChangedAt.getTime() + getExpiryConfig().maxAgeMs);
        const now = new Date();
        
        const msRemaining = expiresAt.getTime() - now.getTime();
        const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
        
        return {
            expired: msRemaining <= 0,
            daysRemaining: Math.max(0, daysRemaining),
            expiresAt
        };
    } catch (error) {
        console.error('Error checking password expiry:', error);
        return { expired: false, daysRemaining: null, expiresAt: null };
    }
}

/**
 * Check if user should be warned about password expiry
 * @param {number} userId - User ID
 * @returns {Object} { shouldWarn: boolean, daysRemaining: number, message: string|null }
 */
export function checkPasswordExpiryWarning(userId) {
    const expiryStatus = checkPasswordExpiry(userId);
    
    if (expiryStatus.expired) {
        return {
            shouldWarn: true,
            daysRemaining: 0,
            message: 'Your password has expired. Please change it immediately.'
        };
    }
    
    if (expiryStatus.daysRemaining === null) {
        return { shouldWarn: false, daysRemaining: null, message: null };
    }
    
    if (expiryStatus.daysRemaining <= getExpiryConfig().warningDays) {
        return {
            shouldWarn: true,
            daysRemaining: expiryStatus.daysRemaining,
            message: `Your password will expire in ${expiryStatus.daysRemaining} day${expiryStatus.daysRemaining !== 1 ? 's' : ''}. Please change it soon.`
        };
    }
    
    return { shouldWarn: false, daysRemaining: expiryStatus.daysRemaining, message: null };
}

/**
 * Update password_changed_at timestamp for user
 * @param {number} userId - User ID
 * @returns {boolean} Success status
 */
export function updatePasswordChangedAt(userId) {
    try {
        execute(
            'UPDATE users SET password_changed_at = ? WHERE id = ?',
            [new Date().toISOString(), userId]
        );
        return true;
    } catch (error) {
        console.error('Error updating password_changed_at:', error);
        return false;
    }
}

/**
 * Get password age in days
 * @param {number} userId - User ID
 * @returns {number|null} Password age in days or null if not set
 */
export function getPasswordAgeDays(userId) {
    try {
        const user = queryOne(
            'SELECT password_changed_at FROM users WHERE id = ?',
            [userId]
        );
        
        if (!user || !user.password_changed_at) {
            return null;
        }
        
        const passwordChangedAt = new Date(user.password_changed_at);
        const now = new Date();
        const ageMs = now.getTime() - passwordChangedAt.getTime();
        
        return Math.floor(ageMs / (24 * 60 * 60 * 1000));
    } catch (error) {
        console.error('Error getting password age:', error);
        return null;
    }
}

/**
 * Get users with expired passwords
 * @returns {Array} List of users with expired passwords
 */
export function getUsersWithExpiredPasswords() {
    try {
        const expiryDate = new Date(Date.now() - getExpiryConfig().maxAgeMs);
        
        // `query`, not `queryOne`: this returns a LIST. It used to fetch a single row and wrap
        // it as `users ? [users] : []`, so it reported one overdue account no matter how many
        // there were — an admin rotation report would have quietly understated the problem.
        return query(
            `SELECT id, username, password_changed_at
             FROM users
             WHERE password_changed_at IS NOT NULL
             AND password_changed_at < ?`,
            [expiryDate.toISOString()]
        );
    } catch (error) {
        console.error('Error getting users with expired passwords:', error);
        return [];
    }
}

/**
 * Get users with passwords expiring soon
 * @param {number} withinDays - Number of days to check
 * @returns {Array} List of users with passwords expiring soon
 */
export function getUsersWithPasswordsExpiringSoon(withinDays = getExpiryConfig().warningDays) {
    try {
        const warningDate = new Date(Date.now() - getExpiryConfig().maxAgeMs + (withinDays * 24 * 60 * 60 * 1000));
        const expiryDate = new Date(Date.now() - getExpiryConfig().maxAgeMs);
        
        // Same fix as above — a list function must not be built on queryOne.
        return query(
            `SELECT id, username, password_changed_at
             FROM users
             WHERE password_changed_at IS NOT NULL
             AND password_changed_at < ?
             AND password_changed_at >= ?`,
            [warningDate.toISOString(), expiryDate.toISOString()]
        );
    } catch (error) {
        console.error('Error getting users with passwords expiring soon:', error);
        return [];
    }
}

export default {
    PASSWORD_EXPIRY_CONFIG,
    checkPasswordExpiry,
    checkPasswordExpiryWarning,
    updatePasswordChangedAt,
    getPasswordAgeDays,
    getUsersWithExpiredPasswords,
    getUsersWithPasswordsExpiringSoon
};
