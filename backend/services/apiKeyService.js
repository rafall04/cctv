/**
 * API Key Service
 * 
 * Generates and validates API keys for frontend authentication.
 * Uses timing-safe comparison to prevent timing attacks.
 * 
 * Requirements: 1.1
 */

import crypto from 'crypto';
import { execute, query, queryOne } from '../database/database.js';

/**
 * API Key configuration
 */
export const API_KEY_CONFIG = {
    keyLength: 32,          // 32 bytes = 64 hex characters
    headerName: 'X-API-Key',
    rotationDays: 30
};

/**
 * Generate a secure API key
 * @returns {string} 64-character hex string
 */
export function generateApiKey() {
    return crypto.randomBytes(API_KEY_CONFIG.keyLength).toString('hex');
}

/**
 * Hash an API key for storage
 * @param {string} apiKey - The raw API key
 * @returns {string} SHA-256 hash of the key
 */
export function hashApiKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Timing-safe comparison of two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
export function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    
    // Ensure both strings have the same length for timing-safe comparison
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    
    if (bufA.length !== bufB.length) {
        // Still do a comparison to maintain constant time
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Create a new API key and store its hash in the database
 * @param {string} clientName - Name/description of the client
 * @param {number|null} expiresInDays - Days until expiration (null for no expiration)
 * @returns {Object} { id, apiKey, clientName, expiresAt }
 */
export function createApiKey(clientName, expiresInDays = null) {
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    
    let expiresAt = null;
    if (expiresInDays !== null && expiresInDays > 0) {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + expiresInDays);
        expiresAt = expDate.toISOString();
    }
    
    const result = execute(`
        INSERT INTO api_keys (key_hash, client_name, expires_at, is_active)
        VALUES (?, ?, ?, 1)
    `, [keyHash, clientName, expiresAt]);
    
    return {
        id: result.lastInsertRowid,
        apiKey,  // Return the raw key only once - it cannot be retrieved later
        clientName,
        expiresAt,
        createdAt: new Date().toISOString()
    };
}

/**
 * Validate an API key
 * @param {string} apiKey - The API key to validate
 * @returns {Object} { valid: boolean, clientId: number|null, clientName: string|null, reason: string|null }
 */
export function validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
        return { valid: false, clientId: null, clientName: null, reason: 'missing' };
    }
    
    // Check key format (should be 64 hex characters)
    if (apiKey.length !== 64 || !/^[a-f0-9]+$/i.test(apiKey)) {
        return { valid: false, clientId: null, clientName: null, reason: 'invalid_format' };
    }
    
    const keyHash = hashApiKey(apiKey);
    
    // Get all active keys and compare using timing-safe comparison
    const activeKeys = query(`
        SELECT id, key_hash, client_name, expires_at
        FROM api_keys
        WHERE is_active = 1
    `);
    
    for (const key of activeKeys) {
        if (timingSafeEqual(keyHash, key.key_hash)) {
            // Check expiration
            if (key.expires_at && new Date(key.expires_at) < new Date()) {
                return { valid: false, clientId: key.id, clientName: key.client_name, reason: 'expired' };
            }
            
            // Update last_used_at
            execute(`
                UPDATE api_keys SET last_used_at = ? WHERE id = ?
            `, [new Date().toISOString(), key.id]);
            
            return { valid: true, clientId: key.id, clientName: key.client_name, reason: null };
        }
    }
    
    return { valid: false, clientId: null, clientName: null, reason: 'invalid' };
}

/**
 * Revoke an API key
 * @param {number} keyId - The ID of the key to revoke
 * @returns {boolean} True if key was revoked
 */
export function revokeApiKey(keyId) {
    const result = execute(`
        UPDATE api_keys SET is_active = 0 WHERE id = ?
    `, [keyId]);
    
    return result.changes > 0;
}

/**
 * Get all active API keys (without the actual key hash for security)
 * @returns {Array} List of active API keys
 */
export function getActiveApiKeys() {
    return query(`
        SELECT id, client_name, created_at, expires_at, last_used_at, is_active
        FROM api_keys
        WHERE is_active = 1
        ORDER BY created_at DESC
    `);
}

/**
 * Get API key by ID
 * @param {number} keyId - The ID of the key
 * @returns {Object|null} API key info or null
 */
export function getApiKeyById(keyId) {
    return queryOne(`
        SELECT id, client_name, created_at, expires_at, last_used_at, is_active
        FROM api_keys
        WHERE id = ?
    `, [keyId]);
}

/**
 * Check if any API keys exist
 * @returns {boolean} True if at least one active API key exists
 */
export function hasActiveApiKeys() {
    const result = queryOne(`
        SELECT COUNT(*) as count FROM api_keys WHERE is_active = 1
    `);
    return result && result.count > 0;
}

/**
 * Delete expired API keys
 * @returns {number} Number of deleted keys
 */
export function cleanupExpiredKeys() {
    const result = execute(`
        DELETE FROM api_keys
        WHERE expires_at IS NOT NULL AND expires_at < ?
    `, [new Date().toISOString()]);
    
    return result.changes;
}

export default {
    API_KEY_CONFIG,
    generateApiKey,
    hashApiKey,
    timingSafeEqual,
    createApiKey,
    validateApiKey,
    revokeApiKey,
    getActiveApiKeys,
    getApiKeyById,
    hasActiveApiKeys,
    cleanupExpiredKeys
};
