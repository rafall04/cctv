<!--
Purpose: Plan admin JWT middleware hardening without changing auth behavior in the token-session safety patch.
Caller: Maintainers or agents implementing the deferred auth hardening task.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, authMiddleware.js, sessionManager.js, authService.js.
MainFuncs: Defines TDD tasks for blacklist, invalidation, expiry, and fingerprint enforcement on protected admin requests.
SideEffects: None; documentation only.
-->

# Admin Auth Token Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce admin access-token blacklist, user invalidation, absolute session timeout, and fingerprint binding on every protected admin request without breaking public optional-auth behavior.

**Architecture:** Add one focused middleware helper that extracts and verifies admin JWTs from bearer header or `token` cookie, then applies existing `sessionManager.js` policy functions. Keep public `optionalAuthMiddleware` tolerant: invalid/expired auth stays anonymous, while protected `authMiddleware` returns clear `401` responses.

**Tech Stack:** Node.js 20+, Fastify JWT, Vitest, existing `sessionManager.js`, existing `authMiddleware.js`.

---

## File Structure

- Modify: `backend/middleware/authMiddleware.js`
  - Responsibility: route-level admin JWT extraction, verification, policy checks, and optional auth fallback.
- Modify: `backend/__tests__/authMiddleware.test.js`
  - Responsibility: focused middleware behavior tests for protected and optional auth paths.
- No schema changes.
- No frontend changes.

## Task 1: Add Middleware Coverage For Blacklisted Protected Tokens

**Files:**
- Create or modify: `backend/__tests__/authMiddleware.test.js`
- Modify later: `backend/middleware/authMiddleware.js`

- [ ] **Step 1: Write the failing test**

```javascript
/**
 * Purpose: Verify admin auth middleware enforces JWT blacklist and session policy.
 * Caller: Backend focused and full Vitest gates.
 * Deps: vitest, authMiddleware, mocked sessionManager.
 * MainFuncs: authMiddleware protected and optional auth tests.
 * SideEffects: Mocks request/reply only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/sessionManager.js', () => ({
    generateFingerprint: vi.fn(() => 'fingerprint-ok'),
    isSessionExpired: vi.fn(() => false),
    isTokenBlacklisted: vi.fn(() => false),
    isTokenInvalidatedByUser: vi.fn(() => false),
    validateFingerprint: vi.fn(() => true),
}));

import {
    generateFingerprint,
    isSessionExpired,
    isTokenBlacklisted,
    isTokenInvalidatedByUser,
    validateFingerprint,
} from '../services/sessionManager.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

function createReply() {
    return {
        statusCode: 200,
        payload: null,
        code: vi.fn(function setCode(statusCode) {
            this.statusCode = statusCode;
            return this;
        }),
        send: vi.fn(function send(payload) {
            this.payload = payload;
            return this;
        }),
    };
}

describe('authMiddleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects a protected bearer token that is already blacklisted', async () => {
        isTokenBlacklisted.mockReturnValueOnce(true);
        const request = {
            headers: { authorization: 'Bearer access.jwt' },
            cookies: {},
            server: {
                jwt: {
                    verify: vi.fn(() => ({
                        id: 7,
                        username: 'admin',
                        type: 'access',
                        fingerprint: 'fingerprint-ok',
                        sessionCreatedAt: Date.now(),
                    })),
                },
            },
        };
        const reply = createReply();

        await authMiddleware(request, reply);

        expect(request.server.jwt.verify).toHaveBeenCalledWith('access.jwt');
        expect(isTokenBlacklisted).toHaveBeenCalledWith('access.jwt');
        expect(reply.code).toHaveBeenCalledWith(401);
        expect(reply.payload).toEqual({
            success: false,
            message: 'Unauthorized - Session invalidated',
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- authMiddleware.test.js`

Expected: FAIL because `authMiddleware.js` does not import or call `isTokenBlacklisted`.

- [ ] **Step 3: Implement minimal middleware token extraction and blacklist check**

Replace `backend/middleware/authMiddleware.js` with:

```javascript
/**
 * Purpose: Enforce admin JWT authentication for protected routes and tolerant auth for public optional routes.
 * Caller: Backend route modules through onRequest/preHandler auth middleware.
 * Deps: Fastify JWT request/server helpers and sessionManager policy helpers.
 * MainFuncs: authMiddleware, optionalAuthMiddleware.
 * SideEffects: Sets request.user for valid tokens or sends 401 on protected auth failures.
 */

import {
    generateFingerprint,
    isSessionExpired,
    isTokenBlacklisted,
    isTokenInvalidatedByUser,
    validateFingerprint,
} from '../services/sessionManager.js';

function getBearerToken(request) {
    const authorization = request.headers?.authorization || '';
    return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
}

function getRequestToken(request) {
    return getBearerToken(request) || request.cookies?.token || '';
}

function reject(reply, message) {
    return reply.code(401).send({ success: false, message });
}

function verifyAdminToken(request, token) {
    if (!token) {
        const err = new Error('Unauthorized - No token provided');
        err.statusCode = 401;
        throw err;
    }

    if (isTokenBlacklisted(token)) {
        const err = new Error('Unauthorized - Session invalidated');
        err.statusCode = 401;
        throw err;
    }

    const decoded = request.server.jwt.verify(token);
    request.user = decoded;
    return decoded;
}

export async function authMiddleware(request, reply) {
    try {
        verifyAdminToken(request, getRequestToken(request));
    } catch (error) {
        return reject(reply, error.statusCode === 401 ? error.message : 'Unauthorized - Invalid or expired token');
    }
}

export async function optionalAuthMiddleware(request) {
    try {
        verifyAdminToken(request, getRequestToken(request));
    } catch {
        // Treat invalid public playback auth as anonymous instead of failing request.
    }
}

export default authMiddleware;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- authMiddleware.test.js`

Expected: PASS for the blacklist test.

- [ ] **Step 5: Commit**

```bash
git add backend/middleware/authMiddleware.js backend/__tests__/authMiddleware.test.js
git commit -m "Fix: enforce blacklisted admin access tokens"
```

## Task 2: Enforce User Token Invalidation And Absolute Session Timeout

**Files:**
- Modify: `backend/__tests__/authMiddleware.test.js`
- Modify: `backend/middleware/authMiddleware.js`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('authMiddleware', () => { ... })` block:

```javascript
    it('rejects a protected token invalidated by password change', async () => {
        isTokenInvalidatedByUser.mockReturnValueOnce(true);
        const request = {
            headers: {},
            cookies: { token: 'cookie.jwt' },
            server: {
                jwt: {
                    verify: vi.fn(() => ({
                        id: 7,
                        username: 'admin',
                        type: 'access',
                        fingerprint: 'fingerprint-ok',
                        sessionCreatedAt: Date.now(),
                    })),
                },
            },
        };
        const reply = createReply();

        await authMiddleware(request, reply);

        expect(isTokenInvalidatedByUser).toHaveBeenCalledWith(request.server.jwt.verify.mock.results[0].value, 7);
        expect(reply.code).toHaveBeenCalledWith(401);
        expect(reply.payload.message).toBe('Unauthorized - Session invalidated');
    });

    it('rejects a protected token past the absolute session timeout', async () => {
        isSessionExpired.mockReturnValueOnce(true);
        const request = {
            headers: { authorization: 'Bearer old.jwt' },
            cookies: {},
            server: {
                jwt: {
                    verify: vi.fn(() => ({
                        id: 7,
                        username: 'admin',
                        type: 'access',
                        fingerprint: 'fingerprint-ok',
                        sessionCreatedAt: Date.now() - 90_000_000,
                    })),
                },
            },
        };
        const reply = createReply();

        await authMiddleware(request, reply);

        expect(isSessionExpired).toHaveBeenCalledWith(request.server.jwt.verify.mock.results[0].value);
        expect(reply.code).toHaveBeenCalledWith(401);
        expect(reply.payload.message).toBe('Unauthorized - Session expired');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- authMiddleware.test.js`

Expected: FAIL because the middleware verifies the token but does not check invalidation or absolute timeout.

- [ ] **Step 3: Add policy checks after JWT verification**

Update `verifyAdminToken` in `backend/middleware/authMiddleware.js`:

```javascript
function verifyAdminToken(request, token) {
    if (!token) {
        const err = new Error('Unauthorized - No token provided');
        err.statusCode = 401;
        throw err;
    }

    if (isTokenBlacklisted(token)) {
        const err = new Error('Unauthorized - Session invalidated');
        err.statusCode = 401;
        throw err;
    }

    const decoded = request.server.jwt.verify(token);

    if (isTokenInvalidatedByUser(decoded, decoded.id)) {
        const err = new Error('Unauthorized - Session invalidated');
        err.statusCode = 401;
        throw err;
    }

    if (isSessionExpired(decoded)) {
        const err = new Error('Unauthorized - Session expired');
        err.statusCode = 401;
        throw err;
    }

    request.user = decoded;
    return decoded;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- authMiddleware.test.js`

Expected: PASS for blacklist, invalidation, and timeout cases.

- [ ] **Step 5: Commit**

```bash
git add backend/middleware/authMiddleware.js backend/__tests__/authMiddleware.test.js
git commit -m "Fix: enforce admin session invalidation policy"
```

## Task 3: Enforce Fingerprint Binding Without Breaking Optional Auth

**Files:**
- Modify: `backend/__tests__/authMiddleware.test.js`
- Modify: `backend/middleware/authMiddleware.js`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('authMiddleware', () => { ... })` block:

```javascript
    it('rejects a protected token when request fingerprint does not match', async () => {
        validateFingerprint.mockReturnValueOnce(false);
        const decoded = {
            id: 7,
            username: 'admin',
            type: 'access',
            fingerprint: 'fingerprint-old',
            sessionCreatedAt: Date.now(),
        };
        const request = {
            headers: { authorization: 'Bearer moved.jwt', 'user-agent': 'new-device' },
            cookies: {},
            ip: '203.0.113.10',
            server: { jwt: { verify: vi.fn(() => decoded) } },
        };
        const reply = createReply();

        await authMiddleware(request, reply);

        expect(generateFingerprint).toHaveBeenCalledWith(request);
        expect(validateFingerprint).toHaveBeenCalledWith(decoded, 'fingerprint-ok');
        expect(reply.code).toHaveBeenCalledWith(401);
        expect(reply.payload.message).toBe('Unauthorized - Session invalid');
    });
```

Add this second test to a new `describe('optionalAuthMiddleware', () => { ... })` block in the same file:

```javascript
import { optionalAuthMiddleware } from '../middleware/authMiddleware.js';

describe('optionalAuthMiddleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('treats an invalid optional token as anonymous instead of failing the request', async () => {
        isTokenBlacklisted.mockReturnValueOnce(true);
        const request = {
            headers: { authorization: 'Bearer blacklisted.jwt' },
            cookies: {},
            server: { jwt: { verify: vi.fn() } },
        };

        await optionalAuthMiddleware(request);

        expect(request.user).toBeUndefined();
        expect(request.server.jwt.verify).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- authMiddleware.test.js`

Expected: FAIL because fingerprint policy is not yet enforced.

- [ ] **Step 3: Add fingerprint validation**

Update `verifyAdminToken` in `backend/middleware/authMiddleware.js` by inserting this block after the timeout check and before `request.user = decoded`:

```javascript
    const currentFingerprint = generateFingerprint(request);
    if (!validateFingerprint(decoded, currentFingerprint)) {
        const err = new Error('Unauthorized - Session invalid');
        err.statusCode = 401;
        throw err;
    }
```

- [ ] **Step 4: Run focused auth middleware tests**

Run: `cd backend && npm test -- authMiddleware.test.js`

Expected: PASS for protected and optional auth cases.

- [ ] **Step 5: Commit**

```bash
git add backend/middleware/authMiddleware.js backend/__tests__/authMiddleware.test.js
git commit -m "Fix: enforce admin token fingerprint policy"
```

## Task 4: Regression Gate

**Files:**
- No source changes expected.

- [ ] **Step 1: Run backend migration gate**

Run: `cd backend && npm run migrate`

Expected: exit 0 and `All migrations completed successfully`.

- [ ] **Step 2: Run backend full test gate**

Run: `cd backend && npm test`

Expected: exit 0 with all backend test files passing.

- [ ] **Step 3: Check git status**

Run: `git status --short`

Expected: only intended auth middleware/test files are modified before commit, or clean after commit.

- [ ] **Step 4: Push**

```bash
git push
```

Expected: push exits 0 on the active branch.

## Self-Review

- Spec coverage: plan covers blacklist, password-change invalidation, absolute timeout, fingerprint binding, and optional auth tolerance.
- Placeholder scan: no placeholder markers.
- Type consistency: test names, imports, helper names, and middleware function names match existing backend module names.
- Scope check: no schema, frontend, playback-token, or cookie-policy changes are included.
