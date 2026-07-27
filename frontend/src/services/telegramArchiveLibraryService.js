/*
 * Purpose: Client for the Telegram archive library — list uploaded segments and build the
 *   backend-proxied stream URL for one.
 * Caller: pages/TelegramArchiveLibrary.jsx.
 * Deps: services/apiClient.
 * MainFuncs: getSummary, listUploads, streamUrl.
 * SideEffects: None beyond the HTTP calls.
 */

import apiClient from './apiClient';

const BASE = '/api/admin/telegram-archive/library';

export async function getSummary() {
    const { data } = await apiClient.get(`${BASE}/summary`);
    return data?.data ?? null;
}

export async function listUploads({ cameraId, limit = 100, offset = 0 } = {}) {
    const params = { limit, offset };
    if (cameraId) params.cameraId = cameraId;
    const { data } = await apiClient.get(BASE, { params });
    return Array.isArray(data?.data) ? data.data : [];
}

/**
 * The player src. Deliberately OUR endpoint, never a Telegram URL — a Telegram file link carries
 * the bot token and is fetchable by anyone who has the string.
 */
export function streamUrl(segmentId) {
    return `${BASE}/${segmentId}/stream`;
}

export default { getSummary, listUploads, streamUrl };
