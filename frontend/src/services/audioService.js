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

/** Update a clip's organisation meta: { category?, isFavorite?, tags? }. */
export const updateClipMeta = async (id, payload) => {
    try {
        return (await apiClient.patch(`${BASE}/clips/${id}`, payload)).data;
    } catch (error) { return failure(error, 'Gagal memperbarui audio'); }
};

/** Enqueue an import from a direct media URL or a YouTube link. Returns a queued job (poll getImportJobs). */
export const importClip = async (url, name) => {
    try {
        return (await apiClient.post(`${BASE}/clips/import`, { url, name })).data;
    } catch (error) {
        // `transient` = a network-layer drop (Cloudflare QUIC idle-drop): the POST may have reached the
        // server anyway, so the caller refreshes the job list instead of declaring a hard failure.
        return { ...failure(error, 'Gagal memulai impor'), transient: !error.response };
    }
};

export const getImportJobs = async () => {
    try {
        return (await apiClient.get(`${BASE}/clips/imports`)).data;
    } catch (error) { return failure(error, 'Gagal memuat status impor'); }
};

/* ------------------------------------------------------------ text-to-speech */

export const getTtsEngines = async () => {
    try {
        return (await apiClient.get(`${BASE}/tts/engines`)).data;
    } catch (error) { return failure(error, 'Gagal memuat mesin TTS'); }
};

/** Generate a spoken clip from typed text (async job — poll getImportJobs). */
export const createTts = async ({ text, engine, voice, name }) => {
    try {
        return (await apiClient.post(`${BASE}/clips/tts`, { text, engine, voice, name })).data;
    } catch (error) {
        return { ...failure(error, 'Gagal membuat suara'), transient: !error.response };
    }
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

/** Block/unblock a camera from ALL audio (safety switch for hang-prone V380-class devices). */
export const setCameraBlocked = async (id, blocked) => {
    try {
        return (await apiClient.patch(`${BASE}/cameras/${id}/blocked`, { blocked })).data;
    } catch (error) { return failure(error, 'Gagal mengubah status blokir'); }
};

export const playNow = async ({ cameraIds, sourceType, sourceId, loop = 1, confirm = false }) => {
    try {
        return (await apiClient.post(`${BASE}/play`, { cameraIds, sourceType, sourceId, loop, confirm })).data;
    } catch (error) {
        // A 409 carries { requiresConfirm } (wide blast / quiet hours) — surface it so the caller can ask + retry.
        if (error.response?.status === 409 && error.response.data) return error.response.data;
        return failure(error, 'Gagal memutar audio');
    }
};

/** Set an area's quiet hours (HH:MM) + loop ceiling. Pass empty strings to clear quiet hours. */
export const setAreaPolicy = async (id, payload) => {
    try {
        return (await apiClient.patch(`${BASE}/areas/${id}/policy`, payload)).data;
    } catch (error) { return failure(error, 'Gagal menyimpan kebijakan area'); }
};

/* ------------------------------------------------------- announcement templates */

export const getTemplates = async () => {
    try {
        return (await apiClient.get(`${BASE}/templates`)).data;
    } catch (error) { return failure(error, 'Gagal memuat template'); }
};

export const createTemplate = async (payload) => {
    try {
        return (await apiClient.post(`${BASE}/templates`, payload)).data;
    } catch (error) { return failure(error, 'Gagal membuat template'); }
};

export const updateTemplate = async (id, payload) => {
    try {
        return (await apiClient.put(`${BASE}/templates/${id}`, payload)).data;
    } catch (error) { return failure(error, 'Gagal memperbarui template'); }
};

export const deleteTemplate = async (id) => {
    try {
        return (await apiClient.delete(`${BASE}/templates/${id}`)).data;
    } catch (error) { return failure(error, 'Gagal menghapus template'); }
};

export const getActivePlays = async () => {
    try {
        return (await apiClient.get(`${BASE}/play/active`)).data;
    } catch (error) { return failure(error, 'Gagal memuat status'); }
};

/** Stop playback: pass { all: true }, { cameraId }, or { cameraIds }. */
export const stopPlay = async (payload) => {
    try {
        return (await apiClient.post(`${BASE}/play/stop`, payload)).data;
    } catch (error) { return failure(error, 'Gagal menghentikan'); }
};

/** Recent broadcasts + per-camera delivery receipt (Riwayat / Bukti siaran). */
export const getPlayHistory = async () => {
    try {
        return (await apiClient.get(`${BASE}/play/history`)).data;
    } catch (error) { return failure(error, 'Gagal memuat riwayat'); }
};

/* ---------------------------------------------------------------- soundboard */

export const getSoundboard = async () => {
    try {
        return (await apiClient.get(`${BASE}/soundboard`)).data;
    } catch (error) { return failure(error, 'Gagal memuat panel'); }
};

export const createSoundboardButton = async (payload) => {
    try {
        return (await apiClient.post(`${BASE}/soundboard`, payload)).data;
    } catch (error) { return failure(error, 'Gagal membuat tombol'); }
};

export const updateSoundboardButton = async (id, payload) => {
    try {
        return (await apiClient.put(`${BASE}/soundboard/${id}`, payload)).data;
    } catch (error) { return failure(error, 'Gagal memperbarui tombol'); }
};

export const deleteSoundboardButton = async (id) => {
    try {
        return (await apiClient.delete(`${BASE}/soundboard/${id}`)).data;
    } catch (error) { return failure(error, 'Gagal menghapus tombol'); }
};

/* -------------------------------------------------- custom manual camera groups */

export const getGroups = async () => {
    try {
        return (await apiClient.get(`${BASE}/groups`)).data;
    } catch (error) { return failure(error, 'Gagal memuat grup'); }
};

export const createGroup = async (name, cameraIds) => {
    try {
        return (await apiClient.post(`${BASE}/groups`, { name, cameraIds })).data;
    } catch (error) { return failure(error, 'Gagal membuat grup'); }
};

export const updateGroup = async (id, payload) => {
    try {
        return (await apiClient.put(`${BASE}/groups/${id}`, payload)).data;
    } catch (error) { return failure(error, 'Gagal memperbarui grup'); }
};

export const deleteGroup = async (id) => {
    try {
        return (await apiClient.delete(`${BASE}/groups/${id}`)).data;
    } catch (error) { return failure(error, 'Gagal menghapus grup'); }
};

/** Mint a single-use ticket for a live push-to-talk WebSocket to one camera. */
export const talkTicket = async (cameraId) => {
    try {
        return (await apiClient.post(`${BASE}/talk/ticket`, { cameraId })).data;
    } catch (error) { return failure(error, 'Gagal memulai bicara'); }
};

export default {
    getClips, uploadClip, deleteClip, updateClipMeta, importClip, getImportJobs, getTtsEngines, createTts,
    getPlaylists, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist,
    getSchedules, createSchedule, updateSchedule, toggleSchedule, deleteSchedule,
    getCameras, playNow, talkTicket, getActivePlays, stopPlay, getPlayHistory,
    getSoundboard, createSoundboardButton, updateSoundboardButton, deleteSoundboardButton,
    getCapability, recheckCapability, recheckCameraCapability, getAreas, toggleArea, setCameraBlocked, setAreaPolicy,
    getGroups, createGroup, updateGroup, deleteGroup,
    getTemplates, createTemplate, updateTemplate, deleteTemplate,
};
