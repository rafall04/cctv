/*
Purpose: Thin route adapter for the opaque external-HLS proxy. Mounts /api/stream/:id/external.*;
         all proxy/cache/SWR/dedup/viewer-session logic lives in services/externalStreamProxyService.js
         so the route layer stays thin (no DB access / business logic here).
Caller: backend/server.js, registered under the /api/stream prefix alongside streamRoutes.
MainFuncs: default export (= registerExternalStreamProxyRoutes, a fastify plugin).
SideEffects: none in this file — delegates entirely to the service.
*/

export { registerExternalStreamProxyRoutes as default } from '../services/externalStreamProxyService.js';
