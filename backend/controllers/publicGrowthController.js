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
import { pickFirstGridCamera, buildLcpCardFragment } from '../services/publicLandingProjection.js';
import cameraService from '../services/cameraService.js';
import areaService from '../services/areaService.js';

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

/*
 * SSI fragment for index.html's boot shell: the real first-grid-card <img> with
 * src already resolved, so the LCP thumbnail starts downloading with the HTML.
 * Always answers 200 — an error body would end up rendered INSIDE the page by
 * nginx's include, so failures degrade to an empty fragment (the inline-JS
 * fallback still fills the slot later) and get logged, not returned.
 */
export async function getPublicLcpCard(request, reply) {
    reply.type('text/html; charset=utf-8');
    try {
        const cameras = cameraService.getPublicLandingCameraList();
        const { areas } = areaService.getAllAreas({ publicOnly: true });
        return reply.send(buildLcpCardFragment(pickFirstGridCamera(cameras, areas)));
    } catch (error) {
        console.error('LCP card fragment error:', error);
        return reply.send('');
    }
}
