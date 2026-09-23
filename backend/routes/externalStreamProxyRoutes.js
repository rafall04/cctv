/*
Purpose: Thin route adapter for the opaque external proxies. Mounts /api/stream/:id/external.*
         (HLS playlist/segments via externalStreamProxyService, MJPEG relay via
         externalMjpegProxyService) sharing ONE viewer-session store, so a viewer switching
         between the two is a single session. All proxy/cache/SWR/gate logic lives in the
         services — no DB access or business logic here.
Caller: backend/server.js, registered under the /api/stream prefix alongside streamRoutes.
MainFuncs: default export (fastify plugin).
SideEffects: starts the shared HlsRouteState (session store) and stops it onClose.
*/

import { registerExternalStreamProxyRoutes } from '../services/externalStreamProxyService.js';
import registerExternalMjpegProxyRoutes from '../services/externalMjpegProxyService.js';
import { createHlsRouteState } from '../services/hlsProxyService.js';

export default async function externalStreamProxyRoutes(fastify, options = {}) {
    const routeState = options.routeState || createHlsRouteState();
    routeState.start();
    fastify.addHook('onClose', async () => {
        await routeState.stop();
    });
    await registerExternalStreamProxyRoutes(fastify, { ...options, routeState });
    await registerExternalMjpegProxyRoutes(fastify, { ...options, routeState });
}
