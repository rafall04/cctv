# Audit Logging Rules

## CRITICAL: Security Audit Logger API

File `backend/services/securityAuditLogger.js` menyediakan fungsi logging untuk security events.

### Available Functions

#### logAdminAction() - Log admin actions
```javascript
import { logAdminAction } from '../services/securityAuditLogger.js';

// ✅ CORRECT - Use logAdminAction for admin actions
logAdminAction({
    action: 'camera_created',
    camera_id: result.lastInsertRowid,
    camera_name: cameraData.name,
    userId: request.user.id
}, request);

// ❌ WRONG - logAuditEvent does NOT exist
logAuditEvent('camera_created', { ... });
```

### Common Admin Actions

```javascript
// Camera management
logAdminAction({ action: 'camera_created', camera_id, camera_name, userId }, request);
logAdminAction({ action: 'camera_updated', camera_id, changes, userId }, request);
logAdminAction({ action: 'camera_deleted', camera_id, camera_name, userId }, request);

// User management
logAdminAction({ action: 'user_created', new_user_id, username, userId }, request);
logAdminAction({ action: 'user_updated', target_user_id, changes, userId }, request);
logAdminAction({ action: 'user_deleted', deleted_user_id, username, userId }, request);

// Sponsor management
logAdminAction({ action: 'sponsor_created', sponsor_id, sponsor_name, userId }, request);
logAdminAction({ action: 'sponsor_updated', sponsor_id, changes, userId }, request);
logAdminAction({ action: 'sponsor_deleted', sponsor_id, sponsor_name, userId }, request);
logAdminAction({ action: 'sponsor_assigned', camera_id, sponsor_name, userId }, request);
logAdminAction({ action: 'sponsor_removed', camera_id, userId }, request);
```

### Other Security Logging Functions

```javascript
// Authentication
import { logAuthAttempt } from '../services/securityAuditLogger.js';
logAuthAttempt(success, { username, reason }, request);

// Rate limiting
import { logRateLimitViolation } from '../services/securityAuditLogger.js';
logRateLimitViolation({ ip, endpoint }, request);

// API key
import { logApiKeyFailure, logApiKeyCreated, logApiKeyRevoked } from '../services/securityAuditLogger.js';
logApiKeyFailure({ reason, key }, request);
logApiKeyCreated({ clientName, keyId }, request);
logApiKeyRevoked({ keyId, reason }, request);

// CSRF
import { logCsrfFailure } from '../services/securityAuditLogger.js';
logCsrfFailure({ reason }, request);

// Account lockout
import { logAccountLockout } from '../services/securityAuditLogger.js';
logAccountLockout({ username, attempts, lockoutUntil }, request);

// Session management
import { logSessionCreated, logSessionRefreshed, logSessionInvalidated } from '../services/securityAuditLogger.js';
logSessionCreated({ userId, sessionId }, request);
logSessionRefreshed({ userId, sessionId }, request);
logSessionInvalidated({ userId, reason }, request);

// Password
import { logPasswordChanged, logPasswordValidationFailed } from '../services/securityAuditLogger.js';
logPasswordChanged({ userId, forced }, request);
logPasswordValidationFailed({ username, reason }, request);
```

### Function Signature Pattern

All logging functions follow this pattern:
```javascript
function logXxx(details, request = null) {
    // details: Object with event-specific data
    // request: Fastify request object (optional, for IP/fingerprint)
}
```

### Common Mistakes

#### ❌ WRONG: Using non-existent function
```javascript
import { logAuditEvent } from '../services/securityAuditLogger.js';
logAuditEvent('action_name', { ... });
```

#### ✅ CORRECT: Using logAdminAction
```javascript
import { logAdminAction } from '../services/securityAuditLogger.js';
logAdminAction({ action: 'action_name', ...details, userId }, request);
```

#### ❌ WRONG: Wrong parameter format
```javascript
logAdminAction('camera_created', { camera_id: 1 }, request);
```

#### ✅ CORRECT: Details object with action property
```javascript
logAdminAction({ action: 'camera_created', camera_id: 1, userId: 1 }, request);
```

### Verification Checklist

Before using audit logging:
- [ ] Import correct function from `securityAuditLogger.js`
- [ ] Use `logAdminAction` for admin actions (not `logAuditEvent`)
- [ ] Pass details as object with `action` property
- [ ] Include `userId` in details object
- [ ] Pass `request` object as second parameter
- [ ] Use descriptive action names (e.g., 'camera_created', 'user_updated')

### Quick Reference

| Use Case | Function | Details Required |
|----------|----------|------------------|
| Admin action | `logAdminAction` | `{ action, userId, ...details }` |
| Auth attempt | `logAuthAttempt` | `success, { username, reason }` |
| Rate limit | `logRateLimitViolation` | `{ ip, endpoint }` |
| API key fail | `logApiKeyFailure` | `{ reason, key }` |
| CSRF fail | `logCsrfFailure` | `{ reason }` |
| Account lock | `logAccountLockout` | `{ username, attempts }` |
| Password change | `logPasswordChanged` | `{ userId, forced }` |
