/**
 * Purpose: Handle public growth API responses for area pages, discovery, and trending CCTV.
 * Caller: backend/routes/publicGrowthRoutes.js.
 * Deps: publicGrowthService.
 * MainFuncs: getPublicArea, getPublicAreaCameras, getPublicTrendingCameras, getPublicDiscovery.
 * SideEffects: Reads sanitized public CCTV data.
 */

import {
    getPublicAreaBySlug,
    getPublicAreaCameras as getPublicAreaCamerasData,
    getPublicDiscovery as getPublicDiscoveryData,
    getTrendingCameras,
} from '../services/publicGrowthService.js';

function sendError(reply, error, fallbackMessage) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
        success: false,
        message: statusCode === 500 ? fallbackMessage : error.message,
    });
}

export async function getPublicArea(request, reply) {
    try {
        const data = getPublicAreaBySlug(request.params.slug);
        return reply.send({ success: true, data });
    } catch (error) {
        return sendError(reply, error, 'Internal server error');
    }
}

export async function getPublicAreaCameras(request, reply) {
    try {
        const data = getPublicAreaCamerasData(request.params.slug);
        return reply.send({ success: true, data });
    } catch (error) {
        return sendError(reply, error, 'Internal server error');
    }
}

export async function getPublicTrendingCameras(request, reply) {
    try {
        const data = getTrendingCameras({
            areaSlug: request.query?.areaSlug || '',
            limit: request.query?.limit,
        });
        return reply.send({ success: true, data });
    } catch (error) {
        return sendError(reply, error, 'Internal server error');
    }
}

export async function getPublicDiscovery(request, reply) {
    try {
        const data = getPublicDiscoveryData({
            limit: request.query?.limit,
        });
        return reply.send({ success: true, data });
    } catch (error) {
        return sendError(reply, error, 'Internal server error');
    }
}
