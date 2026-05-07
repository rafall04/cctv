# ASN/ISP Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local ASN/ISP lookup, persist it in live/playback/admin logs, and enforce configurable ASN-based access policy for CCTV viewing.

**Architecture:** Resolve the client IP once at session start, look up ASN data from a local GeoLite2 ASN database, and cache the result in a small backend service. Store the resolved network identity with live and playback viewer sessions, then evaluate camera/area/global policy before starting access. Admin pages read the persisted data and expose policy controls without touching the runtime lookup path.

**Tech Stack:** Node.js 20, Fastify 4, better-sqlite3, React 18, Vite, Vitest, SQLite, MaxMind GeoLite2 ASN.

---

## File Structure

- Create: `backend/services/networkIdentityService.js` - local ASN/IP lookup, cache, database refresh coordination, and normalized identity shape.
- Create: `backend/services/networkAccessPolicyService.js` - resolves effective ASN policy for global, area, and camera scope and decides allow/deny/observe.
- Modify: `backend/services/viewerSessionService.js` - resolve network identity once at live session start and persist ASN fields in live session/history rows.
- Modify: `backend/services/playbackViewerSessionService.js` - resolve network identity once at playback session start and persist ASN fields in playback session/history rows.
- Modify: `backend/services/securityAuditLogger.js` - add ASN/ISP fields to generic security/admin audit entries.
- Modify: `backend/routes/hlsProxyRoutes.js` - use the trusted-viewer identity path consistently before live session start.
- Modify: `backend/routes/playbackViewerRoutes.js` and `backend/controllers/playbackViewerController.js` - enforce playback ASN policy at session start.
- Modify: `backend/routes/viewerRoutes.js` and `backend/controllers/viewerController.js` - expose live viewer history/stats with `ip_address`, `asn_number`, and `asn_org` fields in admin-facing DTOs.
- Create: `backend/database/migrations/zz_20260507_add_network_identity_and_asn_policy.js` - add ASN columns and policy tables.
- Modify: `backend/__tests__/*.test.js` - cover lookup, policy, live playback enforcement, and audit logging.
- Modify: `frontend/src/pages/UnifiedSettings.jsx`
- Create: `frontend/src/components/admin/settings/NetworkAccessPolicyPanel.jsx`
- Create: `frontend/src/components/admin/settings/NetworkAccessPolicyPanel.test.jsx`
- Modify: `frontend/src/pages/ViewerAnalytics.jsx`
- Modify: `frontend/src/pages/PlaybackAnalytics.jsx`
- Modify: `frontend/src/pages/CameraManagement.jsx`
- Modify: `frontend/src/pages/AreaManagement.jsx`
- Modify: `frontend/src/services/adminService.js`
- Modify: `frontend/src/services/areaService.js`
- Modify: `frontend/src/services/cameraService.js`
- Modify: `frontend/src/services/viewerService.js`
- Modify: `frontend/src/pages/ViewerAnalytics.test.jsx`
- Modify: `frontend/src/pages/PlaybackAnalytics.test.jsx`

## Tasks

### Task 1: Add Local ASN Resolver

**Files:**
- Create: `backend/services/networkIdentityService.js`
- Modify: `backend/services/viewerSessionService.js`
- Modify: `backend/services/playbackViewerSessionService.js`
- Test: `backend/__tests__/networkIdentityService.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import networkIdentityService from '../services/networkIdentityService.js';

it('resolves an IP to ASN identity with cache metadata', () => {
    const identity = networkIdentityService.resolveIpIdentity('8.8.8.8');

    expect(identity).toMatchObject({
        ipAddress: '8.8.8.8',
        asnNumber: expect.any(Number),
        asnOrg: expect.any(String),
        lookupSource: 'geolite2_asn',
    });
});
```

- [ ] **Step 2: Run the failing test**

Run: `cd backend && npm test -- networkIdentityService.test.js`

Expected: FAIL because the resolver module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```javascript
export class NetworkIdentityService {
    resolveIpIdentity(ipAddress) {
        return {
            ipAddress,
            asnNumber: null,
            asnOrg: 'unknown',
            lookupSource: 'geolite2_asn',
            lookupVersion: 'unavailable',
        };
    }
}

export default new NetworkIdentityService();
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd backend && npm test -- networkIdentityService.test.js`

Expected: PASS after the local lookup/cache layer is wired to the GeoLite reader.

### Task 2: Enforce ASN Policy in Live and Playback Sessions

**Files:**
- Create: `backend/services/networkAccessPolicyService.js`
- Modify: `backend/services/viewerSessionService.js`
- Modify: `backend/services/playbackViewerSessionService.js`
- Modify: `backend/controllers/viewerController.js`
- Modify: `backend/controllers/playbackViewerController.js`
- Test: `backend/__tests__/viewerSessionService.test.js`
- Test: `backend/__tests__/playbackViewerSessionService.test.js`

- [ ] **Step 1: Write the failing tests**

Add tests that start a session with a mocked identity service and assert:

```javascript
expect(viewerSessionService.startSession(cameraId, request)).toThrow('ASN policy denied');
expect(playbackViewerSessionService.startSession(payload, request)).toThrow('ASN policy denied');
```

and a permitted case:

```javascript
expect(result).toMatchObject({
    sessionId: expect.any(String),
    asnNumber: 12345,
    asnOrg: 'Example ISP',
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd backend && npm test -- viewerSessionService.test.js playbackViewerSessionService.test.js
```

Expected: FAIL because no policy enforcement exists yet.

- [ ] **Step 3: Implement policy evaluation**

```javascript
export function evaluateAsnPolicy(identity, policy) {
    if (policy.mode === 'observe_only') {
        return { allowed: true, reason: 'observe_only' };
    }

    const asn = identity.asnNumber;
    const rules = new Set(policy.asnRules);

    if (policy.mode === 'allowlist') {
        return rules.has(asn)
            ? { allowed: true, reason: 'allowlisted' }
            : { allowed: false, reason: 'asn_not_allowed' };
    }

    if (policy.mode === 'denylist') {
        return rules.has(asn)
            ? { allowed: false, reason: 'asn_blocked' }
            : { allowed: true, reason: 'not_blocked' };
    }

    return { allowed: true, reason: 'default' };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```bash
cd backend && npm test -- viewerSessionService.test.js playbackViewerSessionService.test.js
```

Expected: PASS with enforced allow/deny behavior at session start.

### Task 3: Persist ASN Fields in Logs and History

**Files:**
- Create: `backend/database/migrations/zz_20260507_add_network_identity_and_asn_policy.js`
- Modify: `backend/services/securityAuditLogger.js`
- Modify: `backend/services/viewerSessionService.js`
- Modify: `backend/services/playbackViewerSessionService.js`
- Test: `backend/__tests__/securityAuditLogger.test.js`
- Test: `backend/__tests__/viewerSessionHistory.test.js`

- [ ] **Step 1: Write the failing tests**

Assert that new history rows include `asn_number`, `asn_org`, and `lookup_source`:

```javascript
expect(historyRow).toMatchObject({
    ip_address: '203.0.113.10',
    asn_number: 64512,
    asn_org: 'Example Telecom',
    lookup_source: 'geolite2_asn',
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd backend && npm test -- securityAuditLogger.test.js viewerSessionHistory.test.js
```

Expected: FAIL because schema and inserts do not include ASN fields yet.

- [ ] **Step 3: Add the schema and insert fields**

```sql
ALTER TABLE viewer_sessions ADD COLUMN asn_number INTEGER;
ALTER TABLE viewer_sessions ADD COLUMN asn_org TEXT;
ALTER TABLE viewer_sessions ADD COLUMN lookup_source TEXT;
ALTER TABLE viewer_session_history ADD COLUMN asn_number INTEGER;
ALTER TABLE viewer_session_history ADD COLUMN asn_org TEXT;
ALTER TABLE viewer_session_history ADD COLUMN lookup_source TEXT;
ALTER TABLE playback_viewer_sessions ADD COLUMN asn_number INTEGER;
ALTER TABLE playback_viewer_sessions ADD COLUMN asn_org TEXT;
ALTER TABLE playback_viewer_sessions ADD COLUMN lookup_source TEXT;
ALTER TABLE playback_viewer_session_history ADD COLUMN asn_number INTEGER;
ALTER TABLE playback_viewer_session_history ADD COLUMN asn_org TEXT;
ALTER TABLE playback_viewer_session_history ADD COLUMN lookup_source TEXT;
ALTER TABLE viewer_session_history_archive ADD COLUMN asn_number INTEGER;
ALTER TABLE viewer_session_history_archive ADD COLUMN asn_org TEXT;
ALTER TABLE viewer_session_history_archive ADD COLUMN lookup_source TEXT;
ALTER TABLE playback_viewer_session_history_archive ADD COLUMN asn_number INTEGER;
ALTER TABLE playback_viewer_session_history_archive ADD COLUMN asn_org TEXT;
ALTER TABLE playback_viewer_session_history_archive ADD COLUMN lookup_source TEXT;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```bash
cd backend && npm run migrate && npm test -- securityAuditLogger.test.js viewerSessionHistory.test.js
```

Expected: PASS with ASN data present in admin-visible rows.

### Task 4: Add Admin Policy UI and History Columns

**Files:**
- Create: `frontend/src/components/admin/settings/NetworkAccessPolicyPanel.jsx`
- Create: `frontend/src/components/admin/settings/NetworkAccessPolicyPanel.test.jsx`
- Modify: `frontend/src/components/admin/settings/GeneralSettingsTab.jsx`
- Modify: `frontend/src/pages/UnifiedSettings.jsx`
- Modify: `frontend/src/pages/CameraManagement.jsx`
- Modify: `frontend/src/pages/AreaManagement.jsx`
- Modify: `frontend/src/pages/ViewerAnalytics.jsx`
- Modify: `frontend/src/pages/PlaybackAnalytics.jsx`
- Modify: `frontend/src/services/adminService.js`
- Modify: `frontend/src/services/areaService.js`
- Modify: `frontend/src/services/cameraService.js`
- Modify: `frontend/src/services/viewerService.js`
- Modify: `frontend/src/pages/ViewerAnalytics.test.jsx`
- Modify: `frontend/src/pages/PlaybackAnalytics.test.jsx`

- [ ] **Step 1: Write the failing UI test**

Add a test that renders policy controls and asserts the admin can switch:

```javascript
expect(screen.getByLabelText('ASN mode')).toHaveValue('allowlist');
expect(screen.getByLabelText('ASN allowlist')).toBeTruthy();
```

- [ ] **Step 2: Run the failing UI test**

Run: `cd frontend && npm test -- NetworkAccessPolicyPanel.test.jsx ViewerAnalytics.test.jsx PlaybackAnalytics.test.jsx`

Expected: FAIL because the ASN policy controls and columns are missing.

- [ ] **Step 3: Implement the settings and table fields**

Add the new controls and render ASN/ISP columns in the admin history tables:

```jsx
<select name="asn_policy_mode" />
<textarea name="asn_allowlist" />
<textarea name="asn_denylist" />
<th>ASN</th>
<th>ISP</th>
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```bash
cd frontend && npm test -- NetworkAccessPolicyPanel.test.jsx ViewerAnalytics.test.jsx PlaybackAnalytics.test.jsx && npm run build && npm run lint
```

Expected: PASS with the new policy surface and history columns.

### Task 5: Verification and Handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-05-07-asn-isp-access-control-design.md` if a clarification is needed
- Modify: `docs/superpowers/plans/2026-05-07-asn-isp-access-control.md`

- [ ] **Step 1: Run focused backend and frontend checks**

Run:

```bash
cd backend && npm run migrate && npm test -- networkIdentityService.test.js viewerSessionService.test.js playbackViewerSessionService.test.js securityAuditLogger.test.js
cd frontend && npm test -- NetworkAccessPolicyPanel.test.jsx ViewerAnalytics.test.jsx PlaybackAnalytics.test.jsx && npm run build && npm run lint
```

- [ ] **Step 2: Commit the plan**

Run:

```bash
git add docs/superpowers/specs/2026-05-07-asn-isp-access-control-design.md docs/superpowers/plans/2026-05-07-asn-isp-access-control.md
git commit -m "Docs: plan ASN ISP access control"
```

- [ ] **Step 3: Hand off execution choice**

Use subagent-driven development for the backend and frontend tracks if implementation starts in parallel.
