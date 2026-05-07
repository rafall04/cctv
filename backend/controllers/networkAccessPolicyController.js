/**
 * Purpose: Shape authenticated admin API responses for ASN access policy customization.
 * Caller: backend/routes/networkAccessPolicyRoutes.js.
 * Deps: networkAccessPolicyService.
 * MainFuncs: listNetworkAccessPolicies, upsertNetworkAccessPolicy, deleteNetworkAccessPolicy.
 * SideEffects: Persists and removes rows in asn_access_policies through the service layer.
 */

import networkAccessPolicyService from '../services/networkAccessPolicyService.js';

function sendError(reply, error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
        success: false,
        message: statusCode === 500 ? 'Internal server error' : error.message,
    });
}

export async function listNetworkAccessPolicies(request, reply) {
    try {
        return reply.send({
            success: true,
            data: networkAccessPolicyService.listPolicies(),
        });
    } catch (error) {
        console.error('List network access policies error:', error);
        return sendError(reply, error);
    }
}

export async function upsertNetworkAccessPolicy(request, reply) {
    try {
        const policy = networkAccessPolicyService.upsertPolicy(request.body || {});
        return reply.send({
            success: true,
            message: 'Network access policy saved',
            data: policy,
        });
    } catch (error) {
        console.error('Save network access policy error:', error);
        return sendError(reply, error);
    }
}

export async function deleteNetworkAccessPolicy(request, reply) {
    try {
        const deleted = networkAccessPolicyService.deletePolicy(request.params.id);
        if (!deleted) {
            return reply.code(404).send({
                success: false,
                message: 'Network access policy not found',
            });
        }

        return reply.send({
            success: true,
            message: 'Network access policy deleted',
        });
    } catch (error) {
        console.error('Delete network access policy error:', error);
        return sendError(reply, error);
    }
}
