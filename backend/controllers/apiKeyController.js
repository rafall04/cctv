/**
 * API Key Controller
 * 
 * Handles API key management operations (admin only).
 * - Generate new API keys
 * - List active API keys
 * - Revoke API keys
 * 
 * Requirements: 1.1
 */

import {
    createApiKey,
    getActiveApiKeys,
    getApiKeyById,
    revokeApiKey
} from '../services/apiKeyService.js';
import { logApiKeyCreated, logApiKeyRevoked } from '../services/securityAuditLogger.js';

/**
 * Generate a new API key
 * POST /api/admin/api-keys
 * 
 * Body: { clientName: string, expiresInDays?: number }
 */
export async function generateApiKey(request, reply) {
    try {
        const { clientName, expiresInDays } = request.body || {};
        
        // Validate client name
        if (!clientName || typeof clientName !== 'string' || clientName.trim().length === 0) {
            return reply.code(400).send({
                success: false,
                message: 'Client name is required'
            });
        }
        
        if (clientName.length > 100) {
            return reply.code(400).send({
                success: false,
                message: 'Client name must be 100 characters or less'
            });
        }
        
        // Validate expiration days if provided
        let expDays = null;
        if (expiresInDays !== undefined && expiresInDays !== null) {
            expDays = parseInt(expiresInDays, 10);
            if (isNaN(expDays) || expDays < 1 || expDays > 365) {
                return reply.code(400).send({
                    success: false,
                    message: 'Expiration days must be between 1 and 365'
                });
            }
        }
        
        // Create the API key
        const result = createApiKey(clientName.trim(), expDays);
        
        // Log admin action
        logApiKeyCreated({
            keyId: result.id,
            clientName: result.clientName,
            createdBy: request.user?.username,
            expiresAt: result.expiresAt
        }, request);
        
        return reply.code(201).send({
            success: true,
            message: 'API key created successfully. Store this key securely - it cannot be retrieved again.',
            data: {
                id: result.id,
                apiKey: result.apiKey,
                clientName: result.clientName,
                expiresAt: result.expiresAt,
                createdAt: result.createdAt
            }
        });
    } catch (error) {
        console.error('Generate API key error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * List all active API keys
 * GET /api/admin/api-keys
 */
export async function listApiKeys(request, reply) {
    try {
        const keys = getActiveApiKeys();
        
        return reply.send({
            success: true,
            data: keys.map(key => ({
                id: key.id,
                clientName: key.client_name,
                createdAt: key.created_at,
                expiresAt: key.expires_at,
                lastUsedAt: key.last_used_at,
                isActive: key.is_active === 1
            }))
        });
    } catch (error) {
        console.error('List API keys error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * Revoke an API key
 * DELETE /api/admin/api-keys/:id
 */
export async function deleteApiKey(request, reply) {
    try {
        const { id } = request.params;
        const keyId = parseInt(id, 10);
        
        if (isNaN(keyId) || keyId < 1) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid key ID'
            });
        }
        
        // Check if key exists
        const existingKey = getApiKeyById(keyId);
        if (!existingKey) {
            return reply.code(404).send({
                success: false,
                message: 'API key not found'
            });
        }
        
        // Revoke the key
        const revoked = revokeApiKey(keyId);
        
        if (!revoked) {
            return reply.code(500).send({
                success: false,
                message: 'Failed to revoke API key'
            });
        }
        
        // Log admin action
        logApiKeyRevoked({
            keyId: keyId,
            clientName: existingKey.client_name,
            revokedBy: request.user?.username
        }, request);
        
        return reply.send({
            success: true,
            message: 'API key revoked successfully'
        });
    } catch (error) {
        console.error('Delete API key error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error'
        });
    }
}

export default {
    generateApiKey,
    listApiKeys,
    deleteApiKey
};
