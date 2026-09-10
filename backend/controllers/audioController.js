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
    saveAudioClip, listClips as listClipRows, deleteClip as deleteClipRow, setClipMeta, getClip, getClipWav, MAX_AUDIO_UPLOAD_BYTES,
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
import { playToCameras, testCamera, listPlaying, stopPlaying, stopAllPlaying } from '../services/audioCastService.js';
import { listBroadcastTargets, listAreas as listAreaRows, setAreaEnabled, setAreaPolicy, quietTargets } from '../services/audioTargetService.js';
import {
    listTemplates as listTemplateRows, createTemplate as createTemplateRow,
    updateTemplate as updateTemplateRow, deleteTemplate as deleteTemplateRow,
} from '../services/audioTemplateService.js';
import { listCapabilities, recheckAll, probeCamera, setCameraBlocked } from '../services/audioCapabilityService.js';
import { createImportJob, listJobs as listImportRows } from '../services/audioImportService.js';
import { createTtsJob, previewTts as previewTtsRow, listTtsEngines as listTtsEngineRows, ttsConfigStatus, setTtsConfig as setTtsConfigRow } from '../services/audioTtsService.js';
import {
    listGroups as listGroupRows, createGroup as createGroupRow,
    updateGroup as updateGroupRow, deleteGroup as deleteGroupRow,
} from '../services/audioGroupService.js';
import { mintTicket, stopAllTalk } from '../services/audioTalkService.js';
import { getConfig as getPrayerCfg, setConfig as setPrayerCfg, todayTimes as prayerTodayTimes } from '../services/audioPrayerService.js';
import { listArms as listMotionRows, setArm as setMotionArm, disarm as disarmMotion } from '../services/audioMotionService.js';
import {
    configStatus as imouStatus, setConfig as imouSetConfig, listDevices as imouListDevices,
    testConnection as imouTest, setCameraSn as imouSetSn, listSirenCameras, triggerCameraSiren,
    stopAllSirens, listActiveSirens,
} from '../services/imouCloudService.js';
import { logPlay, listHistory } from '../services/audioHistoryService.js';
import {
    listPresets as listEmergencyRows, createPreset as createEmergencyRow,
    updatePreset as updateEmergencyRow, deletePreset as deleteEmergencyRow, fireEmergency,
} from '../services/audioEmergencyService.js';
import {
    listButtons as listSoundboardRows, createButton as createSoundboardRow,
    updateButton as updateSoundboardRow, deleteButton as deleteSoundboardRow,
} from '../services/audioSoundboardService.js';
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

// Stream a clip as a browser-playable PCM16 WAV for in-page preview (decoded from the stored u-law).
// Admin-only; the SPA fetches it as a blob (auth header attached) and plays it inline — no tab jump.
export async function previewClip(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID audio tidak valid' });
        const { buffer } = getClipWav(id);
        reply.header('Content-Type', 'audio/wav');
        reply.header('Content-Length', String(buffer.length));
        reply.header('Cache-Control', 'private, max-age=60');
        return reply.send(buffer);
    } catch (error) { return fail(reply, error); }
}

// Update a clip's organisation meta (category / favourite / tags).
export async function updateClipMeta(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID audio tidak valid' });
        const clip = setClipMeta(id, request.body || {});
        return reply.send({ success: true, message: 'Audio diperbarui', data: clip });
    } catch (error) { return fail(reply, error); }
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

/* ------------------------------------------------------------- import from link */

// Enqueue an async import (direct media URL, or YouTube via yt-dlp). Returns 202 + the queued job.
export async function importClip(request, reply) {
    try {
        const { url, name } = request.body || {};
        if (typeof url !== 'string' || !url.trim()) {
            return reply.code(400).send({ success: false, message: 'URL wajib diisi' });
        }
        const job = await createImportJob({ url, name, userId: request.user?.id ?? null });
        logAdminAction({ action: 'audio_import_queued', targetType: 'audio_import', targetId: job.id, kind: job.source_kind, ...adminContext(request) }, request);
        return reply.code(202).send({ success: true, message: 'Impor dimulai', data: job });
    } catch (error) { return fail(reply, error, 'Gagal memulai impor'); }
}

export async function listImportJobs(request, reply) {
    try {
        return reply.send({ success: true, data: listImportRows() });
    } catch (error) { return fail(reply, error); }
}

/* -------------------------------------------------------------- text-to-speech */

// Available TTS engines + voices + whether each is installed (piper offline / edge cloud-free).
export async function listTtsEngines(request, reply) {
    try {
        return reply.send({ success: true, data: await listTtsEngineRows() });
    } catch (error) { return fail(reply, error); }
}

// Cloud-TTS config (Gemini API key) — status is masked; the raw key never leaves the server.
export async function getTtsConfig(request, reply) {
    try {
        return reply.send({ success: true, data: ttsConfigStatus() });
    } catch (error) { return fail(reply, error); }
}

export async function setTtsConfig(request, reply) {
    try {
        const status = setTtsConfigRow({ geminiApiKey: request.body?.geminiApiKey });
        logAdminAction({ action: 'audio_tts_config_updated', targetType: 'audio_tts', configured: status.gemini_configured, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Kunci Gemini disimpan', data: status });
    } catch (error) { return fail(reply, error); }
}

// Synchronous voice preview ("Coba suara") — returns audio bytes so the SPA can play the sample inline.
export async function previewTts(request, reply) {
    try {
        const { text, engine, voice } = request.body || {};
        const { buffer, mime } = await previewTtsRow({ text, engine, voice });
        reply.header('Content-Type', mime);
        reply.header('Content-Length', String(buffer.length));
        reply.header('Cache-Control', 'no-store');
        return reply.send(buffer);
    } catch (error) { return fail(reply, error); }
}

// Enqueue a TTS synth (typed text -> spoken clip). Reuses the import job queue; poll listImportJobs.
export async function createTts(request, reply) {
    try {
        const { text, engine, voice, name } = request.body || {};
        if (typeof text !== 'string' || !text.trim()) {
            return reply.code(400).send({ success: false, message: 'Teks wajib diisi' });
        }
        const job = await createTtsJob({ text, engine, voice, name, userId: request.user?.id ?? null });
        logAdminAction({ action: 'audio_tts_queued', targetType: 'audio_import', targetId: job.id, engine: job.tts_provider, voice: job.tts_voice, ...adminContext(request) }, request);
        return reply.code(202).send({ success: true, message: 'Pembuatan suara dimulai', data: job });
    } catch (error) { return fail(reply, error, 'Gagal membuat suara'); }
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

// Re-probe (silent DESCRIBE, no sound) all in-scope cameras. FIRE-AND-FORGET: probing N cameras
// sequentially can exceed the client's 30s HTTP timeout, so kick it off in the background and return
// immediately. The client polls GET /capability for results as they land.
export async function recheckCapability(request, reply) {
    try {
        recheckAll({ force: true })
            .then((r) => console.log(`[AudioCap] Manual recheck done: ${r.probed} probed`))
            .catch((e) => console.error('[AudioCap] Manual recheck error:', e.message));
        logAdminAction({ action: 'audio_capability_recheck_all', targetType: 'audio', ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Pemeriksaan dimulai — hasil muncul bertahap' });
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

// Block/unblock a camera from all audio (safety switch for hang-prone V380-class devices).
export async function blockCamera(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID kamera tidak valid' });
        const blocked = request.body?.blocked === true;
        const cam = setCameraBlocked(id, blocked);
        logAdminAction({ action: 'audio_camera_block', targetType: 'camera', targetId: id, blocked: cam.audio_out_blocked, ...adminContext(request) }, request);
        return reply.send({ success: true, message: blocked ? 'Kamera diblokir dari audio' : 'Blokir dilepas', data: cam });
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

// Set an area's quiet hours + loop ceiling.
export async function setAreaPolicyHandler(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID area tidak valid' });
        const area = setAreaPolicy(id, request.body || {});
        logAdminAction({ action: 'audio_area_policy', targetType: 'area', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Kebijakan area disimpan', data: area });
    } catch (error) { return fail(reply, error); }
}

/* ------------------------------------------------------- announcement templates */

export async function listTemplates(request, reply) {
    try {
        return reply.send({ success: true, data: listTemplateRows() });
    } catch (error) { return fail(reply, error); }
}

export async function createTemplate(request, reply) {
    try {
        const t = createTemplateRow({ ...request.body, userId: request.user?.id ?? null });
        logAdminAction({ action: 'audio_template_created', targetType: 'audio_template', targetId: t.id, name: t.name, ...adminContext(request) }, request);
        return reply.code(201).send({ success: true, message: 'Template dibuat', data: t });
    } catch (error) { return fail(reply, error, 'Gagal membuat template'); }
}

export async function updateTemplate(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID template tidak valid' });
        const t = updateTemplateRow(id, request.body || {});
        logAdminAction({ action: 'audio_template_updated', targetType: 'audio_template', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Template diperbarui', data: t });
    } catch (error) { return fail(reply, error, 'Gagal memperbarui template'); }
}

export async function deleteTemplate(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID template tidak valid' });
        const t = deleteTemplateRow(id);
        logAdminAction({ action: 'audio_template_deleted', targetType: 'audio_template', targetId: id, name: t.name, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Template dihapus' });
    } catch (error) { return fail(reply, error, 'Gagal menghapus template'); }
}

/* ------------------------------------------------------- custom camera groups */

// Manual, area-free bags of cameras ("Musholla" = cam A,B,C) reused as one-tap presets in the picker.
export async function listGroups(request, reply) {
    try {
        return reply.send({ success: true, data: listGroupRows() });
    } catch (error) { return fail(reply, error); }
}

export async function createGroup(request, reply) {
    try {
        const g = createGroupRow(request.body?.name, request.body?.cameraIds || [], request.user?.id ?? null);
        logAdminAction({ action: 'audio_group_created', targetType: 'audio_group', targetId: g.id, name: g.name, cameras: g.camera_count, ...adminContext(request) }, request);
        return reply.code(201).send({ success: true, message: 'Grup dibuat', data: g });
    } catch (error) { return fail(reply, error, 'Gagal membuat grup'); }
}

export async function updateGroup(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID grup tidak valid' });
        const g = updateGroupRow(id, request.body || {});
        logAdminAction({ action: 'audio_group_updated', targetType: 'audio_group', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Grup diperbarui', data: g });
    } catch (error) { return fail(reply, error, 'Gagal memperbarui grup'); }
}

export async function deleteGroup(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID grup tidak valid' });
        const g = deleteGroupRow(id);
        logAdminAction({ action: 'audio_group_deleted', targetType: 'audio_group', targetId: id, name: g.name, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Grup dihapus' });
    } catch (error) { return fail(reply, error, 'Gagal menghapus grup'); }
}

/* ------------------------------------------------------------- live push-to-talk */

// Mint a single-use WS ticket (browser can't set an Authorization header on a WebSocket).
export async function talkTicket(request, reply) {
    try {
        const body = request.body || {};
        const ids = Array.isArray(body.cameraIds) ? body.cameraIds : (body.cameraId ? [body.cameraId] : []);
        if (ids.length === 0) return reply.code(400).send({ success: false, message: 'Pilih minimal satu kamera' });
        const t = mintTicket(ids, request.user?.id ?? null);
        logAdminAction({ action: 'audio_talk_ticket', targetType: 'camera', targetId: parseId(ids[0]), count: t.cameraCount, ...adminContext(request) }, request);
        return reply.send({ success: true, data: t });
    } catch (error) { return fail(reply, error); }
}

/* ---------------------------------------------------------------- play-now */

/**
 * Play a clip or playlist to one or more cameras right now.
 * Per-camera results come back individually — a camera without a speaker (S41FE-class) simply reports
 * its failure line; the others still play. Not every internal camera exposes an ONVIF backchannel.
 */
const WIDE_BROADCAST_THRESHOLD = 5; // targeting this many cameras at once needs an explicit confirm

export async function playNow(request, reply) {
    try {
        const { cameraIds, sourceType, sourceId, loop, confirm } = request.body || {};
        if (!['clip', 'playlist'].includes(sourceType)) {
            return reply.code(400).send({ success: false, message: 'sourceType harus clip atau playlist' });
        }
        const sid = parseId(sourceId);
        if (!sid) return reply.code(400).send({ success: false, message: 'sourceId tidak valid' });
        const ids = Array.isArray(cameraIds) ? cameraIds : [];
        // Defense-in-depth (not UI-only): a wide blast or a broadcast into an area's quiet hours must be
        // explicitly confirmed. The client re-sends with confirm:true after the operator agrees.
        if (confirm !== true) {
            const quiet = quietTargets(ids);
            const wide = ids.length >= WIDE_BROADCAST_THRESHOLD;
            if (wide || quiet.length > 0) {
                const reasons = [];
                if (wide) reasons.push(`menyiarkan ke ${ids.length} kamera sekaligus`);
                if (quiet.length > 0) reasons.push(`${quiet.length} kamera sedang dalam jam tenang`);
                return reply.code(409).send({
                    success: false, requiresConfirm: true, reason: reasons.join(' & '),
                    message: `Konfirmasi diperlukan: ${reasons.join(' & ')}.`,
                });
            }
        }
        const gainDb = Math.max(-24, Math.min(24, Number(request.body?.gainDb) || 0));
        const { results, files } = await playToCameras(ids, sourceType, sid, loop || 1, { gainDb });
        const sourceName = sourceType === 'clip' ? getClip(sid)?.name : getPlaylistRow(sid)?.name;
        logPlay({
            sourceType, sourceId: sid, sourceName, cameraIds: ids, results,
            operatorId: request.user?.id ?? null, operatorName: request.user?.username ?? null,
        });
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

// Cameras currently playing a clip/playlist (for the "Sedang diputar" list + stop controls).
export async function listActivePlays(request, reply) {
    try {
        return reply.send({ success: true, data: listPlaying() });
    } catch (error) { return fail(reply, error); }
}

// Stop playback: a specific camera (body.cameraId), a set (body.cameraIds), or all (body.all).
export async function stopPlay(request, reply) {
    try {
        const { cameraId, cameraIds, all } = request.body || {};
        if (all) {
            // A true kill-switch: clips/playlists AND live push-to-talk AND cloud sirens (all separate
            // subsystems). Before, "HENTIKAN SEMUA" left a stuck mic / a wailing siren running — dangerous.
            const stopped = stopAllPlaying();
            const talk = stopAllTalk();
            let sirens = 0;
            try { sirens = await stopAllSirens(); } catch (e) { console.error('[Audio] stop-all sirene gagal:', e.message); }
            logAdminAction({ action: 'audio_play_stop', targetType: 'audio', all: true, stopped, talk, sirens, ...adminContext(request) }, request);
            const parts = [];
            if (stopped) parts.push(`${stopped} siaran`);
            if (talk) parts.push(`${talk} bicara`);
            if (sirens) parts.push(`${sirens} sirene`);
            return reply.send({ success: true, message: parts.length ? `Dihentikan: ${parts.join(', ')}` : 'Tidak ada yang aktif', data: { stopped, talk, sirens } });
        }
        let stopped = 0;
        const ids = cameraId ? [cameraId] : (Array.isArray(cameraIds) ? cameraIds : []);
        ids.map((x) => parseId(x)).filter(Boolean).forEach((id) => { if (stopPlaying(id)) stopped += 1; });
        logAdminAction({ action: 'audio_play_stop', targetType: 'audio', stopped, ...adminContext(request) }, request);
        return reply.send({ success: true, message: stopped ? `Dihentikan ${stopped} kamera` : 'Tidak ada yang diputar', data: { stopped } });
    } catch (error) { return fail(reply, error); }
}

// Play a short test clip to one or more cameras to confirm the speaker is actually audible in the field
// (not just "supported" in the probe). Bypasses the area allowlist so a camera can be tested before its
// area is enabled. Body: { cameraIds:[...], sourceId } (a clip id the operator picks).
export async function testSpeaker(request, reply) {
    try {
        const ids = Array.isArray(request.body?.cameraIds) ? request.body.cameraIds : (request.body?.cameraId ? [request.body.cameraId] : []);
        const sid = parseId(request.body?.sourceId);
        if (!sid) return reply.code(400).send({ success: false, message: 'Pilih audio untuk uji dulu' });
        const cleanIds = ids.map((x) => parseId(x)).filter(Boolean);
        if (cleanIds.length === 0) return reply.code(400).send({ success: false, message: 'Pilih kamera untuk diuji' });
        const results = [];
        for (const id of cleanIds) {
            // eslint-disable-next-line no-await-in-loop
            results.push(await testCamera(id, 'clip', sid));
        }
        logAdminAction({ action: 'audio_test_speaker', targetType: 'audio', cameras: results.length, ok: results.filter((r) => r && r.ok).length, ...adminContext(request) }, request);
        const ok = results.filter((r) => r && r.ok).length;
        return reply.send({ success: true, message: `Uji terkirim ke ${ok}/${results.length} kamera`, data: { results } });
    } catch (error) { return fail(reply, error, 'Gagal menguji speaker'); }
}

// Cameras whose IMOU siren is currently ON (status for the UI).
export async function listSirens(request, reply) {
    try { return reply.send({ success: true, data: listActiveSirens() }); }
    catch (error) { return fail(reply, error); }
}

// Silence every siren that is currently ON.
export async function stopSirens(request, reply) {
    try {
        const n = await stopAllSirens();
        logAdminAction({ action: 'audio_imou_siren_stop_all', targetType: 'audio_imou', stopped: n, ...adminContext(request) }, request);
        return reply.send({ success: true, message: n ? `${n} sirene dimatikan` : 'Tidak ada sirene aktif', data: { stopped: n } });
    } catch (error) { return fail(reply, error, 'Gagal mematikan sirene'); }
}

/* ---------------------------------------------------- broadcast history (receipts) */

// Recent broadcasts + per-camera delivery receipt (for "Riwayat" / "Bukti siaran" / "Ulangi").
export async function listPlayHistory(request, reply) {
    try {
        return reply.send({ success: true, data: listHistory(request.query?.limit) });
    } catch (error) { return fail(reply, error); }
}

/* ------------------------------------------------------ IMOU cloud siren (native) */

export async function getImouConfig(request, reply) {
    try { return reply.send({ success: true, data: { ...imouStatus(), cameras: listSirenCameras() } }); }
    catch (error) { return fail(reply, error); }
}

export async function setImouConfig(request, reply) {
    try {
        const cfg = imouSetConfig(request.body || {});
        logAdminAction({ action: 'audio_imou_config', targetType: 'audio_imou', configured: cfg.configured, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Kredensial IMOU disimpan', data: cfg });
    } catch (error) { return fail(reply, error, 'Gagal menyimpan kredensial'); }
}

export async function testImou(request, reply) {
    try { const r = await imouTest(); return reply.send({ success: true, message: 'Koneksi IMOU OK', data: r }); }
    catch (error) { return fail(reply, error, 'Gagal koneksi IMOU'); }
}

export async function listImouDevices(request, reply) {
    try { return reply.send({ success: true, data: await imouListDevices() }); }
    catch (error) { return fail(reply, error, 'Gagal memuat perangkat IMOU'); }
}

export async function setCameraImouSn(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID kamera tidak valid' });
        const r = imouSetSn(id, request.body?.sn);
        return reply.send({ success: true, message: 'SN IMOU disimpan', data: r });
    } catch (error) { return fail(reply, error); }
}

// Turn a camera's built-in siren on/off (louder than the backchannel). body.on = true|false.
export async function cameraSiren(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID kamera tidak valid' });
        const on = request.body?.on === true;
        const r = await triggerCameraSiren(id, on);
        logAdminAction({ action: 'audio_imou_siren', targetType: 'camera', targetId: id, on, ...adminContext(request) }, request);
        return reply.send({ success: true, message: on ? 'Sirene dinyalakan' : 'Sirene dimatikan', data: r });
    } catch (error) { return fail(reply, error, 'Gagal memicu sirene'); }
}

/* -------------------------------------------------------- motion -> deter audio */

export async function listMotionArms(request, reply) {
    try {
        return reply.send({ success: true, data: listMotionRows() });
    } catch (error) { return fail(reply, error); }
}

export async function setMotionArmHandler(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID kamera tidak valid' });
        const arm = setMotionArm(id, request.body || {});
        logAdminAction({ action: 'audio_motion_arm', targetType: 'camera', targetId: id, enabled: arm.enabled, ...adminContext(request) }, request);
        return reply.send({ success: true, message: arm.enabled ? 'Kamera dipersenjatai (motion)' : 'Arm disimpan', data: arm });
    } catch (error) { return fail(reply, error, 'Gagal menyimpan arm'); }
}

export async function disarmMotionHandler(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID kamera tidak valid' });
        disarmMotion(id);
        logAdminAction({ action: 'audio_motion_disarm', targetType: 'camera', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Arm dinonaktifkan' });
    } catch (error) { return fail(reply, error); }
}

/* ------------------------------------------------------------- adzan (prayer) */

export async function getPrayerConfig(request, reply) {
    try {
        return reply.send({ success: true, data: getPrayerCfg() });
    } catch (error) { return fail(reply, error); }
}

export async function updatePrayerConfig(request, reply) {
    try {
        const cfg = setPrayerCfg(request.body || {});
        logAdminAction({ action: 'audio_prayer_config', targetType: 'audio_prayer', enabled: cfg.enabled, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Pengaturan adzan disimpan', data: cfg });
    } catch (error) { return fail(reply, error, 'Gagal menyimpan adzan'); }
}

// Today's computed prayer times (WIB) for the preview — operator verifies vs local Kemenag.
export async function getPrayerTimes(request, reply) {
    try {
        // Optional query overrides let the UI preview an edited-but-unsaved location instantly.
        const q = request.query || {};
        const ov = {};
        for (const k of ['latitude', 'longitude', 'timezone', 'fajr_angle', 'isha_angle', 'asr_factor',
            'ikhtiyati', 'imsak_offset', 'offset_fajr', 'offset_dhuhr', 'offset_asr', 'offset_maghrib', 'offset_isha']) {
            if (q[k] !== undefined && q[k] !== '' && Number.isFinite(Number(q[k]))) ov[k] = Number(q[k]);
        }
        const overrides = Object.keys(ov).length ? ov : null;
        return reply.send({ success: true, data: prayerTodayTimes(Date.now(), overrides) });
    } catch (error) { return fail(reply, error); }
}

/* ---------------------------------------------------------------- emergency */

export async function listEmergencyPresets(request, reply) {
    try {
        return reply.send({ success: true, data: listEmergencyRows() });
    } catch (error) { return fail(reply, error); }
}

export async function createEmergencyPreset(request, reply) {
    try {
        const p = createEmergencyRow({ ...request.body, userId: request.user?.id ?? null });
        logAdminAction({ action: 'audio_emergency_preset_created', targetType: 'audio_emergency', targetId: p.id, label: p.label, ...adminContext(request) }, request);
        return reply.code(201).send({ success: true, message: 'Preset darurat dibuat', data: p });
    } catch (error) { return fail(reply, error, 'Gagal membuat preset'); }
}

export async function updateEmergencyPreset(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID preset tidak valid' });
        const p = updateEmergencyRow(id, request.body || {});
        logAdminAction({ action: 'audio_emergency_preset_updated', targetType: 'audio_emergency', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Preset diperbarui', data: p });
    } catch (error) { return fail(reply, error, 'Gagal memperbarui preset'); }
}

export async function deleteEmergencyPreset(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID preset tidak valid' });
        const p = deleteEmergencyRow(id);
        logAdminAction({ action: 'audio_emergency_preset_deleted', targetType: 'audio_emergency', targetId: id, label: p.label, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Preset dihapus' });
    } catch (error) { return fail(reply, error, 'Gagal menghapus preset'); }
}

/**
 * Fire an emergency broadcast — PREEMPTS current audio + bypasses quiet hours. Requires an EXPLICIT
 * confirm (the UI double-confirms) so it can never fire by accident.
 */
export async function playEmergency(request, reply) {
    try {
        const { sourceType, sourceId, targetKind, areaId, cameraIds, loop, gainDb, siren, confirm } = request.body || {};
        if (confirm !== true) {
            return reply.code(409).send({ success: false, requiresConfirm: true, message: 'Siaran DARURAT butuh konfirmasi eksplisit.' });
        }
        const sid = parseId(sourceId);
        if (!sid) return reply.code(400).send({ success: false, message: 'Pilih audio darurat dulu' });
        const { results, ids, sirens } = await fireEmergency({ sourceType: sourceType || 'clip', sourceId: sid, targetKind, areaId, cameraIds, loop, gainDb, siren });
        const sourceName = (sourceType || 'clip') === 'clip' ? getClip(sid)?.name : getPlaylistRow(sid)?.name;
        logPlay({
            sourceType: sourceType || 'clip', sourceId: sid, sourceName: `DARURAT: ${sourceName || `#${sid}`}`,
            cameraIds: ids, results, operatorId: request.user?.id ?? null, operatorName: request.user?.username ?? null,
        });
        logAdminAction({ action: 'audio_emergency_fired', targetType: 'audio', targetId: sid, cameras: results.length, siren: Boolean(siren), ...adminContext(request) }, request);
        const okCount = results.filter((r) => r.ok).length;
        return reply.send({ success: true, message: `DARURAT diputar ke ${okCount}/${results.length} kamera${sirens ? ` + ${sirens} sirene` : ''}`, data: { results, sirens } });
    } catch (error) { return fail(reply, error, 'Gagal menyiarkan darurat'); }
}

/* ---------------------------------------------------------------- soundboard */

export async function listSoundboard(request, reply) {
    try {
        return reply.send({ success: true, data: listSoundboardRows() });
    } catch (error) { return fail(reply, error); }
}

export async function createSoundboardButton(request, reply) {
    try {
        const b = createSoundboardRow({ ...request.body, userId: request.user?.id ?? null });
        logAdminAction({ action: 'audio_soundboard_created', targetType: 'audio_soundboard', targetId: b.id, label: b.label, ...adminContext(request) }, request);
        return reply.code(201).send({ success: true, message: 'Tombol dibuat', data: b });
    } catch (error) { return fail(reply, error, 'Gagal membuat tombol'); }
}

export async function updateSoundboardButton(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID tombol tidak valid' });
        const b = updateSoundboardRow(id, request.body || {});
        logAdminAction({ action: 'audio_soundboard_updated', targetType: 'audio_soundboard', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Tombol diperbarui', data: b });
    } catch (error) { return fail(reply, error, 'Gagal memperbarui tombol'); }
}

export async function deleteSoundboardButton(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID tombol tidak valid' });
        const b = deleteSoundboardRow(id);
        logAdminAction({ action: 'audio_soundboard_deleted', targetType: 'audio_soundboard', targetId: id, label: b.label, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Tombol dihapus' });
    } catch (error) { return fail(reply, error, 'Gagal menghapus tombol'); }
}
