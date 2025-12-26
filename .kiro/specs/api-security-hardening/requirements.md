# Requirements Document

## Introduction

Dokumen ini mendefinisikan requirements untuk mengamankan API backend RAF NET CCTV Hub agar hanya dapat diakses oleh frontend yang sah, serta memperkuat keamanan login admin untuk fasilitas publik. Sistem ini memerlukan perlindungan ekstra karena digunakan di lingkungan publik yang rentan terhadap akses tidak sah dan serangan brute force.

## Glossary

- **API_Gateway**: Komponen backend yang menerima dan memvalidasi semua request HTTP
- **Rate_Limiter**: Mekanisme pembatasan jumlah request per waktu untuk mencegah abuse
- **CSRF_Token**: Token unik per session untuk mencegah Cross-Site Request Forgery
- **API_Key**: Secret key yang di-embed di frontend untuk validasi request origin
- **Brute_Force_Protection**: Mekanisme untuk mendeteksi dan memblokir percobaan login berulang
- **Account_Lockout**: Fitur penguncian akun setelah percobaan login gagal berulang
- **Session_Manager**: Komponen yang mengelola session pengguna termasuk timeout dan invalidation
- **Audit_Logger**: Sistem pencatatan aktivitas keamanan untuk forensik dan monitoring
- **IP_Whitelist**: Daftar IP address yang diizinkan mengakses API tertentu
- **Request_Fingerprint**: Kombinasi header dan metadata untuk mengidentifikasi request yang sah

## Requirements

### Requirement 1: API Origin Validation

**User Story:** As a system administrator, I want to ensure API requests only come from legitimate frontend applications, so that unauthorized third-party applications cannot access the backend.

#### Acceptance Criteria

1. WHEN a request arrives at the API_Gateway, THE API_Gateway SHALL validate the request contains a valid API_Key header
2. WHEN a request lacks a valid API_Key, THE API_Gateway SHALL reject the request with 403 Forbidden status
3. WHEN a request contains an invalid or expired API_Key, THE API_Gateway SHALL reject the request and log the attempt
4. THE API_Gateway SHALL validate the Origin and Referer headers match allowed domains
5. WHEN Origin header is missing or invalid for browser requests, THE API_Gateway SHALL reject the request
6. THE API_Gateway SHALL implement CSRF_Token validation for all state-changing requests (POST, PUT, DELETE)
7. WHEN a CSRF_Token is missing or invalid, THE API_Gateway SHALL reject the request with 403 status

### Requirement 2: Rate Limiting Protection

**User Story:** As a system administrator, I want to limit the rate of API requests, so that the system is protected from denial-of-service attacks and abuse.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL limit requests to 100 requests per minute per IP address for public API endpoints
2. THE Rate_Limiter SHALL limit requests to 30 requests per minute per IP address for authentication endpoints
3. THE Rate_Limiter SHALL NOT apply rate limiting to stream URL endpoints (/api/stream/*) to ensure uninterrupted CCTV viewing
4. WHEN a client exceeds the rate limit, THE Rate_Limiter SHALL return 429 Too Many Requests status
5. WHEN a client exceeds the rate limit, THE Rate_Limiter SHALL include Retry-After header in the response
6. THE Rate_Limiter SHALL use sliding window algorithm for accurate rate calculation
7. THE Rate_Limiter SHALL log all rate limit violations with IP address and endpoint details
8. THE Rate_Limiter SHALL whitelist health check endpoint (/health) from rate limiting

**Note:** Video streaming traffic flows directly through MediaMTX (ports 8888/8889) and is NOT affected by API rate limiting. Rate limiting only applies to metadata API calls which are infrequent during normal CCTV viewing.

### Requirement 3: Brute Force Login Protection

**User Story:** As a system administrator, I want to protect admin login from brute force attacks, so that attackers cannot guess passwords through repeated attempts.

#### Acceptance Criteria

1. THE Brute_Force_Protection SHALL track failed login attempts per username
2. THE Brute_Force_Protection SHALL track failed login attempts per IP address
3. WHEN 5 failed login attempts occur for a username within 15 minutes, THE Account_Lockout SHALL lock the account for 30 minutes
4. WHEN 10 failed login attempts occur from an IP address within 15 minutes, THE Rate_Limiter SHALL block that IP for 1 hour
5. WHEN an account is locked, THE API_Gateway SHALL return a generic "Invalid credentials" message without revealing lockout status
6. THE Brute_Force_Protection SHALL implement progressive delay between login attempts (1s, 2s, 4s, 8s)
7. WHEN a successful login occurs, THE Brute_Force_Protection SHALL reset the failed attempt counter for that username

### Requirement 4: Enhanced Session Security

**User Story:** As a system administrator, I want secure session management, so that stolen tokens cannot be easily exploited.

#### Acceptance Criteria

1. THE Session_Manager SHALL generate JWT tokens with short expiration time (1 hour for access token)
2. THE Session_Manager SHALL implement refresh token mechanism with 7-day expiration
3. THE Session_Manager SHALL bind tokens to client fingerprint (IP + User-Agent hash)
4. WHEN a token is used from a different fingerprint, THE Session_Manager SHALL invalidate the token and require re-authentication
5. THE Session_Manager SHALL implement token rotation on each refresh
6. THE Session_Manager SHALL maintain a token blacklist for invalidated tokens
7. WHEN logout occurs, THE Session_Manager SHALL add the token to blacklist immediately
8. THE Session_Manager SHALL implement absolute session timeout of 24 hours regardless of activity

### Requirement 5: Security Audit Logging

**User Story:** As a system administrator, I want comprehensive security logging, so that I can detect and investigate security incidents.

#### Acceptance Criteria

1. THE Audit_Logger SHALL log all authentication attempts (success and failure) with timestamp, IP, and username
2. THE Audit_Logger SHALL log all rate limit violations with full request details
3. THE Audit_Logger SHALL log all API key validation failures
4. THE Audit_Logger SHALL log all CSRF token validation failures
5. THE Audit_Logger SHALL log all account lockout events
6. THE Audit_Logger SHALL log all admin actions (camera CRUD, user management)
7. THE Audit_Logger SHALL store logs in a separate security_logs table with retention of 90 days
8. THE Audit_Logger SHALL include request fingerprint in all log entries

### Requirement 6: Password Security Enhancement

**User Story:** As a system administrator, I want strong password policies, so that admin accounts are protected with secure credentials.

#### Acceptance Criteria

1. THE API_Gateway SHALL enforce minimum password length of 12 characters
2. THE API_Gateway SHALL require passwords to contain uppercase, lowercase, numbers, and special characters
3. THE API_Gateway SHALL reject passwords that match common password lists (top 10000)
4. THE API_Gateway SHALL reject passwords that contain the username
5. WHEN a password is changed, THE Session_Manager SHALL invalidate all existing sessions for that user
6. THE API_Gateway SHALL enforce password change every 90 days for admin accounts
7. THE API_Gateway SHALL prevent reuse of last 5 passwords

### Requirement 7: Request Validation and Sanitization

**User Story:** As a system administrator, I want all input to be validated and sanitized, so that injection attacks are prevented.

#### Acceptance Criteria

1. THE API_Gateway SHALL validate all request body parameters against defined schemas
2. THE API_Gateway SHALL sanitize all string inputs to prevent XSS attacks
3. THE API_Gateway SHALL validate and sanitize all URL parameters
4. WHEN invalid input is detected, THE API_Gateway SHALL reject the request with 400 Bad Request
5. THE API_Gateway SHALL limit request body size to 1MB for standard endpoints
6. THE API_Gateway SHALL validate Content-Type header matches expected format
7. THE API_Gateway SHALL strip unknown fields from request bodies

### Requirement 8: Secure Headers Configuration

**User Story:** As a system administrator, I want proper security headers on all responses, so that common web vulnerabilities are mitigated.

#### Acceptance Criteria

1. THE API_Gateway SHALL include X-Content-Type-Options: nosniff header on all responses
2. THE API_Gateway SHALL include X-Frame-Options: DENY header on all responses
3. THE API_Gateway SHALL include X-XSS-Protection: 1; mode=block header on all responses
4. THE API_Gateway SHALL include Strict-Transport-Security header in production
5. THE API_Gateway SHALL include Content-Security-Policy header restricting resource origins
6. THE API_Gateway SHALL remove X-Powered-By and Server headers from responses
7. THE API_Gateway SHALL include Cache-Control: no-store for authenticated endpoints
