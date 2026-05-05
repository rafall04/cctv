/**
 * Purpose: Register public playback token activation endpoints.
 * Caller: backend/server.js under the /api prefix.
 * Deps: playbackTokenController.
 * MainFuncs: playbackTokenRoutes.
 * SideEffects: Adds token activation, heartbeat, and clear routes to Fastify.
 */

import {
    activatePlaybackToken,
    clearPlaybackToken,
    heartbeatPlaybackToken,
} from '../controllers/playbackTokenController.js';

export default async function playbackTokenRoutes(fastify) {
    fastify.post('/playback-token/activate', activatePlaybackToken);
    fastify.post('/playback-token/heartbeat', heartbeatPlaybackToken);
    fastify.post('/playback-token/clear', clearPlaybackToken);
}
