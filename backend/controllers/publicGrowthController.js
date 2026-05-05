/**
 * Purpose: Handle public growth API responses for area pages and trending CCTV.
 * Caller: backend/routes/publicGrowthRoutes.js.
 * Deps: publicGrowthService.
 * MainFuncs: getPublicArea, getPublicAreaCameras, getPublicTrendingCameras.
 * SideEffects: Reads sanitized public CCTV data.
 */

import {
    getPublicAreaBySlug,
    getPublicAreaCameras as getPublicAreaCamerasData,
    getTrendingCameras,
} from '../services/publicGrowthService.js';

export async function getPublicArea(request, reply) {
    const data = getPublicAreaBySlug(request.params.slug);
    return reply.send({ success: true, data });
}

export async function getPublicAreaCameras(request, reply) {
    const data = getPublicAreaCamerasData(request.params.slug);
    return reply.send({ success: true, data });
}

export async function getPublicTrendingCameras(request, reply) {
    const data = getTrendingCameras({
        areaSlug: request.query?.areaSlug || '',
        limit: request.query?.limit,
    });
    return reply.send({ success: true, data });
}
