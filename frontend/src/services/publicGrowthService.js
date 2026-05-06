/*
 * Purpose: Fetch public growth data for area pages, landing discovery, and trending CCTV.
 * Caller: AreaPublicPage and landing growth components.
 * Deps: apiClient.
 * MainFuncs: publicGrowthService.getArea, getAreaCameras, getDiscovery, getTrendingCameras.
 * SideEffects: Performs public GET requests.
 */

import apiClient from './apiClient';

const publicRequestConfig = {
    skipGlobalErrorNotification: true,
    skipAuthRefresh: true,
};

export const publicGrowthService = {
    async getArea(slug) {
        const response = await apiClient.get(`/api/public/areas/${encodeURIComponent(slug)}`, publicRequestConfig);
        return response.data;
    },

    async getAreaCameras(slug) {
        const response = await apiClient.get(`/api/public/areas/${encodeURIComponent(slug)}/cameras`, publicRequestConfig);
        return response.data;
    },

    async getDiscovery({ limit = 6 } = {}) {
        const response = await apiClient.get('/api/public/discovery', {
            ...publicRequestConfig,
            params: { limit },
        });
        return response.data;
    },

    async getTrendingCameras({ areaSlug = '', limit = 10 } = {}) {
        const response = await apiClient.get('/api/public/trending-cameras', {
            ...publicRequestConfig,
            params: { areaSlug, limit },
        });
        return response.data;
    },
};

export default publicGrowthService;
