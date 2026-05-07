<!--
Purpose: Define ASN/ISP enrichment and access-control design for live, playback, and admin audit flows.
Caller: Product/engineering planning before implementation planning and code changes.
Deps: SYSTEM_MAP.md, backend/frontend module maps, viewer session services, security audit logging, playback/live access flows.
MainFuncs: Specifies data source, enrichment timing, policy model, admin customization, and logging surface for ASN/ISP-based access control.
SideEffects: Documentation only.
-->

# ASN/ISP Access Control Design

## Goal

Add ASN and ISP organization visibility to viewer and admin logs, and use that network identity as a configurable access-control signal for live CCTV and playback.

The system must support:

1. Displaying ASN/ISP details in admin-facing logs and viewer history.
2. Enforcing allow/deny rules by ASN for live and playback sessions.
3. Customizing policy clearly at global, area, and camera scope.
4. Keeping the source of truth local and stable enough to avoid per-request dependency on an external API.

## Success Criteria

- Live and playback sessions resolve a stable network identity from the request IP at session start.
- Admin logs and viewer history can show `ip_address`, ASN number, and ISP/organization name.
- Admins can configure ASN policy as `allow`, `deny`, or `observe_only`.
- Policy can be inherited and overridden at global, area, and camera level.
- Live access and playback access can be controlled independently.
- The feature continues to work when the internet is unavailable after the local ASN database is updated.

## Recommended Source

Use **MaxMind GeoLite2 ASN** as a local database.

Reasoning:

- The lookup is local, so session start does not depend on an external HTTP API.
- ASN data changes are handled by scheduled database refresh, not runtime calls.
- The dataset is sufficient for network-level policy because it exposes ASN number and organization name.

External hosted ASN APIs remain a fallback only for diagnostics or temporary bootstrap, not for the production access-control path.

## Architecture

The feature has three layers.

1. **Identity resolution**
   - Normalize the client IP once at session start.
   - Resolve ASN number and organization name from the local GeoLite2 ASN database.
   - Cache lookups in memory so repeated sessions from the same IP avoid duplicate file reads.

2. **Policy evaluation**
   - Evaluate the resolved ASN against policy rules before starting live or playback sessions.
   - Support `allowlist`, `denylist`, and `observe_only`.
   - Allow policy inheritance from global defaults to area overrides to camera overrides.

3. **Audit and display**
   - Persist ASN/ISP details into live viewer history, playback viewer history, and admin audit logs.
   - Show the same network identity in admin analytics and operational history views.

The system should not enrich heartbeat traffic. Heartbeats keep the active session alive; they should not trigger extra ASN lookups or policy reevaluation unless the IP identity changes in a way that forces a new session.

## Data Model

The design needs a small set of durable concepts.

### Network Identity

Store the resolved request identity as:

- `ip_address`
- `asn_number`
- `asn_org`
- `lookup_source`
- `lookup_version`

`lookup_source` records the resolver used, such as `geolite2_asn`. `lookup_version` records the database build date or version stamp so admins can audit which database produced the result.

### Access Policy

Policy should be configurable at three scopes:

1. Global default
2. Area override
3. Camera override

Each scope should support:

- `mode`: `allowlist`, `denylist`, `observe_only`
- `asn_rules`: list of ASN numbers
- optional label/notes for operator clarity
- effective enable/disable flag

The effective policy is resolved from camera first, then area, then global default.

### Audit Rows

Admin audit events that touch access policy should include:

- actor admin id/username
- target scope
- action type
- resolved effective policy
- request IP
- resolved ASN/ISP

## Flow

### Live Access

1. Client requests live stream.
2. Backend extracts trusted client IP.
3. Backend resolves ASN/ISP locally.
4. Backend evaluates live policy for the resolved ASN.
5. If allowed, session starts and the network identity is stored with the live viewer session.
6. If denied, the response indicates access denial without exposing the raw policy internals.

### Playback Access

1. Client requests playback session or playlist.
2. Backend extracts trusted client IP.
3. Backend resolves ASN/ISP locally.
4. Backend evaluates playback policy for the resolved ASN.
5. If allowed, session starts and the network identity is stored with the playback viewer session.
6. If denied, the playback shell remains intact but the stream/segment access is blocked.

### Admin Audit

1. Admin changes ASN policy or reviews history.
2. Backend logs the action with request identity and resolved ASN/ISP.
3. Admin UI displays the resolved ASN/ISP in audit and viewer tables.

## Customization Rules

- Global policy sets the default posture.
- Area policy applies to all cameras in the area unless the camera has its own override.
- Camera policy wins over area and global policy.
- Playback and live policy must be configurable independently.
- `observe_only` still logs and displays ASN/ISP but never blocks.

## Security And Safety

- Do not trust forwarded IP headers unless the request is behind a trusted proxy path already used elsewhere in the backend.
- Do not expose RTSP credentials or internal stream URLs while showing ASN/ISP.
- Do not require a live external API call to authorize access.
- Treat ASN/ISP as network metadata, not user identity.

## Update Strategy

The ASN database must refresh automatically on a schedule.

Requirements:

- The backend should load the newest local ASN database without a manual code deploy.
- The refresh job should swap in a new database atomically.
- If the refresh fails, the last known good database remains active.
- The system should log update success/failure for operator visibility.

## Error Handling

- If ASN lookup fails, the session should fall back to `unknown` identity and policy should use the configured fallback rule.
- If the local database is missing at startup, the system should disable ASN enforcement and continue in a safe default state rather than crash.
- If policy evaluation throws, live/playback should fail closed when enforcement is enabled and fail open only when the policy is explicitly `observe_only`.

## Out Of Scope

- Per-user ASN identity.
- Geo-fencing by city/country.
- VPN detection beyond ASN/network policy.
- Paid external geolocation APIs as the primary path.
- Real-time per-heartbeat ASN revalidation.

## Verification

- Live session start with allowed ASN stores ASN/ISP fields.
- Live session start with denied ASN blocks access.
- Playback session start with allowed ASN stores ASN/ISP fields.
- Playback session start with denied ASN blocks access.
- Admin policy update logs the resolved network identity.
- GeoLite refresh failure keeps the previous database active.
- `observe_only` records ASN/ISP without denial.

