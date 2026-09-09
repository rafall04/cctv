/*
Purpose: HTTP handlers for the Audio Broadcast feature — clip library (upload/list/delete), playlists,
         schedules, and play-now/test to camera speakers via the ONVIF backchannel.
Caller: backend/routes/audioRoutes.js, mounted under /api/admin/audio (admin-only).
Deps: audioClipService, audioPlaylistService, audioScheduleService, audioCastService, securityAuditLogger.
MainFuncs: listClips, uploadClip, deleteClip; list/get/create/update/deletePlaylist;
           list/create/update/toggle/deleteSchedule; listCameras, playNow.
SideEffects: writes clip/playlist/schedule rows + audio files; spawns the pusher on play; audit events.
*/

import {
    saveAudioClip, listClips as listClipRows, deleteClip as deleteClipRow, MAX_AUDIO_UPLOAD_BYTES,
} from '../services/audioClipService.js';
import {
    listPlaylists as listPlaylistRows, getPlaylist as getPlaylistRow,
    createPlaylist as createPlaylistRow, updatePlaylist as updatePlaylistRow,
    deletePlaylist as deletePlaylistRow,
} from '../services/audioPlaylistService.js';
import {
    listSchedules as listScheduleRows, createSchedule as createScheduleRow,
    updateSchedule as updateScheduleRow, setEnabled as setScheduleEnabled,
    deleteSchedule as deleteScheduleRow,
} from '../services/audioScheduleService.js';
import { playToCameras } from '../services/audioCastService.js';
import { listBroadcastTargets, listAreas as listAreaRows, setAreaEnabled } from '../services/audioTargetService.js';
import { listCapabilities, recheckAll, probeCamera } from '../services/audioCapabilityService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

function parseId(value) {
    const id = parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function fail(reply, error, fallback = 'Internal server error') {
    const code = error.statusCode || 500;
    if (code === 500) console.error('Audio broadcast error:', error);
    return reply.code(code).send({ success: false, message: code === 500 ? fallback : error.message });
}

function adminContext(request) {
    return { adminUserId: request.user?.id, adminUsername: request.user?.username };
}

/* -------------------------------------------------------------------- clips */

export async function listClips(request, reply) {
    try {
        return reply.send({ success: true, data: listClipRows() });
    } catch (error) { return fail(reply, error); }
}

/**
 * Accept a base64-encoded audio file and store it as a streamable G.711 clip.
 * base64-in-JSON (not multipart) mirrors the promo-banner upload: a rare admin action, and it keeps
 * the public body-parsing surface unchanged. The size gate rejects on encoded length before decoding.
 */
export async function uploadClip(request, reply) {
    try {
        const name = request.body?.name;
        const raw = request.body?.data;
        if (typeof raw !== 'string' || raw.length === 0) {
            return reply.code(400).send({ success: false, message: 'Data audio tidak ada' });
        }
        const base64 = raw.includes(',') && raw.slice(0, 64).includes('base64')
            ? raw.slice(raw.indexOf(',') + 1) : raw;
        if (base64.length > Math.ceil(MAX_AUDIO_UPLOAD_BYTES / 3) * 4 + 8) {
            return reply.code(413).send({
                success: false,
                message: `Ukuran audio melebihi ${Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024))}MB`,
            });
        }
        const clip = await saveAudioClip(name, Buffer.from(base64, 'base64'), request.user?.id ?? null);
        logAdminAction({
            action: 'audio_clip_uploaded', targetType: 'audio_clip', targetId: clip.id,
            clipName: clip.name, durationSec: clip.duration_sec, ...adminContext(request),
        }, request);
        return reply.code(201).send({ success: true, message: 'Audio diunggah', data: clip });
    } catch (error) { return fail(reply, error, 'Gagal memproses audio'); }
}

export async function deleteClip(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID audio tidak valid' });
        deleteClipRow(id);
        logAdminAction({ action: 'audio_clip_deleted', targetType: 'audio_clip', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Audio dihapus' });
    } catch (error) { return fail(reply, error); }
}

/* ---------------------------------------------------------------- playlists */

export async function listPlaylists(request, reply) {
    try {
        return reply.send({ success: true, data: listPlaylistRows() });
    } catch (error) { return fail(reply, error); }
}

export async function getPlaylist(request, reply) {
    try {
        const id = parseId(request.params.id);
        const pl = id ? getPlaylistRow(id) : null;
        if (!pl) return reply.code(404).send({ success: false, message: 'Playlist tidak ditemukan' });
        return reply.send({ success: true, data: pl });
    } catch (error) { return fail(reply, error); }
}

export async function createPlaylist(request, reply) {
    try {
        const pl = createPlaylistRow(request.body?.name, request.body?.clipIds || []);
        logAdminAction({ action: 'audio_playlist_created', targetType: 'audio_playlist', targetId: pl.id, name: pl.name, ...adminContext(request) }, request);
        return reply.code(201).send({ success: true, message: 'Playlist dibuat', data: pl });
    } catch (error) { return fail(reply, error); }
}

export async function updatePlaylist(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID playlist tidak valid' });
        const pl = updatePlaylistRow(id, request.body || {});
        logAdminAction({ action: 'audio_playlist_updated', targetType: 'audio_playlist', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Playlist diperbarui', data: pl });
    } catch (error) { return fail(reply, error); }
}

export async function deletePlaylist(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID playlist tidak valid' });
        deletePlaylistRow(id);
        logAdminAction({ action: 'audio_playlist_deleted', targetType: 'audio_playlist', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Playlist dihapus' });
    } catch (error) { return fail(reply, error); }
}

/* ---------------------------------------------------------------- schedules */

export async function listSchedules(request, reply) {
    try {
        return reply.send({ success: true, data: listScheduleRows() });
    } catch (error) { return fail(reply, error); }
}

export async function createSchedule(request, reply) {
    try {
        const s = createScheduleRow(request.body || {});
        logAdminAction({ action: 'audio_schedule_created', targetType: 'audio_schedule', targetId: s.id, name: s.name, time: s.time_hhmm, ...adminContext(request) }, request);
        return reply.code(201).send({ success: true, message: 'Jadwal dibuat', data: s });
    } catch (error) { return fail(reply, error); }
}

export async function updateSchedule(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID jadwal tidak valid' });
        const s = updateScheduleRow(id, request.body || {});
        logAdminAction({ action: 'audio_schedule_updated', targetType: 'audio_schedule', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Jadwal diperbarui', data: s });
    } catch (error) { return fail(reply, error); }
}

export async function toggleSchedule(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID jadwal tidak valid' });
        const s = setScheduleEnabled(id, request.body?.enabled === true);
        return reply.send({ success: true, message: s.enabled ? 'Jadwal diaktifkan' : 'Jadwal dinonaktifkan', data: s });
    } catch (error) { return fail(reply, error); }
}

export async function deleteSchedule(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID jadwal tidak valid' });
        deleteScheduleRow(id);
        logAdminAction({ action: 'audio_schedule_deleted', targetType: 'audio_schedule', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Jadwal dihapus' });
    } catch (error) { return fail(reply, error); }
}

/* ------------------------------------------------------- targets + capability + areas */

// Scoped to audio-enabled areas + annotated with tri-state capability (Surabaya no longer floods this).
export async function listCameras(request, reply) {
    try {
        return reply.send({ success: true, data: listBroadcastTargets({ includeUnknown: true }) });
    } catch (error) { return fail(reply, error); }
}

export async function listCapability(request, reply) {
    try {
        return reply.send({ success: true, data: listCapabilities() });
    } catch (error) { return fail(reply, error); }
}

// Re-probe (silent DESCRIBE, no sound) all in-scope cameras. Force = ignore the 7-day freshness TTL.
export async function recheckCapability(request, reply) {
    try {
        const result = await recheckAll({ force: true });
        logAdminAction({ action: 'audio_capability_recheck_all', targetType: 'audio', ...result, ...adminContext(request) }, request);
        return reply.send({ success: true, message: `Diperiksa ${result.probed} kamera`, data: result });
    } catch (error) { return fail(reply, error); }
}

export async function recheckCameraCapability(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID kamera tidak valid' });
        const result = await probeCamera(id);
        return reply.send({ success: true, message: `Hasil: ${result.verdict}`, data: result });
    } catch (error) { return fail(reply, error); }
}

export async function listAreas(request, reply) {
    try {
        return reply.send({ success: true, data: listAreaRows() });
    } catch (error) { return fail(reply, error); }
}

export async function toggleArea(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID area tidak valid' });
        const area = setAreaEnabled(id, request.body?.enabled === true);
        logAdminAction({ action: 'audio_area_toggle', targetType: 'area', targetId: id, enabled: area.audio_broadcast_enabled, ...adminContext(request) }, request);
        return reply.send({ success: true, message: area.audio_broadcast_enabled ? 'Area diaktifkan' : 'Area dinonaktifkan', data: area });
    } catch (error) { return fail(reply, error); }
}

/* ---------------------------------------------------------------- play-now */

/**
 * Play a clip or playlist to one or more cameras right now.
 * Per-camera results come back individually — a camera without a speaker (S41FE-class) simply reports
 * its failure line; the others still play. Not every internal camera exposes an ONVIF backchannel.
 */
export async function playNow(request, reply) {
    try {
        const { cameraIds, sourceType, sourceId, loop } = request.body || {};
        if (!['clip', 'playlist'].includes(sourceType)) {
            return reply.code(400).send({ success: false, message: 'sourceType harus clip atau playlist' });
        }
        const sid = parseId(sourceId);
        if (!sid) return reply.code(400).send({ success: false, message: 'sourceId tidak valid' });
        const { results, files } = await playToCameras(cameraIds || [], sourceType, sid, loop || 1);
        logAdminAction({
            action: 'audio_play_now', targetType: 'audio', sourceType, sourceId: sid,
            cameras: results.length, ok: results.filter((r) => r.ok).length, ...adminContext(request),
        }, request);
        const okCount = results.filter((r) => r.ok).length;
        return reply.send({
            success: true,
            message: `Diputar ke ${okCount}/${results.length} kamera`,
            data: { results, files },
        });
    } catch (error) { return fail(reply, error); }
}
