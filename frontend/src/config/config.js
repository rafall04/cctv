/**
 * Frontend Configuration
 * Central configuration file for runtime-aware URL helpers.
 */

import { getApiUrl as getRuntimeApiUrl } from './runtimeConfig.js';

export const getApiUrl = () => getRuntimeApiUrl();

export const getApiKey = () => import.meta.env.VITE_API_KEY || '';

export const buildApiAssetUrl = (path) => {
    if (!path) {
        return path;
    }

    if (/^https?:\/\//i.test(path)) {
        return path;
    }

    const apiBaseUrl = getApiUrl();
    if (!apiBaseUrl) {
        return path;
    }

    const cleanBase = apiBaseUrl.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${cleanBase}${cleanPath}`;
};

export const isDevelopment = () => import.meta.env.DEV;

export const isProduction = () => import.meta.env.PROD;

export const getMode = () => import.meta.env.MODE;

export const config = {
    api: {
        baseUrl: getApiUrl(),
        key: getApiKey(),
    },
    frontend: {
        domain: import.meta.env.VITE_FRONTEND_DOMAIN || 'localhost:5173',
    },
    env: {
        isDevelopment: isDevelopment(),
        isProduction: isProduction(),
        mode: getMode(),
    },
};

export default config;
