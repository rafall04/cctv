/**
 * Audio Broadcast Service
 * API client for the operator's Audio Broadcast feature — a clip library, playlists, schedules, and
 * play-now to camera speakers via the ONVIF backchannel. All endpoints are admin-only.
 *
 * Contract: methods never throw — on error they return `{ success: false, message }`. Callers branch
 * on `result.success`.
 */

import apiClient from './apiClient';

const BASE = '/api/admin/audio';

function failure(error, fallback) {
    return { success: false, message: error.response?.data?.message || error.message || fallback };
}

/* ----------------------------------------------------------------------- clips */

export const getClips = async () => {
    try {
        return (await apiClient.get(`${BASE}/clips`)).data;
    } catch (error) { return failure(error, 'Gagal memuat audio'); }
};

/** Upload an audio file. `base64` is the bare base64 payload (no data: prefix). */
export const uploadClip = async (name, base64) => {
    try {
        return (await apiClient.post(`${BASE}/clips`, { name, data: base64 })).data;
    } catch (error) { return failure(error, 'Gagal mengunggah audio'); }
};

export const deleteClip = async (id) => {
    try {
        return (await apiClient.delete(`${BASE}/clips/${id}`)).data;
    } catch (error) { return failure(error, 'Gagal menghapus audio'); }
};

/* ------------------------------------------------------------------- playlists */

export const getPlaylists = async () => {
    try {
        return (await apiClient.get(`${BASE}/playlists`)).data;
    } catch (error) { return failure(error, 'Gagal memuat playlist'); }
};

export const getPlaylist = async (id) => {
    try {
        return (await apiClient.get(`${BASE}/playlists/${id}`)).data;
    } catch (error) { return failure(error, 'Gagal memuat playlist'); }
};

export const createPlaylist = async (name, clipIds) => {
    try {
        return (await apiClient.post(`${BASE}/playlists`, { name, clipIds })).data;
    } catch (error) { return failure(error, 'Gagal membuat playlist'); }
};

export const updatePlaylist = async (id, payload) => {
    try {
        return (await apiClient.put(`${BASE}/playlists/${id}`, payload)).data;
    } catch (error) { return failure(error, 'Gagal memperbarui playlist'); }
};

export const deletePlaylist = async (id) => {
    try {
        return (await apiClient.delete(`${BASE}/playlists/${id}`)).data;
    } catch (error) { return failure(error, 'Gagal menghapus playlist'); }
};

/* ------------------------------------------------------------------- schedules */

export const getSchedules = async () => {
    try {
        return (await apiClient.get(`${BASE}/schedules`)).data;
    } catch (error) { return failure(error, 'Gagal memuat jadwal'); }
};

export const createSchedule = async (payload) => {
    try {
        return (await apiClient.post(`${BASE}/schedules`, payload)).data;
    } catch (error) { return failure(error, 'Gagal membuat jadwal'); }
};

export const updateSchedule = async (id, payload) => {
    try {
        return (await apiClient.put(`${BASE}/schedules/${id}`, payload)).data;
    } catch (error) { return failure(error, 'Gagal memperbarui jadwal'); }
};

export const toggleSchedule = async (id, enabled) => {
    try {
        return (await apiClient.patch(`${BASE}/schedules/${id}/enabled`, { enabled })).data;
    } catch (error) { return failure(error, 'Gagal mengubah status jadwal'); }
};

export const deleteSchedule = async (id) => {
    try {
        return (await apiClient.delete(`${BASE}/schedules/${id}`)).data;
    } catch (error) { return failure(error, 'Gagal menghapus jadwal'); }
};

/* -------------------------------------------------------------------- play-now */

export const getCameras = async () => {
    try {
        return (await apiClient.get(`${BASE}/cameras`)).data;
    } catch (error) { return failure(error, 'Gagal memuat kamera'); }
};

/* --------------------------------------------------------- capability + area scope */

export const getCapability = async () => {
    try {
        return (await apiClient.get(`${BASE}/capability`)).data;
    } catch (error) { return failure(error, 'Gagal memuat kapabilitas'); }
};

export const recheckCapability = async () => {
    try {
        return (await apiClient.post(`${BASE}/capability/recheck`)).data;
    } catch (error) { return failure(error, 'Gagal memeriksa kamera'); }
};

export const recheckCameraCapability = async (id) => {
    try {
        return (await apiClient.post(`${BASE}/capability/recheck/${id}`)).data;
    } catch (error) { return failure(error, 'Gagal memeriksa kamera'); }
};

export const getAreas = async () => {
    try {
        return (await apiClient.get(`${BASE}/areas`)).data;
    } catch (error) { return failure(error, 'Gagal memuat area'); }
};

export const toggleArea = async (id, enabled) => {
    try {
        return (await apiClient.patch(`${BASE}/areas/${id}/enabled`, { enabled })).data;
    } catch (error) { return failure(error, 'Gagal mengubah area'); }
};

export const playNow = async ({ cameraIds, sourceType, sourceId, loop = 1 }) => {
    try {
        return (await apiClient.post(`${BASE}/play`, { cameraIds, sourceType, sourceId, loop })).data;
    } catch (error) { return failure(error, 'Gagal memutar audio'); }
};

export default {
    getClips, uploadClip, deleteClip,
    getPlaylists, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist,
    getSchedules, createSchedule, updateSchedule, toggleSchedule, deleteSchedule,
    getCameras, playNow,
    getCapability, recheckCapability, recheckCameraCapability, getAreas, toggleArea,
};
