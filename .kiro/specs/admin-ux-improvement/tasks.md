# Implementation Plan: Admin UX Improvement

## Overview

This implementation plan covers the development of a comprehensive notification system, enhanced error handling, skeleton loading states, and improved form validation across all admin pages. The implementation follows a bottom-up approach, starting with core utilities and building up to page-level integration.

## Tasks

- [x] 1. Create Core Notification System
  - [x] 1.1 Create NotificationContext with state management
    - Implement notification state (add, remove, clear)
    - Add convenience methods (success, error, warning, info)
    - Configure auto-dismiss timers by type
    - _Requirements: 1.1, 1.3, 1.6_

  - [x] 1.2 Write property tests for NotificationContext
    - **Property 1: Notification Type Configuration**
    - **Property 2: Notification Content Structure**
    - **Property 3: Multiple Notification Management**
    - **Property 14: Auto-Dismiss Duration by Type**
    - **Validates: Requirements 1.1, 1.3, 1.5, 1.6, 1.7**

  - [x] 1.3 Create Toast component with animations
    - Implement toast UI with icons and colors
    - Add slide-in/fade-out animations
    - Add dismiss button functionality
    - _Requirements: 1.2, 1.4, 1.5, 1.7_

  - [x] 1.4 Create ToastContainer for notification stacking
    - Position fixed top-right
    - Stack multiple notifications vertically
    - _Requirements: 1.6_

- [x] 2. Create UI Components Library
  - [x] 2.1 Create Alert component for inline messages
    - Support success, error, warning, info variants
    - Add dismissible option
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.2 Create Skeleton components
    - Base Skeleton with pulse animation
    - SkeletonCard, SkeletonTable, SkeletonStats variants
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 2.3 Write property tests for Skeleton components
    - **Property 12: Loading State Triggers Skeleton**
    - **Validates: Requirements 3.4, 8.1, 8.2, 8.3, 8.4, 8.5**

  - [x] 2.4 Create EmptyState component
    - Support icon, title, description, action button
    - Consistent styling with muted colors
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6_

  - [x] 2.5 Create FormField component with validation display
    - Support text, password, textarea, select types
    - Show inline error messages
    - Show character count when configured
    - _Requirements: 7.1, 7.2, 7.5_

- [x] 3. Create Form Validation Hook
  - [x] 3.1 Implement useFormValidation hook
    - Handle values, errors, touched states
    - Implement validateField and validateForm
    - Support custom validation rules
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 3.2 Write property tests for form validation
    - **Property 4: Form Validation State Consistency**
    - **Property 5: Form Submission State Management**
    - **Property 6: Character Count Accuracy**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6, 7.7**

  - [x] 3.3 Create RTSP URL validator
    - Validate rtsp:// protocol
    - Validate host portion
    - Return appropriate error messages
    - _Requirements: 4.3_

  - [x] 3.4 Write property tests for RTSP validation
    - **Property 7: RTSP URL Validation**
    - **Validates: Requirements 4.3**

- [x] 4. Create API Error Handler
  - [x] 4.1 Implement useApiError hook
    - Map HTTP status codes to user messages
    - Detect network errors
    - Detect auth errors
    - _Requirements: 2.6, 2.7, 10.4, 10.5, 10.6_

  - [x] 4.2 Write property tests for API error handling
    - **Property 8: API Error Message Mapping**
    - **Validates: Requirements 2.6, 2.7, 10.4, 10.5, 10.6**

  - [x] 4.3 Implement retry with exponential backoff
    - Max 3 retries
    - Delays: 1s, 2s, 4s
    - Surface error after max retries
    - _Requirements: 10.7_

  - [x] 4.4 Write property tests for retry logic
    - **Property 9: Retry Logic with Exponential Backoff**
    - **Validates: Requirements 10.7**

  - [x] 4.5 Update apiClient with error interceptors
    - Add response interceptor for error handling
    - Handle 401 redirect to login
    - Integrate with notification system
    - _Requirements: 10.4_

- [x] 5. Checkpoint - Core Components Complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create Network Status Handler
  - [x] 6.1 Implement useNetworkStatus hook
    - Detect online/offline status
    - Trigger callbacks on status change
    - _Requirements: 10.1, 10.2_

  - [x] 6.2 Write property tests for network status
    - **Property 13: Network Status Detection**
    - **Validates: Requirements 10.1, 10.2**

  - [x] 6.3 Create NetworkStatusBanner component
    - Show persistent banner when offline
    - Show brief success when back online
    - _Requirements: 10.1, 10.2_

- [x] 7. Enhance Login Page
  - [x] 7.1 Integrate NotificationContext
    - Add success toast on login
    - _Requirements: 2.10_

  - [x] 7.2 Enhance error messages
    - Specific messages for empty fields
    - Clear message for invalid credentials
    - Network error handling
    - Server error handling
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7_

  - [x] 7.3 Add field-level validation highlighting
    - Red border on error fields
    - Clear error on input change
    - _Requirements: 2.9_

  - [x] 7.4 Enhance lockout and rate limit display
    - Show countdown timer
    - Clear messaging
    - _Requirements: 2.4, 2.5_

  - [x] 7.5 Add password expiry warning
    - Display days remaining
    - _Requirements: 2.8_

- [x] 8. Enhance Dashboard Page
  - [x] 8.1 Add skeleton loading states
    - Replace spinner with skeleton cards
    - Skeleton for stats grid
    - Skeleton for streams table
    - _Requirements: 3.4_

  - [x] 8.2 Enhance error display
    - Error state with retry button
    - MediaMTX offline warning banner
    - Connection status indicator
    - _Requirements: 3.1, 3.2, 3.3, 3.6_

  - [x] 8.3 Add empty states
    - No streams empty state
    - No activity logs empty state
    - _Requirements: 3.5_

  - [x] 8.4 Handle auto-refresh failures
    - Subtle warning without disruption
    - Show last successful update time
    - _Requirements: 3.7_

- [x] 9. Enhance Camera Management Page
  - [x] 9.1 Integrate notification system
    - Success toast on create/update/delete
    - Error toast on failures
    - _Requirements: 4.1, 4.5, 4.7, 4.8_

  - [x] 9.2 Add form validation
    - RTSP URL format validation
    - Required field validation
    - Duplicate name handling
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 9.3 Add loading states
    - Skeleton cards while loading
    - Loading state on delete button
    - _Requirements: 4.6, 4.11_

  - [x] 9.4 Implement optimistic toggle with rollback
    - Toggle status optimistically
    - Revert on API failure
    - Show error toast
    - _Requirements: 4.9_

  - [x] 9.5 Write property tests for optimistic update
    - **Property 11: Optimistic Update Rollback**
    - **Validates: Requirements 4.9**

  - [x] 9.6 Add empty state
    - Helpful message with quick-add button
    - _Requirements: 4.10_

- [x] 10. Checkpoint - Camera Management Complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Enhance Area Management Page
  - [x] 11.1 Integrate notification system
    - Success toast on create/update/delete
    - Error toast on failures
    - _Requirements: 5.1, 5.4, 5.5_

  - [x] 11.2 Add form validation
    - Required field validation
    - Duplicate name handling
    - _Requirements: 5.2_

  - [x] 11.3 Add deletion warning for areas with cameras
    - Show affected camera count
    - Require confirmation
    - _Requirements: 5.3_

  - [x] 11.4 Add loading and empty states
    - Skeleton cards while loading
    - Empty state with area purpose explanation
    - _Requirements: 5.6, 5.7_

- [x] 12. Enhance User Management Page
  - [x] 12.1 Integrate notification system
    - Success toast on create/update/delete
    - Success toast on password change
    - Error toast on failures
    - _Requirements: 6.1, 6.4, 6.6, 6.7_

  - [x] 12.2 Add form validation
    - Username validation
    - Password requirements display
    - Duplicate username handling
    - _Requirements: 6.2, 6.3_

  - [x] 12.3 Write property tests for password validation
    - **Property 6.3: Password Requirements Validation**
    - **Validates: Requirements 6.3**
    - **PBT Status: PASSED** (8/8 tests passed)

  - [x] 12.4 Implement self-deletion prevention
    - Check if deleting own account
    - Show warning and prevent action
    - _Requirements: 6.5_

  - [x] 12.5 Write property tests for self-deletion prevention
    - **Property 10: Self-Deletion Prevention**
    - **Validates: Requirements 6.5**
    - **PBT Status: PASSED** (6/6 tests passed)

  - [x] 12.6 Add loading and empty states
    - Skeleton table while loading
    - Error state with retry
    - _Requirements: 6.8, 6.9_

- [ ] 13. Integrate Network Status Globally
  - [ ] 13.1 Add NetworkStatusBanner to AdminLayout
    - Show offline banner
    - Auto-refresh on reconnect
    - _Requirements: 10.1, 10.2_

  - [ ] 13.2 Update apiClient for timeout handling
    - Display timeout error
    - Offer retry option
    - _Requirements: 10.3_

- [ ] 14. Final Checkpoint - All Features Complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all notification types work correctly
  - Verify all error states display properly
  - Verify all loading states show skeletons
  - Verify all empty states are informative

## Notes

- All tasks including property-based tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Implementation uses React Context for global state (notifications, network status)
- All components follow existing Tailwind CSS styling patterns
