/*
Purpose: Register Audio Broadcast endpoints (admin-only) — clip library, playlists, schedules, play-now.
Caller: backend/server.js, registered with prefix '/api/admin/audio'.
Deps: audioController, authMiddleware/requireAdmin, audioClipService (upload size).
MainFuncs: audioRoutes.
SideEffects: adds admin routes; the clip-upload route carries a raised bodyLimit for base64 audio.

The one large-body route is POST /clips (a full song, base64-in-JSON). Its bodyLimit must stay in
agreement with the matching allowance in middleware/inputSanitizer.js (MAX_AUDIO_BODY_SIZE), which is
the outer backstop that runs before auth — see the note there. Everything else is small JSON.
*/

import {
    listClips, uploadClip, deleteClip,
    listPlaylists, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist,
    listSchedules, createSchedule, updateSchedule, toggleSchedule, deleteSchedule,
    listCameras, playNow,
    listCapability, recheckCapability, recheckCameraCapability, listAreas, toggleArea,
    importClip, listImportJobs,
} from '../controllers/audioController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import { MAX_AUDIO_UPLOAD_BYTES } from '../services/audioClipService.js';

// base64 inflates by 4/3; add headroom for the surrounding JSON envelope. Stays below the sanitizer's
// MAX_AUDIO_BODY_SIZE so this route rejects an oversize body first.
const UPLOAD_BODY_LIMIT = Math.ceil(MAX_AUDIO_UPLOAD_BYTES * 1.4) + 4096;

export default async function audioRoutes(fastify) {
    const admin = { preHandler: [authMiddleware, requireAdmin] };

    // Clips
    fastify.get('/clips', admin, listClips);
    fastify.post('/clips', { ...admin, bodyLimit: UPLOAD_BODY_LIMIT }, uploadClip);
    fastify.post('/clips/import', admin, importClip);   // small JSON (a URL) — default body limit
    fastify.get('/clips/imports', admin, listImportJobs);
    fastify.delete('/clips/:id', admin, deleteClip);

    // Playlists
    fastify.get('/playlists', admin, listPlaylists);
    fastify.get('/playlists/:id', admin, getPlaylist);
    fastify.post('/playlists', admin, createPlaylist);
    fastify.put('/playlists/:id', admin, updatePlaylist);
    fastify.delete('/playlists/:id', admin, deletePlaylist);

    // Schedules
    fastify.get('/schedules', admin, listSchedules);
    fastify.post('/schedules', admin, createSchedule);
    fastify.put('/schedules/:id', admin, updateSchedule);
    fastify.patch('/schedules/:id/enabled', admin, toggleSchedule);
    fastify.delete('/schedules/:id', admin, deleteSchedule);

    // Targets + capability + area scope
    fastify.get('/cameras', admin, listCameras);           // scoped + capability-annotated
    fastify.get('/capability', admin, listCapability);
    fastify.post('/capability/recheck', admin, recheckCapability);
    fastify.post('/capability/recheck/:id', admin, recheckCameraCapability);
    fastify.get('/areas', admin, listAreas);
    fastify.patch('/areas/:id/enabled', admin, toggleArea);

    // Play-now
    fastify.post('/play', admin, playNow);
}
