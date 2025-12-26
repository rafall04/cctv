# Implementation Plan: API Security Hardening

## Overview

Implementasi keamanan API backend RAF NET CCTV Hub dengan pendekatan berlapis: rate limiting, API key validation, CSRF protection, brute force protection, enhanced session management, password policies, dan security headers.

## Tasks

- [x] 1. Setup database schema dan dependencies
  - [x] 1.1 Create security database migration script
    - Add security_logs table with indexes
    - Add api_keys table
    - Add token_blacklist table
    - Add password_history table
    - Add login_attempts table
    - Extend users table with security columns
    - _Requirements: 5.7, 6.7_

  - [x] 1.2 Install required npm dependencies
    - Install @fastify/rate-limit for rate limiting
    - Install @fastify/helmet for security headers
    - Install fast-check for property-based testing (devDependency)
    - _Requirements: 2.1, 8.1_

- [x] 2. Implement Security Headers Middleware
  - [x] 2.1 Create security headers middleware
    - Implement X-Content-Type-Options: nosniff
    - Implement X-Frame-Options: DENY
    - Implement X-XSS-Protection: 1; mode=block
    - Implement Content-Security-Policy
    - Remove X-Powered-By and Server headers
    - Add Cache-Control: no-store for auth endpoints
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7_

  - [x] 2.2 Write property test for security headers
    - **Property 10: Security Headers Presence**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6**


- [x] 3. Implement Rate Limiter
  - [x] 3.1 Create rate limiter middleware with sliding window
    - Implement sliding window algorithm
    - Configure 100 req/min for public endpoints
    - Configure 30 req/min for auth endpoints
    - Whitelist /health and /api/stream/* endpoints
    - Return 429 with Retry-After header when exceeded
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8_

  - [x] 3.2 Implement rate limit violation logging
    - Log IP address, endpoint, and timestamp
    - Integrate with security audit logger
    - _Requirements: 2.7_

  - [x] 3.3 Write property test for rate limiter
    - **Property 3: Rate Limit Enforcement by Endpoint Type**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 4. Implement API Key Validation
  - [x] 4.1 Create API key generator and validator
    - Generate 64-character hex API keys
    - Implement timing-safe comparison
    - Store key hash in database
    - _Requirements: 1.1_

  - [x] 4.2 Create API key validation middleware
    - Validate X-API-Key header
    - Reject requests with missing/invalid keys (403)
    - Log validation failures
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 4.3 Create API key management endpoints (admin only)
    - POST /api/admin/api-keys - Generate new key
    - GET /api/admin/api-keys - List active keys
    - DELETE /api/admin/api-keys/:id - Revoke key
    - _Requirements: 1.1_

  - [x] 4.4 Write property test for API key validation
    - **Property 1: API Key Validation Consistency**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 5. Implement CSRF Protection
  - [x] 5.1 Create CSRF token generator and validator
    - Generate 32-byte random tokens
    - Set httpOnly cookie with token
    - Validate header token against cookie
    - _Requirements: 1.6_

  - [x] 5.2 Create CSRF middleware for state-changing requests
    - Apply to POST, PUT, DELETE requests
    - Skip for API key-only endpoints
    - Return 403 for invalid/missing tokens
    - Log CSRF failures
    - _Requirements: 1.6, 1.7_

  - [x] 5.3 Add CSRF token endpoint
    - GET /api/auth/csrf - Return new CSRF token
    - Set cookie and return token in response
    - _Requirements: 1.6_

  - [x] 5.4 Write property test for CSRF validation
    - **Property 2: CSRF Token Validation for State-Changing Requests**
    - **Validates: Requirements 1.6, 1.7**


- [x] 6. Implement Brute Force Protection
  - [x] 6.1 Create login attempt tracker
    - Track failed attempts per username
    - Track failed attempts per IP address
    - Store in login_attempts table
    - Implement 15-minute tracking window
    - _Requirements: 3.1, 3.2_

  - [x] 6.2 Implement account lockout mechanism
    - Lock account after 5 failed attempts (30 min)
    - Block IP after 10 failed attempts (1 hour)
    - Return generic "Invalid credentials" message
    - _Requirements: 3.3, 3.4, 3.5_

  - [x] 6.3 Implement progressive delay
    - Add delay before login response (1s, 2s, 4s, 8s)
    - Reset counter on successful login
    - _Requirements: 3.6, 3.7_

  - [x] 6.4 Integrate brute force protection with auth controller
    - Check lockout before password verification
    - Track attempts on failure
    - Reset on success
    - Log lockout events
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 6.5 Write property test for brute force protection
    - **Property 4: Brute Force Lockout Threshold**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [x] 6.6 Write property test for progressive delay
    - **Property 5: Progressive Delay Enforcement**
    - **Validates: Requirements 3.6**

- [x] 7. Checkpoint - Core Security Middleware
  - Ensure all tests pass
  - Verify rate limiting works correctly
  - Verify API key validation works
  - Verify CSRF protection works
  - Verify brute force protection works
  - Ask the user if questions arise

- [x] 8. Implement Enhanced Session Management
  - [x] 8.1 Create session manager service
    - Generate client fingerprint (IP + User-Agent hash)
    - Create access token (1 hour expiry)
    - Create refresh token (7 days expiry)
    - Bind tokens to fingerprint
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 8.2 Implement token blacklist
    - Add token to blacklist on logout
    - Check blacklist on token validation
    - Cleanup expired blacklist entries
    - _Requirements: 4.6, 4.7_

  - [x] 8.3 Implement token rotation on refresh
    - Issue new token pair on refresh
    - Blacklist old tokens
    - Validate fingerprint on refresh
    - _Requirements: 4.5_

  - [x] 8.4 Implement fingerprint validation middleware
    - Compare request fingerprint with token fingerprint
    - Invalidate token on mismatch
    - Require re-authentication
    - _Requirements: 4.4_

  - [x] 8.5 Implement absolute session timeout
    - Track session creation time
    - Force logout after 24 hours
    - _Requirements: 4.8_

  - [x] 8.6 Update auth routes with new session management
    - Update login to use session manager
    - Add refresh token endpoint
    - Update logout to blacklist tokens
    - _Requirements: 4.1, 4.2, 4.5, 4.7_

  - [x] 8.7 Write property test for token fingerprint binding
    - **Property 6: Token Fingerprint Binding**
    - **Validates: Requirements 4.3, 4.4**

  - [x] 8.8 Write property test for token lifecycle
    - **Property 7: Token Lifecycle Management**
    - **Validates: Requirements 4.5, 4.6, 4.7**


- [x] 9. Implement Password Security
  - [x] 9.1 Create password validator service
    - Validate minimum 12 characters
    - Require uppercase, lowercase, numbers, special chars
    - Check against common password list (top 10000)
    - Check password doesn't contain username
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 9.2 Implement password history
    - Store last 5 password hashes
    - Prevent reuse of previous passwords
    - _Requirements: 6.7_

  - [x] 9.3 Implement password expiry
    - Track password_changed_at timestamp
    - Enforce 90-day password change
    - Return warning when password near expiry
    - _Requirements: 6.6_

  - [x] 9.4 Implement session invalidation on password change
    - Blacklist all user tokens on password change
    - Force re-login after password change
    - _Requirements: 6.5_

  - [x] 9.5 Update user management with password policies
    - Apply validation on user creation
    - Apply validation on password change
    - Return clear error messages
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 9.6 Write property test for password validation
    - **Property 9: Password Complexity Validation**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

- [x] 10. Implement Security Audit Logger
  - [x] 10.1 Create security audit logger service
    - Log authentication attempts (success/failure)
    - Log rate limit violations
    - Log API key validation failures
    - Log CSRF token failures
    - Log account lockout events
    - Log admin actions
    - Include fingerprint in all entries
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_

  - [x] 10.2 Implement log retention cleanup
    - Delete logs older than 90 days
    - Run cleanup on schedule (daily)
    - _Requirements: 5.7_

  - [x] 10.3 Integrate audit logger with all security components
    - Add logging to rate limiter
    - Add logging to API key validator
    - Add logging to CSRF validator
    - Add logging to brute force protection
    - Add logging to session manager
    - Add logging to auth controller
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 10.4 Write property test for security event logging
    - **Property 8: Security Event Logging Completeness**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8**

- [ ] 11. Checkpoint - Session and Password Security
  - Ensure all tests pass
  - Verify session management works correctly
  - Verify password policies are enforced
  - Verify audit logging captures all events
  - Ask the user if questions arise


- [ ] 12. Implement Input Validation and Sanitization
  - [ ] 12.1 Create input sanitizer middleware
    - Sanitize string inputs (XSS prevention)
    - Validate Content-Type header
    - Limit request body size to 1MB
    - Strip unknown fields from request bodies
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7_

  - [ ] 12.2 Create JSON schema validators for all endpoints
    - Define schemas for camera CRUD
    - Define schemas for user management
    - Define schemas for authentication
    - Return 400 for invalid input
    - _Requirements: 7.1, 7.4_

  - [ ] 12.3 Implement URL parameter sanitization
    - Validate and sanitize route parameters
    - Validate and sanitize query parameters
    - _Requirements: 7.3_

- [ ] 13. Implement Origin Validation
  - [ ] 13.1 Create origin validation middleware
    - Validate Origin header against allowed domains
    - Validate Referer header as fallback
    - Allow requests without Origin for non-browser clients
    - _Requirements: 1.4, 1.5_

  - [ ] 13.2 Update CORS configuration
    - Restrict to specific allowed origins
    - Log rejected origins
    - _Requirements: 1.4_

- [ ] 14. Frontend Integration
  - [ ] 14.1 Update API client with security headers
    - Add X-API-Key header to all requests
    - Add X-CSRF-Token header to state-changing requests
    - Handle 401/403 responses appropriately
    - _Requirements: 1.1, 1.6_

  - [ ] 14.2 Implement CSRF token management in frontend
    - Fetch CSRF token on app load
    - Store token and include in requests
    - Refresh token when expired
    - _Requirements: 1.6_

  - [ ] 14.3 Update login flow for enhanced security
    - Handle progressive delay feedback
    - Handle account lockout messages
    - Implement refresh token flow
    - _Requirements: 3.6, 4.2, 4.5_

  - [ ] 14.4 Add environment variables for API key
    - Add VITE_API_KEY to frontend .env
    - Update .env.example with placeholder
    - _Requirements: 1.1_

- [ ] 15. Wire Everything Together
  - [ ] 15.1 Register all middleware in correct order
    - Security headers (first)
    - Rate limiter
    - API key validator
    - Origin validator
    - CSRF validator
    - Input sanitizer
    - Auth middleware (for protected routes)
    - _Requirements: All_

  - [ ] 15.2 Update server.js with security configuration
    - Import and register all security middleware
    - Configure middleware order
    - Add security-related environment variables
    - _Requirements: All_

  - [ ] 15.3 Update environment configuration
    - Add security-related config options
    - Document all new environment variables
    - Update .env.example files
    - _Requirements: All_

- [ ] 16. Final Checkpoint - Complete Security Implementation
  - Ensure all tests pass
  - Verify complete security flow works end-to-end
  - Test from frontend to backend
  - Verify all security headers present
  - Verify rate limiting works
  - Verify brute force protection works
  - Verify session management works
  - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive security implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Security middleware order is critical - headers first, then rate limit, then auth
