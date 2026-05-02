# Stabilization Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore clean quality gates and reduce feature-work risk by fixing lint, guarding repo artifacts, and extracting small boundaries from the largest frontend and backend modules.

**Architecture:** This is a behavior-preserving stabilization sprint. Changes are split into small commits: quality gate fix, repository hygiene, frontend pure-helper extraction, backend policy extraction, and final verification. New modules expose pure functions first so existing pages/services can adopt them with minimal behavior risk.

**Tech Stack:** Node.js 20, Fastify, SQLite/better-sqlite3, React 18, Vite, Vitest, ESLint, Tailwind CSS.

---

## File Structure

- Create: `backend/utils/authCookieOptions.js`
  - Centralize request-aware auth cookie option derivation for login and refresh responses.
- Modify: `backend/controllers/authController.js`
  - Use the shared auth cookie option helper for `token` and `refreshToken` cookies.
- Test: `backend/__tests__/authCookieOptions.test.js`
  - Verify direct-IP, IP-with-port, forwarded HTTPS, and backend-domain cookie settings.
- Modify: `deployment/generate-env.sh`
  - Ensure generated reverse proxy config forwards `X-Forwarded-Proto` for `/api`, `/hls`, and recording API locations.
- Modify: `frontend/src/services/apiClient.js`
  - Add a focused regression only if investigation shows runtime API base can become cross-origin for IP access.
- Modify: `frontend/src/components/landing/LandingCameraCard.jsx`
  - Remove unused computed state while preserving existing availability behavior.
- Modify: `frontend/src/pages/ViewerAnalytics.jsx`
  - Stabilize hook dependencies by memoizing array defaults.
- Modify: `.gitignore`
  - Add explicit local artifact guard rules for temporary dumps and local import/export artifacts.
- Create: `docs/superpowers/reports/2026-05-02-root-artifact-audit.md`
  - Document root artifacts that should be archived or deleted only after approval.
- Create: `frontend/src/utils/mapCoordinateUtils.js`
  - Move pure coordinate helpers out of `MapView.jsx`.
- Modify: `frontend/src/components/MapView.jsx`
  - Import extracted coordinate helpers.
- Test: `frontend/src/utils/mapCoordinateUtils.test.js`
  - Verify helper behavior independently.
- Create: `frontend/src/utils/playbackSegmentSelection.js`
  - Extract stable playback timestamp/segment selection helpers.
- Modify: `frontend/src/pages/Playback.jsx`
  - Use extracted helper where current inline logic selects target/closest segment.
- Test: `frontend/src/utils/playbackSegmentSelection.test.js`
  - Verify share timestamp matching and closest-segment fallback.
- Create: `backend/services/cameraHealthPolicy.js`
  - Extract external health mode policy resolution.
- Modify: `backend/services/cameraHealthService.js`
  - Delegate external health mode resolution to the policy module.
- Test: `backend/__tests__/cameraHealthPolicy.test.js`
  - Verify explicit, area override, delivery default, and fallback policy behavior.

---

## Task 0: Fix Admin Login Bounce On IP Access

**Files:**
- Create: `backend/utils/authCookieOptions.js`
- Modify: `backend/controllers/authController.js`
- Test: `backend/__tests__/authCookieOptions.test.js`
- Modify: `deployment/generate-env.sh`
- Optional Modify: `frontend/src/services/apiClient.js`

- [ ] **Step 1: Write backend cookie option tests**

Create `backend/__tests__/authCookieOptions.test.js` covering:

```javascript
/*
 * Purpose: Verify auth cookie options for domain and direct-IP admin access.
 * Caller: Backend Vitest suite before auth cookie changes.
 * Deps: authCookieOptions helper.
 * MainFuncs: getAuthCookieOptions.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { getAuthCookieOptions } from '../utils/authCookieOptions.js';

const makeRequest = ({ host, forwardedProto, protocol = 'http' }) => ({
    headers: {
        host,
        ...(forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {}),
    },
    protocol,
});

describe('getAuthCookieOptions', () => {
    it('uses lax non-secure cookies for direct HTTP IP same-origin access', () => {
        const options = getAuthCookieOptions(makeRequest({ host: '172.17.11.12:800' }));

        expect(options.access).toMatchObject({
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
        });
    });

    it('uses secure none cookies when proxy reports HTTPS', () => {
        const options = getAuthCookieOptions(makeRequest({
            host: '172.17.11.12',
            forwardedProto: 'https',
        }));

        expect(options.access.secure).toBe(true);
        expect(options.access.sameSite).toBe('none');
    });

    it('keeps refresh token scoped to refresh route', () => {
        const options = getAuthCookieOptions(makeRequest({ host: 'cctv.example.test' }));

        expect(options.refresh.path).toBe('/api/auth/refresh');
        expect(options.refresh.maxAge).toBe(7 * 24 * 60 * 60);
    });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
Push-Location backend
npm test -- authCookieOptions.test.js
Pop-Location
```

Expected: fail because `backend/utils/authCookieOptions.js` does not exist.

- [ ] **Step 3: Create cookie option helper**

Create `backend/utils/authCookieOptions.js`:

```javascript
/*
 * Purpose: Derive auth cookie options consistently for domain and direct-IP access.
 * Caller: authController login and refresh handlers.
 * Deps: Fastify request headers/protocol.
 * MainFuncs: getAuthCookieOptions.
 * SideEffects: None.
 */

export function isHttpsRequest(request) {
    return request.headers?.['x-forwarded-proto'] === 'https'
        || request.protocol === 'https'
        || request.socket?.encrypted === true;
}

export function getAuthCookieOptions(request) {
    const isHttps = isHttpsRequest(request);
    const shared = {
        httpOnly: true,
        secure: isHttps,
        sameSite: isHttps ? 'none' : 'lax',
    };

    return {
        access: {
            ...shared,
            path: '/',
            maxAge: 60 * 60,
        },
        refresh: {
            ...shared,
            path: '/api/auth/refresh',
            maxAge: 7 * 24 * 60 * 60,
        },
    };
}
```

- [ ] **Step 4: Wire helper into auth controller**

In `backend/controllers/authController.js`, import:

```javascript
import { getAuthCookieOptions } from '../utils/authCookieOptions.js';
```

Replace duplicated login and refresh cookie option blocks with:

```javascript
const cookieOptions = getAuthCookieOptions(request);
reply.setCookie('token', data.accessToken, cookieOptions.access);
reply.setCookie('refreshToken', data.refreshToken, cookieOptions.refresh);
```

and in refresh:

```javascript
const cookieOptions = getAuthCookieOptions(request);
reply.setCookie('token', data.newAccessToken, cookieOptions.access);
reply.setCookie('refreshToken', data.newRefreshToken, cookieOptions.refresh);
```

- [ ] **Step 5: Patch generated proxy config**

In `deployment/generate-env.sh`, ensure every generated `location` that proxies to `localhost:BACKEND_PORT_PLACEHOLDER` includes:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

This keeps HTTPS/IP cookie derivation consistent behind generated Nginx configs.

- [ ] **Step 6: Verify focused auth tests**

Run:

```powershell
Push-Location backend
npm test -- authCookieOptions.test.js
Pop-Location
```

Expected: `Test Files 1 passed`.

- [ ] **Step 7: Verify backend full gate**

Run:

```powershell
Push-Location backend
npm run migrate
npm test
Pop-Location
```

Expected: migrations pass with 0 failed; backend tests pass.

- [ ] **Step 8: Commit and push**

Run:

```powershell
git add backend/utils/authCookieOptions.js backend/controllers/authController.js backend/__tests__/authCookieOptions.test.js deployment/generate-env.sh docs/superpowers/specs/2026-05-02-pre-feature-stabilization-design.md docs/superpowers/plans/2026-05-02-stabilization-sprint.md
git commit -m "Fix: stabilize admin auth cookies for IP access"
git push origin main
```

---

## Task 1: Create Stabilization Branch And Baseline

**Files:**
- Read: `SYSTEM_MAP.md`
- Read: `.module_map.md`
- Read: `docs/superpowers/specs/2026-05-02-stabilization-sprint-design.md`

- [ ] **Step 1: Confirm maps and clean state**

Run:

```powershell
Test-Path SYSTEM_MAP.md
Test-Path .module_map.md
git status --short
```

Expected:

```text
False
False
```

`git status --short` should be empty. If it is not empty, inspect changes and do not overwrite unrelated user work.

- [ ] **Step 2: Create a working branch**

Run:

```powershell
git switch -c codex/stabilization-sprint
```

Expected:

```text
Switched to a new branch 'codex/stabilization-sprint'
```

- [ ] **Step 3: Run baseline commands**

Run:

```powershell
Push-Location backend
npm run migrate
npm test
Pop-Location
Push-Location frontend
npm test
npm run build
npm run lint
Pop-Location
```

Expected:

- Backend migration succeeds with 0 failed migrations.
- Backend tests pass.
- Frontend tests pass.
- Frontend build passes.
- Frontend lint fails only with the known `LandingCameraCard.jsx` unused variable and `ViewerAnalytics.jsx` hook dependency warning.

Do not commit after this task unless a generated file changed. If a generated file changed, stop and inspect it.

---

## Task 2: Fix Frontend Lint Gate

**Files:**
- Modify: `frontend/src/components/landing/LandingCameraCard.jsx`
- Modify: `frontend/src/pages/ViewerAnalytics.jsx`

- [ ] **Step 1: Edit `LandingCameraCard.jsx`**

Remove this line:

```jsx
const availabilityState = getCameraAvailabilityState(camera);
```

Update the import from:

```jsx
import { getCameraAvailabilityState, isCameraHardOffline, isCameraDegraded } from '../../utils/cameraAvailability.js';
```

to:

```jsx
import { isCameraHardOffline, isCameraDegraded } from '../../utils/cameraAvailability.js';
```

- [ ] **Step 2: Edit `ViewerAnalytics.jsx`**

Replace:

```jsx
const activeSessions = analytics?.activeSessions || [];
const topCameras = analytics?.topCameras || [];
const deviceBreakdown = analytics?.deviceBreakdown || [];
const peakHours = analytics?.peakHours || [];
```

with:

```jsx
const activeSessions = useMemo(() => analytics?.activeSessions || [], [analytics?.activeSessions]);
const topCameras = analytics?.topCameras || [];
const deviceBreakdown = analytics?.deviceBreakdown || [];
const peakHours = analytics?.peakHours || [];
```

- [ ] **Step 3: Verify frontend lint**

Run:

```powershell
Push-Location frontend
npm run lint
Pop-Location
```

Expected:

```text
✖ 0 problems
```

ESLint may omit the exact phrase and simply exit with code 0.

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
Push-Location frontend
npm test -- LandingCameraCard.test.jsx ViewerAnalytics.test.jsx
Pop-Location
```

Expected:

```text
Test Files 2 passed
```

- [ ] **Step 5: Commit**

Run:

```powershell
git add frontend/src/components/landing/LandingCameraCard.jsx frontend/src/pages/ViewerAnalytics.jsx
git commit -m "Fix: restore frontend lint gate"
git push origin codex/stabilization-sprint
```

---

## Task 3: Add Repository Hygiene Guard

**Files:**
- Modify: `.gitignore`
- Create: `docs/superpowers/reports/2026-05-02-root-artifact-audit.md`

- [ ] **Step 1: List root artifacts**

Run:

```powershell
Get-ChildItem -Force -File |
    Select-Object Length,Name |
    Sort-Object Length -Descending |
    Select-Object -First 30 |
    Format-Table -AutoSize
```

Record files matching local/debug artifact patterns such as:

```text
tmp_*
*.dec.txt
*.sec
*.apk
*_import_*.json
*_raw_*.json
*_catalog_*.json
```

- [ ] **Step 2: Update `.gitignore`**

Append this block if equivalent rules do not already exist:

```gitignore
# Local CCTV import/export and debug artifacts
/tmp_*
/*.dec.txt
/*.sec
/*.apk
/*_import_*.json
/*_raw_*.json
/*_catalog_*.json
/cctv_backup_*.json
/private_exports/
```

- [ ] **Step 3: Create artifact audit report**

Create `docs/superpowers/reports/2026-05-02-root-artifact-audit.md`:

```markdown
# Root Artifact Audit

## Purpose

Record root-level local artifacts that should not become part of normal feature work.

## Classification

| Pattern | Classification | Action |
| --- | --- | --- |
| `tmp_*` | Debug temporary file | Ignore for future commits; delete only after owner approval. |
| `*.dec.txt` | Decrypted local dump | Ignore for future commits; treat as sensitive local artifact. |
| `*.sec` | Encrypted or local dump | Ignore for future commits; treat as sensitive local artifact. |
| `*.apk` | Local binary artifact | Ignore for future commits; archive outside repo if still needed. |
| `*_import_*.json` | Import/export data | Ignore for future commits; move to `private_exports/` only with approval. |
| `*_raw_*.json` | Import/export raw data | Ignore for future commits; move to `private_exports/` only with approval. |
| `*_catalog_*.json` | Import/export catalog data | Ignore for future commits; move to `private_exports/` only with approval. |
| `cctv_backup_*.json` | Backup data | Ignore for future commits; do not delete without approval. |

## Notes

No root artifacts are deleted by this stabilization task. The change only prevents future accidental commits and documents cleanup candidates.
```

- [ ] **Step 4: Verify ignored files**

Run:

```powershell
git status --ignored --short | Select-String 'tmp_|\.apk|\.dec\.txt|\.sec|_import_|_raw_|_catalog_|cctv_backup_'
```

Expected: matching untracked artifacts show with `!!` when ignored. Already tracked files may not show as ignored; list those in the final report instead of deleting them.

- [ ] **Step 5: Commit**

Run:

```powershell
git add .gitignore docs/superpowers/reports/2026-05-02-root-artifact-audit.md
git commit -m "Add: guard local artifact files"
git push origin codex/stabilization-sprint
```

---

## Task 4: Extract Map Coordinate Helpers

**Files:**
- Create: `frontend/src/utils/mapCoordinateUtils.js`
- Create: `frontend/src/utils/mapCoordinateUtils.test.js`
- Modify: `frontend/src/components/MapView.jsx`

- [ ] **Step 1: Create failing tests**

Create `frontend/src/utils/mapCoordinateUtils.test.js`:

```javascript
// Purpose: Verify pure coordinate helpers used by public map rendering.
// Caller: Vitest frontend suite.
// Deps: mapCoordinateUtils pure functions.
// MainFuncs: hasValidCoords, normalizeAreaKey, getValidCoordinatePair, getBoundsCenterFromCameras.
// SideEffects: None.

import { describe, expect, it } from 'vitest';
import {
    getBoundsCenterFromCameras,
    getValidCoordinatePair,
    hasValidCoords,
    normalizeAreaKey,
} from './mapCoordinateUtils';

describe('mapCoordinateUtils', () => {
    it('accepts non-zero numeric coordinate strings', () => {
        expect(hasValidCoords({ latitude: '-7.25', longitude: '112.75' })).toBe(true);
    });

    it('rejects zero-zero and invalid coordinates', () => {
        expect(hasValidCoords({ latitude: '0', longitude: '0' })).toBe(false);
        expect(hasValidCoords({ latitude: 'abc', longitude: '112.75' })).toBe(false);
    });

    it('normalizes area keys by trimming, collapsing whitespace, and lowercasing', () => {
        expect(normalizeAreaKey('  Surabaya   Pusat  ')).toBe('surabaya pusat');
    });

    it('returns numeric coordinate pair only for valid values', () => {
        expect(getValidCoordinatePair({ latitude: '-7.2', longitude: '112.7' })).toEqual({
            latitude: -7.2,
            longitude: 112.7,
        });
        expect(getValidCoordinatePair({ latitude: '0', longitude: '0' })).toBeNull();
    });

    it('calculates bounds center from valid camera coordinates only', () => {
        expect(getBoundsCenterFromCameras([
            { latitude: '-8', longitude: '110' },
            { latitude: '-6', longitude: '114' },
            { latitude: '0', longitude: '0' },
        ])).toEqual({
            latitude: -7,
            longitude: 112,
        });
    });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
Push-Location frontend
npm test -- mapCoordinateUtils.test.js
Pop-Location
```

Expected: fail because `mapCoordinateUtils.js` does not exist.

- [ ] **Step 3: Create helper module**

Create `frontend/src/utils/mapCoordinateUtils.js`:

```javascript
// Purpose: Pure coordinate and area-key helpers for map components.
// Caller: MapView and map helper tests.
// Deps: None.
// MainFuncs: hasValidCoords, normalizeAreaKey, getValidCoordinatePair, getBoundsCenterFromCameras.
// SideEffects: None.

export const hasValidCoords = (camera) => {
    const lat = parseFloat(camera?.latitude);
    const lng = parseFloat(camera?.longitude);
    return !Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0);
};

export const normalizeAreaKey = (value) => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

export const getValidCoordinatePair = (value) => {
    if (!value) {
        return null;
    }

    const lat = parseFloat(value.latitude);
    const lng = parseFloat(value.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng) || (lat === 0 && lng === 0)) {
        return null;
    }

    return { latitude: lat, longitude: lng };
};

export const getBoundsCenterFromCameras = (cameras = []) => {
    const validCameras = Array.isArray(cameras) ? cameras.filter(hasValidCoords) : [];
    if (validCameras.length === 0) {
        return null;
    }

    const latitudes = validCameras.map((camera) => parseFloat(camera.latitude));
    const longitudes = validCameras.map((camera) => parseFloat(camera.longitude));

    if (latitudes.some(Number.isNaN) || longitudes.some(Number.isNaN)) {
        return null;
    }

    return {
        latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
        longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    };
};
```

- [ ] **Step 4: Update `MapView.jsx` imports and remove duplicates**

Add import:

```jsx
import {
    getBoundsCenterFromCameras,
    getValidCoordinatePair,
    hasValidCoords,
    normalizeAreaKey,
} from '../utils/mapCoordinateUtils';
```

Remove the inline definitions for:

```jsx
const hasValidCoords = ...
const normalizeAreaKey = ...
const getValidCoordinatePair = ...
const getBoundsCenterFromCameras = ...
```

Do not move `buildBoundsFromCameras` yet because it depends on Leaflet `L`.

- [ ] **Step 5: Verify focused tests**

Run:

```powershell
Push-Location frontend
npm test -- mapCoordinateUtils.test.js MapView.test.jsx
Pop-Location
```

Expected:

```text
Test Files 2 passed
```

- [ ] **Step 6: Commit**

Run:

```powershell
git add frontend/src/utils/mapCoordinateUtils.js frontend/src/utils/mapCoordinateUtils.test.js frontend/src/components/MapView.jsx
git commit -m "Refactor: extract map coordinate helpers"
git push origin codex/stabilization-sprint
```

---

## Task 5: Extract Playback Segment Selection Helpers

**Files:**
- Create: `frontend/src/utils/playbackSegmentSelection.js`
- Create: `frontend/src/utils/playbackSegmentSelection.test.js`
- Modify: `frontend/src/pages/Playback.jsx`

- [ ] **Step 1: Create failing tests**

Create `frontend/src/utils/playbackSegmentSelection.test.js`:

```javascript
// Purpose: Verify pure playback segment selection for shared timestamps.
// Caller: Vitest frontend suite and Playback page.
// Deps: playbackSegmentSelection pure functions.
// MainFuncs: findSegmentForTimestamp, findClosestSegmentByStartTime.
// SideEffects: None.

import { describe, expect, it } from 'vitest';
import { findClosestSegmentByStartTime, findSegmentForTimestamp } from './playbackSegmentSelection';

const segments = [
    { id: 1, start_time: 1000, end_time: 1100 },
    { id: 2, start_time: 1200, end_time: 1300 },
    { id: 3, start_time: 1500, end_time: 1600 },
];

describe('playbackSegmentSelection', () => {
    it('finds the segment containing the shared timestamp', () => {
        expect(findSegmentForTimestamp(segments, 1250)).toEqual(segments[1]);
    });

    it('returns null when no segment contains the timestamp', () => {
        expect(findSegmentForTimestamp(segments, 1400)).toBeNull();
    });

    it('finds the closest segment by start time as fallback', () => {
        expect(findClosestSegmentByStartTime(segments, 1420)).toEqual(segments[2]);
    });

    it('handles empty segment lists', () => {
        expect(findSegmentForTimestamp([], 1250)).toBeNull();
        expect(findClosestSegmentByStartTime([], 1250)).toBeNull();
    });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
Push-Location frontend
npm test -- playbackSegmentSelection.test.js
Pop-Location
```

Expected: fail because `playbackSegmentSelection.js` does not exist.

- [ ] **Step 3: Create helper module**

Create `frontend/src/utils/playbackSegmentSelection.js`:

```javascript
// Purpose: Pure segment selection helpers for playback share URLs.
// Caller: Playback page and playback helper tests.
// Deps: None.
// MainFuncs: findSegmentForTimestamp, findClosestSegmentByStartTime.
// SideEffects: None.

export function findSegmentForTimestamp(segments, timestamp) {
    if (!Array.isArray(segments) || segments.length === 0 || !Number.isFinite(Number(timestamp))) {
        return null;
    }

    const targetTime = Number(timestamp);
    return segments.find((segment) => {
        const start = Number(segment.start_time);
        const end = Number(segment.end_time);
        return Number.isFinite(start) && Number.isFinite(end) && start <= targetTime && end >= targetTime;
    }) || null;
}

export function findClosestSegmentByStartTime(segments, timestamp) {
    if (!Array.isArray(segments) || segments.length === 0 || !Number.isFinite(Number(timestamp))) {
        return null;
    }

    const targetTime = Number(timestamp);
    return segments.reduce((closest, segment) => {
        if (!closest) {
            return segment;
        }

        return Math.abs(Number(segment.start_time) - targetTime) < Math.abs(Number(closest.start_time) - targetTime)
            ? segment
            : closest;
    }, null);
}
```

- [ ] **Step 4: Update `Playback.jsx`**

Add import:

```jsx
import { findClosestSegmentByStartTime, findSegmentForTimestamp } from '../utils/playbackSegmentSelection';
```

Replace inline logic that finds a segment by `start_time <= targetTime && end_time >= targetTime` and then falls back to closest `start_time` with:

```jsx
const targetSegment = findSegmentForTimestamp(segments, targetTime)
    || findClosestSegmentByStartTime(segments, targetTime);
```

Use the existing local variable names in `Playback.jsx` for `segments` and `targetTime`; do not change URL parameter names.

- [ ] **Step 5: Verify focused tests**

Run:

```powershell
Push-Location frontend
npm test -- playbackSegmentSelection.test.js Playback.test.jsx
Pop-Location
```

Expected:

```text
Test Files 2 passed
```

- [ ] **Step 6: Commit**

Run:

```powershell
git add frontend/src/utils/playbackSegmentSelection.js frontend/src/utils/playbackSegmentSelection.test.js frontend/src/pages/Playback.jsx
git commit -m "Refactor: extract playback segment selection"
git push origin codex/stabilization-sprint
```

---

## Task 6: Extract Camera Health Policy Resolution

**Files:**
- Create: `backend/services/cameraHealthPolicy.js`
- Create: `backend/__tests__/cameraHealthPolicy.test.js`
- Modify: `backend/services/cameraHealthService.js`

- [ ] **Step 1: Create failing tests**

Create `backend/__tests__/cameraHealthPolicy.test.js`:

```javascript
// Purpose: Verify external camera health mode policy resolution.
// Caller: Vitest backend suite.
// Deps: cameraHealthPolicy pure policy helper.
// MainFuncs: resolveExternalHealthMode.
// SideEffects: None.

import { describe, expect, it } from 'vitest';
import { resolveExternalHealthMode } from '../services/cameraHealthPolicy.js';

const defaults = {
    external_mjpeg: 'passive_first',
    external_hls: 'hybrid_probe',
    external_flv: 'passive_first',
    external_embed: 'passive_first',
    external_jsmpeg: 'disabled',
    external_custom_ws: 'disabled',
};

describe('cameraHealthPolicy', () => {
    it('uses explicit camera mode before defaults', () => {
        expect(resolveExternalHealthMode({
            camera: { external_health_mode: 'disabled', delivery_type: 'external_hls' },
            defaults,
        })).toBe('disabled');
    });

    it('uses area override before delivery defaults', () => {
        expect(resolveExternalHealthMode({
            camera: {
                external_health_mode: 'default',
                area_external_health_mode_override: 'hybrid_probe',
                delivery_type: 'external_mjpeg',
            },
            defaults,
        })).toBe('hybrid_probe');
    });

    it('uses delivery-specific defaults', () => {
        expect(resolveExternalHealthMode({
            camera: { delivery_type: 'external_flv' },
            defaults,
        })).toBe('passive_first');
    });

    it('defaults websocket-like external cameras to disabled', () => {
        expect(resolveExternalHealthMode({
            camera: { delivery_type: 'external_custom_ws' },
            defaults: {},
        })).toBe('disabled');
    });

    it('falls back to hybrid_probe for unknown delivery types', () => {
        expect(resolveExternalHealthMode({
            camera: { delivery_type: 'external_unknown' },
            defaults: {},
        })).toBe('hybrid_probe');
    });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
Push-Location backend
npm test -- cameraHealthPolicy.test.js
Pop-Location
```

Expected: fail because `cameraHealthPolicy.js` does not exist.

- [ ] **Step 3: Create policy module**

Create `backend/services/cameraHealthPolicy.js`:

```javascript
// Purpose: Resolve external camera health monitoring policy from camera, area, and settings defaults.
// Caller: cameraHealthService and cameraHealthPolicy tests.
// Deps: cameraDelivery helpers.
// MainFuncs: normalizeExternalHealthMode, resolveExternalHealthMode.
// SideEffects: None.

import { getEffectiveDeliveryType } from './cameraDelivery.js';

const VALID_EXTERNAL_HEALTH_MODES = new Set([
    'default',
    'disabled',
    'passive_first',
    'hybrid_probe',
    'strict_probe',
]);

export function normalizeExternalHealthMode(mode) {
    const normalized = String(mode || 'default').trim().toLowerCase();
    return VALID_EXTERNAL_HEALTH_MODES.has(normalized) ? normalized : 'default';
}

export function resolveExternalHealthMode({ camera, defaults = {} }) {
    const explicitMode = normalizeExternalHealthMode(camera?.external_health_mode);
    if (explicitMode !== 'default') {
        return explicitMode;
    }

    const areaOverrideMode = normalizeExternalHealthMode(camera?.area_external_health_mode_override);
    if (areaOverrideMode !== 'default') {
        return areaOverrideMode;
    }

    const deliveryType = getEffectiveDeliveryType(camera);

    if (deliveryType === 'external_mjpeg') {
        return defaults.external_mjpeg || 'passive_first';
    }

    if (deliveryType === 'external_hls') {
        return defaults.external_hls || 'hybrid_probe';
    }

    if (deliveryType === 'external_flv') {
        return defaults.external_flv || 'passive_first';
    }

    if (deliveryType === 'external_embed') {
        return defaults.external_embed || 'passive_first';
    }

    if (deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
        return defaults[deliveryType] || 'disabled';
    }

    return 'hybrid_probe';
}
```

- [ ] **Step 4: Update `cameraHealthService.js`**

Add import near other service imports:

```javascript
import { resolveExternalHealthMode as resolveExternalHealthModePolicy } from './cameraHealthPolicy.js';
```

Replace the body of `resolveExternalHealthMode(camera)` with:

```javascript
resolveExternalHealthMode(camera) {
    return resolveExternalHealthModePolicy({
        camera,
        defaults: settingsService.getExternalHealthDefaults(),
    });
}
```

Do not change callers of `this.resolveExternalHealthMode(camera)`.

- [ ] **Step 5: Verify focused backend tests**

Run:

```powershell
Push-Location backend
npm test -- cameraHealthPolicy.test.js cameraHealthService.test.js streamService.test.js
Pop-Location
```

Expected:

```text
Test Files 3 passed
```

- [ ] **Step 6: Commit**

Run:

```powershell
git add backend/services/cameraHealthPolicy.js backend/__tests__/cameraHealthPolicy.test.js backend/services/cameraHealthService.js
git commit -m "Refactor: extract camera health policy"
git push origin codex/stabilization-sprint
```

---

## Task 7: Full Verification And Merge

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run full backend verification**

Run:

```powershell
Push-Location backend
npm run migrate
npm test
Pop-Location
```

Expected:

- Migration summary has 0 failed migrations.
- Backend tests pass.

- [ ] **Step 2: Run full frontend verification**

Run:

```powershell
Push-Location frontend
npm run lint
npm test
npm run build
Pop-Location
```

Expected:

- Lint exits 0.
- Frontend tests pass.
- Production build passes.

- [ ] **Step 3: Check working tree**

Run:

```powershell
git status --short
git log --oneline --max-count 8
```

Expected:

- `git status --short` is empty.
- Recent commits show the stabilization sprint commits.

- [ ] **Step 4: Merge to main**

Run:

```powershell
git switch main
git pull --ff-only origin main
git merge --no-ff codex/stabilization-sprint -m "Merge: stabilization sprint"
```

Expected: merge succeeds without conflicts.

- [ ] **Step 5: Verify after merge**

Run:

```powershell
Push-Location backend
npm run migrate
npm test
Pop-Location
Push-Location frontend
npm run lint
npm test
npm run build
Pop-Location
```

Expected: all commands pass.

- [ ] **Step 6: Push main**

Run:

```powershell
git push origin main
```

Expected:

```text
main -> main
```

---

## Self-Review

- Spec coverage: quality gate cleanup is covered by Task 2; repo hygiene is covered by Task 3; frontend boundary split is covered by Tasks 4 and 5; backend boundary split is covered by Task 6; full verification and push are covered by Task 7.
- Scope control: this plan intentionally extracts only low-risk helpers and one backend policy boundary. It does not attempt a full rewrite of `MapView.jsx`, `Playback.jsx`, `AreaManagement.jsx`, `cameraService.js`, or `hlsProxyRoutes.js`.
- Placeholder scan: no implementation step uses TBD/TODO or vague "handle edge cases" instructions.
- Type consistency: helper names are consistent across tests, implementation, and consuming files.
