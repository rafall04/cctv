# Implementation Plan: Stream Loading Fix

## Overview

Implementasi perbaikan loading stream CCTV yang stuck/tidak responsif pada device low-end. Fokus pada timeout detection, HLS preloading, connection pre-check, dan progressive loading feedback.

## Tasks

- [x] 1. Create PreloadManager module
  - [x] 1.1 Create preloadManager.js utility
    - Create `frontend/src/utils/preloadManager.js`
    - Implement singleton pattern for HLS.js caching
    - Implement preloadHls() function with status tracking
    - Implement isPreloaded() and getPreloadStatus() functions
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 1.2 Write property test for HLS caching
    - **Property 2: HLS Module Caching**
    - **Validates: Requirements 2.2, 2.3**

- [x] 2. Create ConnectionTester module
  - [x] 2.1 Create connectionTester.js utility
    - Create `frontend/src/utils/connectionTester.js`
    - Implement testConnection() with HEAD request
    - Implement 5 second timeout with AbortController
    - Return ConnectionTestResult with reachable, latency, error
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 2.2 Write property test for connection timeout
    - **Property 3: Connection Test Timeout**
    - **Property 4: Server Unreachable Error**
    - **Validates: Requirements 3.2, 3.4**

- [x] 3. Checkpoint - Ensure utility modules work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create LoadingTimeoutHandler module
  - [x] 4.1 Create loadingTimeoutHandler.js utility
    - Create `frontend/src/utils/loadingTimeoutHandler.js`
    - Implement getTimeoutDuration(deviceTier) - 15s low, 10s high
    - Implement startTimeout(), clearTimeout(), onTimeout()
    - Implement consecutive failure tracking
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.3_
  - [x] 4.2 Write property test for timeout duration
    - **Property 1: Device-Adaptive Timeout Duration**
    - **Validates: Requirements 1.1, 5.3**
  - [x] 4.3 Write property test for consecutive failures
    - **Property 9: Consecutive Failure Tracking**
    - **Validates: Requirements 1.4**

- [x] 5. Create StreamLoader constants and types
  - [x] 5.1 Create streamLoaderTypes.js
    - Create `frontend/src/utils/streamLoaderTypes.js`
    - Define LoadingStage enum (connecting, loading, buffering, starting, playing, error, timeout)
    - Define LOADING_STAGE_MESSAGES mapping
    - Define StreamError interface
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 8.1_
  - [x] 5.2 Write property test for loading stage progression
    - **Property 5: Loading Stage Progression**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 6. Create FallbackHandler module
  - [x] 6.1 Create fallbackHandler.js utility
    - Create `frontend/src/utils/fallbackHandler.js`
    - Implement getRetryDelay(errorType) - 3s network, 5s server
    - Implement shouldAutoRetry() with max 3 retries
    - Implement network restore listener
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 6.2 Write property test for auto-retry limit
    - **Property 6: Auto-Retry Limit**
    - **Validates: Requirements 6.2, 6.4**
  - [x] 6.3 Write property test for retry delay
    - **Property 7: Auto-Retry Delay**
    - **Validates: Requirements 6.1**

- [x] 7. Checkpoint - Ensure all utility modules work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update VideoPlayer component with new loading system
  - [x] 8.1 Integrate PreloadManager into VideoPlayer
    - Update `frontend/src/components/VideoPlayer.jsx`
    - Use preloaded HLS.js instead of direct import
    - _Requirements: 2.3_
  - [x] 8.2 Integrate LoadingTimeoutHandler into VideoPlayer
    - Add timeout detection based on device tier
    - Handle timeout with proper cleanup
    - _Requirements: 1.1, 1.2, 1.3, 5.3_
  - [x] 8.3 Add progressive loading stages
    - Display stage-specific messages during loading
    - Update stage as loading progresses
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 8.4 Integrate FallbackHandler for auto-retry
    - Add auto-retry on network errors
    - Limit to 3 auto-retries
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 8.5 Write property test for resource cleanup
    - **Property 8: Resource Cleanup on Timeout**
    - **Validates: Requirements 1.3, 7.1, 7.2, 7.3**

- [x] 9. Update LandingPage with preloading and connection check
  - [x] 9.1 Add HLS.js preloading on mount
    - Update `frontend/src/pages/LandingPage.jsx`
    - Call preloadHls() immediately on mount
    - _Requirements: 2.1, 5.5_
  - [x] 9.2 Add connection pre-check before stream
    - Check MediaMTX reachability before initializing stream
    - Show server offline message if unreachable
    - _Requirements: 3.1, 3.2, 3.5_
  - [x] 9.3 Update VideoPopup with new loading system
    - Integrate timeout handler and progressive stages
    - Add auto-retry functionality
    - _Requirements: All_
  - [x] 9.4 Update MultiViewVideoItem with new loading system
    - Integrate timeout handler and progressive stages
    - Add auto-retry functionality
    - _Requirements: All_

- [x] 10. Checkpoint - Ensure VideoPlayer and LandingPage work
  - Ensure all tests pass, ask the user if questions arise.

- [-] 11. Add low-end device optimizations
  - [x] 11.1 Disable animations on low-end during loading
    - Remove animate-pulse, animate-spin on low-end devices
    - Use static loading indicators instead
    - _Requirements: 5.2_
  - [x] 11.2 Limit concurrent initializations on low-end
    - Only allow 1 stream to initialize at a time on low-end
    - Queue additional streams
    - _Requirements: 5.4_
  - [x] 11.3 Write property test for animation disable
    - **Property 11: Low-End Animation Disable**
    - **Validates: Requirements 5.2**

- [x] 12. Add diagnostic information display
  - [x] 12.1 Create DiagnosticInfo component
    - Create error details display with device tier, error type, stage
    - Add copy diagnostic info button
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 12.2 Add retry time estimation
    - Show estimated time to retry based on error type
    - _Requirements: 8.5_
  - [x] 12.3 Write property test for error diagnostic
    - **Property 10: Error Diagnostic Information**
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [x] 13. Add cleanup on unmount
  - [x] 13.1 Ensure complete cleanup on component unmount
    - Clear all timeouts
    - Destroy HLS instance
    - Remove all event listeners
    - Cancel pending requests
    - _Requirements: 7.4, 7.5_
  - [x] 13.2 Write property test for cleanup on unmount
    - **Property 12: Cleanup on Unmount**
    - **Validates: Requirements 7.4, 7.5**

- [x] 14. Final checkpoint - Full integration test
  - Ensure all tests pass, ask the user if questions arise.
  - Test on simulated low-end device (Chrome DevTools throttling)
  - Test timeout detection and recovery
  - Test auto-retry functionality
  - Verify no stuck loading on LandingPage

## Notes

- All tasks including property-based tests are required
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Focus on fixing the stuck loading issue on low-end Chrome
- Ensure backward compatibility with existing VideoPlayer functionality

