# Area Bulk Disable Safety Design

Purpose: Define safe behavior for disabling CCTV status, recording, and health monitoring through Area Management bulk actions.
Caller: Human/operator review before implementation planning.
Deps: `backend/services/cameraService.js`, `backend/__tests__/cameraBulkArea.test.js`, `frontend/src/pages/AreaManagement.jsx`.
MainFuncs: Specify bulk area eligibility, target filtering, disable semantics, and verification scope.
SideEffects: Documentation only; no runtime behavior changes.

## Problem

Area Management bulk actions can fail when disabling cameras in mixed-delivery areas. Single camera updates are safe because they call `updateCamera()` directly, but area bulk updates pass through `bulkUpdateArea()` target filtering and eligibility checks first.

The current bulk policy logic treats some updates as type-specific policies:

- `external_use_proxy`, `external_tls_mode`, and `external_origin_mode` force `external_hls_only`.
- `external_health_mode` forces `external_streams_only`.
- `enable_recording` is currently treated as internal-only.

That is valid for enabling or applying type-specific policy, but too strict for disable actions. Disable operations should be fail-safe and broadly applicable.

## Design Decision

Implement a focused bulk disable safety refinement, not a broad Area Management rewrite.

The backend should distinguish safe disable actions from type-specific policy actions:

- Public status disable (`enabled = 0`) applies to all cameras in the selected area target.
- Recording disable (`enable_recording = 0`) applies to all cameras in the selected area target.
- Recording enable (`enable_recording = 1`) remains internal-only unless a future recording source design explicitly supports more types.
- Health monitoring disable (`external_health_mode = 'disabled'`) should not fail the whole area because of mixed camera types. It updates eligible external cameras and reports skipped internal/unresolved cameras clearly.

## Target Behavior

### Public Status Disable

Bulk payload:

```json
{ "enabled": 0 }
```

Expected behavior:

- Applies to all matched cameras regardless of delivery type.
- Does not force `external_hls_only` or `external_streams_only`.
- Uses selected `targetFilter`; default `all` means every camera in area.
- Returns success if at least one camera was updated.

### Recording Disable

Bulk payload:

```json
{ "enable_recording": 0 }
```

Expected behavior:

- Applies to all matched cameras regardless of delivery type.
- Does not return `internal_only_policy`.
- Does not require external HLS metadata.
- If a camera has active recording, existing `updateCamera()` / recording service path should stop it safely.

### Recording Enable

Bulk payload:

```json
{ "enable_recording": 1 }
```

Expected behavior:

- Remains internal-only for now.
- External cameras are skipped with `internal_only_policy`.
- Preview must show blocked examples and reasons.

### Health Monitoring Disable

Bulk payload:

```json
{ "external_health_mode": "disabled" }
```

Expected behavior:

- Defaults to `external_streams_only`, because this field is external camera policy.
- Updates eligible external cameras.
- Skips internal and unresolved cameras with explicit summary, not a generic failure.
- If no eligible external cameras exist, return a 400 with actionable message rather than misleading HLS-only language.

## Backend Changes

### Eligibility Rules

Add helper logic in `cameraService.js`:

- `isRecordingDisable(payload)` returns true when `payload.enable_recording` is `0` or `false`.
- `isRecordingEnable(payload)` returns true when `payload.enable_recording` is `1` or `true`.
- `isPublicStatusDisable(payload)` returns true when `payload.enabled` is `0` or `false`.
- `isHealthMonitoringDisable(payload)` returns true when `payload.external_health_mode === 'disabled'`.

Update `getBulkEligibility()`:

- Do not block `enable_recording = 0` for non-internal cameras.
- Continue blocking `enable_recording = 1` for non-internal cameras.
- Never block `enabled = 0` based on delivery type.
- Keep health monitoring policy external-only, but let summary explain skipped cameras.

### Target Filter Rules

Update `requiresExternalStreamAreaPolicy()`:

- It still returns true for `external_health_mode` changes.
- It should not interact with public status disable or recording disable.

This keeps `external_health_mode = disabled` focused on external streams while letting `enabled = 0` and `enable_recording = 0` remain broad.

### Summary And Messaging

Preview/apply responses should show:

- `totalInArea`
- `matchedCount`
- `eligibleCount`
- `blockedCount`
- `blockedReasons`
- `blockedExamples`

Error messages should be specific:

- No cameras in area: `Area ini belum memiliki kamera`.
- Recording enable blocked: explain recording enable is currently internal-only.
- Health monitoring no eligible target: explain no external valid cameras matched.
- Disable public/recording should not fail merely because camera delivery type is not external HLS.

## Frontend Changes

Keep the UI mostly unchanged, but clarify labels/help text:

- `Status Publik = Matikan`: describe as disabling all selected cameras from public visibility.
- `Recording = Matikan`: describe as safe across all camera types.
- `Health Monitoring = Disabled`: describe as external camera health policy; internal cameras may be skipped.

The preview should remain the required operator checkpoint for risky bulk actions.

## Testing Strategy

Add backend tests to `backend/__tests__/cameraBulkArea.test.js`.

Required cases:

- Mixed area bulk `enabled = 0` with internal, external HLS, external MJPEG, and unresolved cameras updates all matched cameras.
- Mixed area bulk `enable_recording = 0` updates all matched cameras and does not produce `internal_only_policy`.
- Mixed area bulk `enable_recording = 1` only updates internal cameras and reports external cameras as blocked.
- Mixed area bulk `external_health_mode = 'disabled'` updates eligible external cameras, skips internal/unresolved, and returns clear summary.

Frontend tests are optional unless UI messaging changes become more than label/help text.

## Non-Goals

- Do not add support for recording external camera types in this change.
- Do not rewrite Area Management bulk UI.
- Do not change single camera management behavior.
- Do not change import/restore normalization logic.
- Do not change delivery type definitions.

## Acceptance Criteria

- Area bulk public disable works for mixed camera areas.
- Area bulk recording disable works for mixed camera areas.
- Area bulk recording enable remains protected and reports blocked external cameras.
- Area bulk health monitoring disable does not produce misleading external HLS-only errors.
- Existing `cameraBulkArea.test.js` tests continue to pass.
- New targeted bulk disable tests pass.
