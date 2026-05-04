<!--
Purpose: Design customizable internal RTSP ingest policy so local cameras can stay warm while remote sources run on demand.
Caller: Agents and maintainers preparing backend/frontend implementation for area and camera ingest policy controls.
Deps: SYSTEM_MAP.md, backend/services/mediaMtxService.js, backend/services/streamWarmer.js, backend/utils/internalIngestPolicy.js, frontend/src/pages/AreaManagement.jsx, frontend/src/pages/CameraManagement.jsx.
MainFuncs: Defines policy resolution, admin controls, runtime behavior, testing, and rollout constraints.
SideEffects: None; documentation only.
-->

# Internal Ingest Policy Design

## Goal

Let admins configure whether internal RTSP cameras stay prewarmed or run only when users watch them. Local cameras should be able to stay fast with `always_on`, while Surabaya or other remote/private RTSP sources can use `on_demand` to protect bandwidth.

## Current State

The database already has the required fields:
- `areas.internal_ingest_policy_default`
- `areas.internal_on_demand_close_after_seconds`
- `cameras.internal_ingest_policy_override`
- `cameras.internal_on_demand_close_after_seconds_override`
- `cameras.source_profile`

`mediaMtxService.buildInternalPathConfig()` already maps the resolved policy to MediaMTX `sourceOnDemand`. The gap is that `streamWarmer.warmAllCameras()` currently warms every internal camera, so on-demand cameras are still periodically triggered. The existing policy fallback also defaults ordinary cameras to `on_demand`, which is wrong for the local low-latency requirement.

## Policy Model

Use the existing area and camera columns as the source of truth. Do not add a new table.

Resolution order:
1. Camera override: `cameras.internal_ingest_policy_override` when it is `always_on` or `on_demand`.
2. Area default: `areas.internal_ingest_policy_default` when it is `always_on` or `on_demand`.
3. Compatibility fallback: strict remote profile such as `source_profile='surabaya_private_rtsp'` resolves to `on_demand`.
4. Global fallback: ordinary internal RTSP cameras resolve to `always_on`.

Close-after resolution:
1. Camera close-after override when present.
2. Area close-after default when present.
3. Strict remote profile fallback: `15` seconds.
4. General on-demand fallback: `30` seconds.

`source_profile` remains a compatibility hint for existing imports and migrations, not the main policy surface. Future sources should be controlled through area defaults and camera overrides.

## Runtime Behavior

All enabled internal RTSP cameras remain configured as MediaMTX paths.

For `always_on`:
- MediaMTX path uses `sourceOnDemand=false`.
- `streamWarmer` prewarms and keeps the path alive.
- User playback starts quickly.

For `on_demand`:
- MediaMTX path uses `sourceOnDemand=true`.
- `streamWarmer` skips the camera.
- MediaMTX pulls the RTSP source only when HLS is requested by a real viewer.
- MediaMTX closes the RTSP source after `sourceOnDemandCloseAfter`.

Viewer tracking remains separate and unchanged. No new active-viewer table is needed because MediaMTX already owns source start/close behavior.

## Admin UX

Area Management should expose:
- `Internal ingest policy`: `Default`, `Always On`, `On Demand`.
- `On-demand close after`: numeric seconds, clamped by backend validation to `5..300`; blank means fallback.

Camera Management should expose:
- `Internal ingest override`: `Use area default`, `Always On`, `On Demand`.
- `On-demand close after override`: numeric seconds, blank means area/global fallback.

Camera cards should show the resolved ingest status:
- `Ingest: Always On`
- `Ingest: On Demand`

The labels should avoid hardcoding Surabaya. Surabaya can be configured by setting its area default to `On Demand`.

## Backend Boundaries

`backend/utils/internalIngestPolicy.js` owns pure policy resolution.

`backend/services/mediaMtxService.js` reads area and camera policy fields and converts the resolved policy into MediaMTX path config.

`backend/services/streamWarmer.js` filters warmed cameras by resolved policy and skips on-demand cameras.

`backend/services/areaService.js` and `backend/services/cameraService.js` keep using the existing columns for CRUD/import/export.

No route should implement policy branching directly.

## Frontend Boundaries

`frontend/src/pages/AreaManagement.jsx` owns area form fields until the page is later extracted.

`frontend/src/pages/CameraManagement.jsx`, `frontend/src/hooks/admin/useCameraManagementPage.js`, `frontend/src/components/admin/cameras/*`, and `frontend/src/utils/admin/cameraFormAdapter.js` own camera override display and form payload mapping.

Frontend display should use backend-returned policy fields when available and mirror `resolveInternalIngestPolicy()` rules only for operator labels.

## Testing

Backend focused tests:
- `backend/__tests__/internalIngestPolicy.test.js`: policy resolution order, fallback to `always_on`, strict profile fallback to `on_demand`, close-after fallback and clamping.
- `backend/__tests__/streamWarmer.test.js`: `warmAllCameras()` warms only `always_on` cameras and skips `on_demand`.
- `backend/__tests__/mediaMtxService.test.js`: path config uses `sourceOnDemand=false` for `always_on` and `true` for `on_demand`.

Frontend focused tests:
- `frontend/src/pages/AreaManagement.test.jsx`: area form payload includes ingest policy and close-after values.
- `frontend/src/pages/CameraManagement.test.jsx` or hook/adapter tests: camera override payload and badges render correctly.

Verification commands:

```bash
cd backend
npm test -- internalIngestPolicy.test.js streamWarmer.test.js mediaMtxService.test.js
```

```bash
cd frontend
npm test -- AreaManagement.test.jsx CameraManagement.test.jsx cameraFormAdapter.test.js
```

## Rollout

No schema migration is required unless a target database predates `add_internal_ingest_policy.js`; normal `npm run migrate` covers that case.

After deployment, configure areas:
- Local areas: `Always On`.
- Surabaya/remote/private RTSP areas: `On Demand`.
- Use camera override only for exceptions.

This minimizes DB I/O and avoids new joins because existing camera read models already include the needed area policy fields.
