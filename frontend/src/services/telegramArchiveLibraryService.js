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

/** Header figures for the CURRENT filter — pass the same ones given to listUploads. */
export async function getSummary({ cameraId, from, to } = {}) {
    const params = {};
    if (cameraId) params.cameraId = cameraId;
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await apiClient.get(`${BASE}/summary`, { params });
    return data?.data ?? null;
}

/**
 * One page of the archive, newest first. Returns `total` alongside the rows so the caller can tell
 * "that is everything" from "that is the first page of thousands" — the page used to ask for 100
 * rows with no way to ask for more, which silently hid most of the archive.
 *
 * `from`/`to` are ISO-8601 UTC instants; convert the operator's local dates with dayBounds() so a
 * chosen day means their day, not a UTC one.
 */
export async function listUploads({ cameraId, limit = 100, offset = 0, from, to } = {}) {
    const params = { limit, offset };
    if (cameraId) params.cameraId = cameraId;
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await apiClient.get(BASE, { params });
    const items = Array.isArray(data?.data) ? data.data : [];
    return { items, total: Number(data?.meta?.total ?? items.length) };
}

/** Local calendar date (YYYY-MM-DD from <input type="date">) -> the UTC instants bounding that day. */
export function dayBounds(date, edge) {
    if (!date) return undefined;
    const local = new Date(`${date}T${edge === 'end' ? '23:59:59.999' : '00:00:00.000'}`);
    return Number.isNaN(local.getTime()) ? undefined : local.toISOString();
}

/**
 * The player src. Deliberately OUR endpoint, never a Telegram URL — a Telegram file link carries
 * the bot token and is fetchable by anyone who has the string.
 */
export function streamUrl(segmentId) {
    return `${BASE}/${segmentId}/stream`;
}

export default { getSummary, listUploads, streamUrl, dayBounds };
