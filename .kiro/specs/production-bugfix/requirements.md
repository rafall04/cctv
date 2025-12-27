# Requirements Document

## Introduction

Dokumen ini berisi requirements untuk memperbaiki semua bug dan error yang muncul di production setelah update security. Masalah utama termasuk CCTV stream yang reload terus-menerus, error connectivity, dan berbagai issue lainnya yang disebabkan oleh perubahan security.

## Glossary

- **Stream_Player**: Komponen video player yang menampilkan stream CCTV
- **Connection_Tester**: Modul yang menguji konektivitas ke MediaMTX server
- **HLS_Loader**: Modul yang memuat dan mengelola HLS.js untuk streaming
- **API_Client**: Modul axios untuk komunikasi dengan backend API
- **Security_Middleware**: Middleware backend untuk validasi API key, CSRF, rate limiting

## Requirements

### Requirement 1: Stream Player Stability

**User Story:** As a user, I want to view CCTV streams without constant reloading, so that I can monitor cameras effectively.

#### Acceptance Criteria

1. WHEN a user opens a camera stream THEN THE Stream_Player SHALL load the stream once and maintain stable playback
2. WHEN a stream encounters a recoverable error THEN THE Stream_Player SHALL attempt recovery without full reload
3. WHEN a stream fails after 3 retry attempts THEN THE Stream_Player SHALL display an error message and stop retrying
4. IF the stream URL is invalid THEN THE Stream_Player SHALL display a clear error message
5. WHEN the user closes the stream popup THEN THE Stream_Player SHALL properly cleanup all resources

### Requirement 2: Connection Testing Fix

**User Story:** As a system, I want to test server connectivity without causing errors, so that users see accurate server status.

#### Acceptance Criteria

1. WHEN testing server connectivity THEN THE Connection_Tester SHALL use a valid endpoint that returns 200 OK
2. WHEN the server is reachable THEN THE Connection_Tester SHALL report "online" status
3. WHEN the server is unreachable THEN THE Connection_Tester SHALL report "offline" status without console errors
4. THE Connection_Tester SHALL NOT test endpoints that return 404 (like /hls/ base path)

### Requirement 3: API Client HTTPS Enforcement

**User Story:** As a system, I want all API requests to use HTTPS in production, so that there are no Mixed Content errors.

#### Acceptance Criteria

1. WHEN the page is loaded over HTTPS THEN THE API_Client SHALL use HTTPS for all requests
2. WHEN constructing stream URLs THEN THE API_Client SHALL ensure all URLs use HTTPS in production
3. THE API_Client SHALL NOT generate HTTP URLs when the page is loaded over HTTPS

### Requirement 4: Security Middleware Compatibility

**User Story:** As a developer, I want security middleware to work correctly in production, so that the application functions properly.

#### Acceptance Criteria

1. WHEN a public endpoint is accessed THEN THE Security_Middleware SHALL allow the request without API key
2. WHEN a protected endpoint is accessed with valid credentials THEN THE Security_Middleware SHALL allow the request
3. WHEN CORS preflight requests are received THEN THE Security_Middleware SHALL respond correctly
4. THE Security_Middleware SHALL NOT block legitimate requests from the frontend

### Requirement 5: Error Recovery and Retry Logic

**User Story:** As a user, I want the application to recover gracefully from errors, so that I don't need to manually refresh.

#### Acceptance Criteria

1. WHEN a network error occurs THEN THE System SHALL attempt automatic retry with exponential backoff
2. WHEN maximum retries are exhausted THEN THE System SHALL display a user-friendly error message
3. WHEN the network is restored THEN THE System SHALL automatically attempt to reconnect
4. THE System SHALL NOT enter infinite retry loops

### Requirement 6: Resource Cleanup

**User Story:** As a system, I want proper resource cleanup, so that memory leaks and stale connections are prevented.

#### Acceptance Criteria

1. WHEN a video popup is closed THEN THE System SHALL destroy HLS instance and clear video source
2. WHEN navigating away from a page THEN THE System SHALL cleanup all active streams
3. WHEN a component unmounts THEN THE System SHALL cancel all pending timeouts and intervals
4. THE System SHALL NOT leave orphaned event listeners

### Requirement 7: Production Environment Configuration

**User Story:** As a developer, I want correct production configuration, so that the application works correctly when deployed.

#### Acceptance Criteria

1. WHEN deployed to production THEN THE System SHALL use correct API URLs (api-cctv.raf.my.id)
2. WHEN deployed to production THEN THE System SHALL use correct HLS URLs with proper paths
3. THE System SHALL handle Cloudflare SSL termination correctly
4. THE System SHALL work with nginx reverse proxy configuration
