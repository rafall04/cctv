# Implementation Plan: Media Player Optimization

## Overview

Implementasi optimasi Media Player untuk RAF NET CCTV Hub dengan fokus pada performa di semua jenis device. Menggunakan pendekatan modular dengan device-adaptive configuration, intelligent buffer management, dan graceful error recovery.

## Tasks

- [x] 1. Setup testing infrastructure dan DeviceDetector module
  - [x] 1.1 Install fast-check untuk property-based testing
    - Run `npm install --save-dev fast-check` di frontend
    - _Requirements: Testing infrastructure_
  - [x] 1.2 Create DeviceDetector utility module
    - Create `frontend/src/utils/deviceDetector.js`
    - Implement device capability detection (RAM, CPU cores, mobile detection)
    - Implement tier classification logic (low, medium, high)
    - _Requirements: 1.1_
  - [x] 1.3 Write property test for DeviceDetector
    - **Property 1: Device Capability Detection Consistency**
    - **Validates: Requirements 1.1**

- [x] 2. Implement HLS Configuration module
  - [x] 2.1 Create HLS configuration factory
    - Create `frontend/src/utils/hlsConfig.js`
    - Implement getHLSConfig(tier) function with tier-specific settings
    - Low tier: enableWorker=false, maxBufferLength=15s
    - Medium tier: enableWorker=true, maxBufferLength=25s
    - High tier: enableWorker=true, maxBufferLength=30s
    - _Requirements: 1.2, 1.3, 1.4, 1.5_
  - [x] 2.2 Write property test for HLS configuration
    - **Property 2: Device-based HLS Configuration**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5**

- [x] 3. Checkpoint - Ensure core modules work
  - Ensure all tests pass, ask the user if questions arise.

- [-] 4. Implement StreamController with visibility awareness
  - [x] 4.1 Create VisibilityObserver utility
    - Create `frontend/src/utils/visibilityObserver.js`
    - Implement Intersection Observer wrapper
    - Support observe/unobserve/disconnect methods
    - _Requirements: 4.1_
  - [x] 4.2 Create StreamController module
    - Create `frontend/src/utils/streamController.js`
    - Implement stream lifecycle management (init, pause, resume, destroy)
    - Integrate visibility-based pause/resume with 5s delay
    - _Requirements: 4.2, 4.3_
  - [x] 4.3 Write property test for visibility-based stream control
    - **Property 9: Visibility-based Stream Control**
    - **Validates: Requirements 4.2, 4.3**

- [x] 5. Implement ErrorRecovery module
  - [x] 5.1 Create ErrorRecovery utility
    - Create `frontend/src/utils/errorRecovery.js`
    - Implement exponential backoff (1s, 2s, 4s, 8s max)
    - Implement handleNetworkError with retry logic
    - Implement handleMediaError with recoverMediaError()
    - _Requirements: 3.1, 3.2, 3.4_
  - [x] 5.2 Write property test for exponential backoff
    - **Property 6: Exponential Backoff Recovery**
    - **Validates: Requirements 3.1**

- [x] 6. Checkpoint - Ensure utilities work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Refactor VideoPlayer component
  - [x] 7.1 Integrate DeviceDetector into VideoPlayer
    - Update `frontend/src/components/VideoPlayer.jsx`
    - Detect device tier on mount
    - Apply tier-specific HLS configuration
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 7.2 Integrate ErrorRecovery into VideoPlayer
    - Replace current error handling with ErrorRecovery module
    - Implement brief buffer no-spinner logic (< 2s)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 7.3 Integrate VisibilityObserver into VideoPlayer
    - Add visibility-based pause/resume
    - Implement proper cleanup on unmount
    - _Requirements: 4.2, 4.3, 2.4, 2.5_
  - [x] 7.4 Write property test for resource cleanup
    - **Property 5: Resource Cleanup Completeness**
    - **Validates: Requirements 2.4, 2.5**

- [x] 8. Optimize rendering performance
  - [x] 8.1 Optimize zoom/pan with requestAnimationFrame
    - Created `frontend/src/utils/rafThrottle.js`
    - Implement RAF-based transform updates
    - Throttle events to max 60fps
    - _Requirements: 5.1, 5.2, 5.5_
  - [x] 8.2 Optimize overlay controls rendering
    - Make overlay controls render only on hover/touch
    - Disable animations in fullscreen mode
    - _Requirements: 5.3, 5.4_
  - [x] 8.3 Write property test for event throttling
    - Created `frontend/src/__tests__/rafThrottle.property.test.js`
    - **Property 11: Zoom/Pan Event Throttling**
    - **Validates: Requirements 5.2**

- [x] 9. Checkpoint - Ensure VideoPlayer optimizations work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement AdaptiveQuality module
  - [x] 10.1 Create AdaptiveQuality utility
    - Create `frontend/src/utils/adaptiveQuality.js`
    - Implement bandwidth monitoring
    - Implement quality level adjustment based on bandwidth
    - Handle network type changes
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 10.2 Write property test for bandwidth-based quality
    - **Property 12: Bandwidth-based Quality Adaptation**
    - **Validates: Requirements 6.2, 6.3**

- [x] 11. Implement mobile-specific optimizations
  - [x] 11.1 Add mobile detection and configuration
    - Update DeviceDetector for mobile-specific detection
    - Apply mobile-optimized HLS settings
    - _Requirements: 7.1, 7.2_
  - [x] 11.2 Handle orientation changes
    - Add orientation change listener
    - Ensure layout adapts without stream reload
    - _Requirements: 7.4_
  - [x] 11.3 Optimize touch event handling
    - Ensure touch events don't cause scroll jank
    - Use passive event listeners where appropriate
    - _Requirements: 7.5_
  - [x] 11.4 Write property test for mobile configuration
    - **Property 14: Mobile HLS Configuration**
    - **Validates: Requirements 7.1, 7.2**

- [x] 12. Checkpoint - Ensure mobile optimizations work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Optimize Multi-View performance
  - [x] 13.1 Implement staggered stream initialization
    - Update MultiViewLayout in LandingPage.jsx
    - Add 100ms delay between stream starts
    - _Requirements: 8.1_
  - [x] 13.2 Implement stream limit enforcement
    - Limit concurrent streams based on device tier
    - 2 streams for low-end, 3 for medium/high
    - _Requirements: 4.5_
  - [x] 13.3 Implement error isolation in Multi-View
    - Ensure one stream error doesn't affect others
    - _Requirements: 8.3_
  - [x] 13.4 Implement proper Multi-View cleanup
    - Ensure all streams are destroyed on exit
    - _Requirements: 8.5_
  - [x] 13.5 Write property test for stream limits
    - **Property 10: Multi-View Stream Limits**
    - **Validates: Requirements 4.5**
  - [x] 13.6 Write property test for Multi-View cleanup
    - **Property 18: Multi-View Cleanup**
    - **Validates: Requirements 8.5**

- [x] 14. Update LandingPage with optimizations
  - [x] 14.1 Integrate all optimization modules
    - Import and use DeviceDetector
    - Apply device-specific configurations
    - Use optimized VideoPlayer and Multi-View
    - _Requirements: All_
  - [x] 14.2 Implement lazy loading for HLS.js
    - Keep existing lazy load pattern
    - Ensure HLS is only loaded when needed
    - _Requirements: 4.4_

- [x] 15. Update steering rules
  - [x] 15.1 Update best-practices.md with video optimization guidelines
    - Add section for video player best practices
    - Document device-adaptive configuration approach
    - _Requirements: Documentation_
  - [x] 15.2 Update tech.md with new utilities
    - Document new utility modules
    - Update component documentation
    - _Requirements: Documentation_

- [x] 16. Final checkpoint - Full integration test
  - Ensure all tests pass, ask the user if questions arise.
  - Test on simulated low-end device
  - Test Multi-View with 3 cameras
  - Verify error recovery works

## Notes

- All tasks including property-based tests are required
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- Focus on minimal code changes while maximizing impact

