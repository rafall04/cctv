# Design Document: Admin UX Improvement

## Overview

This design document outlines the technical implementation for improving the admin panel user experience across all pages. The system will introduce a centralized notification system, consistent error handling patterns, skeleton loading states, and informative empty states. The design follows React best practices with context-based state management and reusable components.

## Architecture

The improvement will be implemented using a layered architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin Pages Layer                         │
│  (LoginPage, Dashboard, CameraManagement, AreaManagement,   │
│   UserManagement)                                            │
├─────────────────────────────────────────────────────────────┤
│                  UI Components Layer                         │
│  (Toast, Alert, Skeleton, EmptyState, FormField)            │
├─────────────────────────────────────────────────────────────┤
│                  Context/Hooks Layer                         │
│  (NotificationContext, useFormValidation, useApiError)      │
├─────────────────────────────────────────────────────────────┤
│                   Services Layer                             │
│  (apiClient with error interceptors)                         │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. NotificationContext

Central context for managing toast notifications across the application.

```jsx
// frontend/src/contexts/NotificationContext.jsx

interface Notification {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message?: string;
    duration?: number;
    dismissible?: boolean;
    action?: {
        label: string;
        onClick: () => void;
    };
}

interface NotificationContextValue {
    notifications: Notification[];
    showNotification: (notification: Omit<Notification, 'id'>) => string;
    dismissNotification: (id: string) => void;
    clearAll: () => void;
    
    // Convenience methods
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
}
```

### 2. Toast Component

Reusable toast notification component with animations.

```jsx
// frontend/src/components/ui/Toast.jsx

interface ToastProps {
    notification: Notification;
    onDismiss: (id: string) => void;
}

// Visual specifications:
// - Position: fixed top-right (top-4 right-4)
// - Width: max-w-sm (384px)
// - Animation: slide-in from right, fade-out on dismiss
// - Icons: CheckCircle (success), XCircle (error), AlertTriangle (warning), Info (info)
// - Colors: 
//   - Success: bg-emerald-50 border-emerald-200 text-emerald-800
//   - Error: bg-red-50 border-red-200 text-red-800
//   - Warning: bg-amber-50 border-amber-200 text-amber-800
//   - Info: bg-sky-50 border-sky-200 text-sky-800
```

### 3. Alert Component

Inline alert for form errors and page-level messages.

```jsx
// frontend/src/components/ui/Alert.jsx

interface AlertProps {
    type: 'success' | 'error' | 'warning' | 'info';
    title?: string;
    message: string;
    dismissible?: boolean;
    onDismiss?: () => void;
    className?: string;
}
```

### 4. Skeleton Components

Loading placeholder components matching content layout.

```jsx
// frontend/src/components/ui/Skeleton.jsx

// Base skeleton with pulse animation
interface SkeletonProps {
    className?: string;
    variant?: 'text' | 'circular' | 'rectangular';
    width?: string | number;
    height?: string | number;
}

// Compound components for common patterns
SkeletonCard: React.FC<{ lines?: number }>
SkeletonTable: React.FC<{ rows?: number; columns?: number }>
SkeletonStats: React.FC<{ count?: number }>
```

### 5. EmptyState Component

Informative placeholder when no data exists.

```jsx
// frontend/src/components/ui/EmptyState.jsx

interface EmptyStateProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    action?: {
        label: string;
        onClick: () => void;
    };
    secondaryAction?: {
        label: string;
        onClick: () => void;
    };
}
```

### 6. FormField Component

Enhanced form field with validation feedback.

```jsx
// frontend/src/components/ui/FormField.jsx

interface FormFieldProps {
    label: string;
    name: string;
    type?: 'text' | 'password' | 'email' | 'textarea' | 'select';
    value: string;
    onChange: (e: React.ChangeEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    error?: string;
    hint?: string;
    required?: boolean;
    disabled?: boolean;
    maxLength?: number;
    showCharCount?: boolean;
    options?: Array<{ value: string; label: string }>; // for select
}
```

### 7. useFormValidation Hook

Custom hook for form validation logic.

```jsx
// frontend/src/hooks/useFormValidation.js

interface ValidationRule {
    required?: boolean | string;
    minLength?: { value: number; message: string };
    maxLength?: { value: number; message: string };
    pattern?: { value: RegExp; message: string };
    custom?: (value: any, formData: any) => string | undefined;
}

interface UseFormValidationReturn {
    values: Record<string, any>;
    errors: Record<string, string>;
    touched: Record<string, boolean>;
    isValid: boolean;
    isDirty: boolean;
    handleChange: (e: React.ChangeEvent) => void;
    handleBlur: (e: React.FocusEvent) => void;
    setFieldValue: (name: string, value: any) => void;
    setFieldError: (name: string, error: string) => void;
    validateField: (name: string) => boolean;
    validateForm: () => boolean;
    reset: () => void;
}
```

### 8. useApiError Hook

Custom hook for standardized API error handling.

```jsx
// frontend/src/hooks/useApiError.js

interface ApiError {
    status: number;
    message: string;
    code?: string;
    details?: Record<string, any>;
}

interface UseApiErrorReturn {
    handleError: (error: any) => ApiError;
    getErrorMessage: (error: any) => string;
    isNetworkError: (error: any) => boolean;
    isAuthError: (error: any) => boolean;
    isValidationError: (error: any) => boolean;
}
```

## Data Models

### Notification State Model

```javascript
{
    notifications: [
        {
            id: "notif_1703123456789",
            type: "success",
            title: "Camera Created",
            message: "Front Entrance camera has been added successfully",
            duration: 5000,
            dismissible: true,
            createdAt: 1703123456789
        }
    ],
    maxNotifications: 5  // Maximum visible notifications
}
```

### Form Validation State Model

```javascript
{
    values: {
        name: "Camera 1",
        private_rtsp_url: "rtsp://...",
        // ...
    },
    errors: {
        name: "",
        private_rtsp_url: "Invalid RTSP URL format"
    },
    touched: {
        name: true,
        private_rtsp_url: true
    },
    isSubmitting: false
}
```

### Error Message Mapping

```javascript
const ERROR_MESSAGES = {
    // Network errors
    NETWORK_ERROR: "Unable to connect to server. Please check your connection.",
    TIMEOUT_ERROR: "Request timed out. Please try again.",
    
    // Auth errors
    INVALID_CREDENTIALS: "Invalid username or password. Please check your credentials.",
    ACCOUNT_LOCKED: "Account temporarily locked. Try again in {time}.",
    SESSION_EXPIRED: "Your session has expired. Please log in again.",
    RATE_LIMITED: "Too many attempts. Please wait {time} before trying again.",
    
    // Validation errors
    REQUIRED_FIELD: "{field} is required",
    INVALID_FORMAT: "Invalid {field} format",
    DUPLICATE_ENTRY: "{field} already exists",
    
    // Server errors
    SERVER_ERROR: "Server error occurred. Please try again later.",
    FORBIDDEN: "You don't have permission to perform this action.",
    NOT_FOUND: "The requested resource was not found."
};
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the following correctness properties have been identified:

### Property 1: Notification Type Configuration

*For any* notification type (success, error, warning, info), the notification system SHALL return the correct configuration including: appropriate color scheme, correct icon component, and correct auto-dismiss duration (5000ms for success/info, 8000ms for error/warning).

**Validates: Requirements 1.1, 1.3, 1.5**

### Property 2: Notification Content Structure

*For any* notification created with a title and optional message, the notification object SHALL contain the title, and if message is provided, it SHALL be included; if message is not provided, the notification SHALL still be valid with title only.

**Validates: Requirements 1.7**

### Property 3: Multiple Notification Management

*For any* sequence of notifications added to the system, the notification list SHALL maintain all notifications in order of creation, and when the maximum limit is reached, the oldest notification SHALL be removed first (FIFO).

**Validates: Requirements 1.6**

### Property 4: Form Validation State Consistency

*For any* form with validation rules, when a field value changes: if the value violates a rule, the error state for that field SHALL be set; if the value satisfies all rules, the error state SHALL be cleared; the form's overall validity SHALL equal the conjunction of all field validities.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

### Property 5: Form Submission State Management

*For any* form during submission, all input fields SHALL be disabled, the submit button SHALL show loading state, and upon failure, all fields SHALL be re-enabled with their values preserved.

**Validates: Requirements 7.6, 7.7**

### Property 6: Character Count Accuracy

*For any* input field with maxLength configured and showCharCount enabled, the displayed character count SHALL equal the actual length of the input value, and SHALL not exceed maxLength.

**Validates: Requirements 7.5**

### Property 7: RTSP URL Validation

*For any* string input as RTSP URL, the validation SHALL return true only if the string starts with "rtsp://" and contains a valid host portion; all other strings SHALL return false with appropriate error message.

**Validates: Requirements 4.3**

### Property 8: API Error Message Mapping

*For any* API error response with a status code, the error handler SHALL map it to a user-friendly message: 401 → session expired, 403 → access denied, 404 → not found, 500 → server error, network error → connection error.

**Validates: Requirements 2.6, 2.7, 10.4, 10.5, 10.6**

### Property 9: Retry Logic with Exponential Backoff

*For any* failed API request configured for retry, the system SHALL retry up to 3 times with delays following exponential backoff pattern: 1st retry after 1s, 2nd after 2s, 3rd after 4s. After max retries, the error SHALL be surfaced to the user.

**Validates: Requirements 10.7**

### Property 10: Self-Deletion Prevention

*For any* user attempting to delete their own account (where user.id equals currentUser.id), the system SHALL prevent the deletion and display a warning message; the delete operation SHALL not be executed.

**Validates: Requirements 6.5**

### Property 11: Optimistic Update Rollback

*For any* optimistic UI update (e.g., toggle camera status), if the API call fails, the UI state SHALL be reverted to its previous value and an error notification SHALL be displayed.

**Validates: Requirements 4.9**

### Property 12: Loading State Triggers Skeleton

*For any* component in loading state, the component SHALL render skeleton placeholders instead of actual content; when loading completes, the skeleton SHALL be replaced with actual content or error state.

**Validates: Requirements 3.4, 8.1, 8.2, 8.3, 8.4, 8.5**

### Property 13: Network Status Detection

*For any* change in network connectivity, the system SHALL detect the change and update the UI accordingly: offline → show persistent banner, online → show brief success notification and trigger data refresh.

**Validates: Requirements 10.1, 10.2**

### Property 14: Auto-Dismiss Duration by Type

*For any* notification with auto-dismiss enabled, success and info types SHALL dismiss after 5000ms, while error and warning types SHALL dismiss after 8000ms.

**Validates: Requirements 1.3**

## Error Handling

### Error Categories and Handling Strategy

| Error Category | HTTP Status | User Message | Action |
|---------------|-------------|--------------|--------|
| Network Error | N/A | "Unable to connect to server. Please check your connection." | Show retry button |
| Timeout | N/A | "Request timed out. Please try again." | Auto-retry up to 3 times |
| Unauthorized | 401 | "Your session has expired. Please log in again." | Redirect to login |
| Forbidden | 403 | "You don't have permission to perform this action." | Show error toast |
| Not Found | 404 | "The requested resource was not found." | Show error state |
| Validation | 400 | Dynamic based on field | Highlight field with error |
| Rate Limited | 429 | "Too many attempts. Please wait {time}." | Show countdown |
| Server Error | 500 | "Server error occurred. Please try again later." | Show error toast with retry |

### Error Recovery Patterns

```javascript
// Automatic retry with exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries - 1) throw error;
            const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

// Optimistic update with rollback
const optimisticUpdate = async (updateFn, rollbackFn, apiCall) => {
    const previousState = updateFn(); // Apply optimistic update
    try {
        await apiCall();
    } catch (error) {
        rollbackFn(previousState); // Revert on failure
        throw error;
    }
};
```

### Form Validation Error Messages

```javascript
const VALIDATION_MESSAGES = {
    required: (field) => `${field} is required`,
    minLength: (field, min) => `${field} must be at least ${min} characters`,
    maxLength: (field, max) => `${field} must not exceed ${max} characters`,
    email: () => 'Please enter a valid email address',
    rtspUrl: () => 'Please enter a valid RTSP URL (rtsp://...)',
    passwordMatch: () => 'Passwords do not match',
    passwordStrength: () => 'Password must contain at least 8 characters, one uppercase, one lowercase, and one number',
    duplicate: (field) => `${field} already exists`,
};
```

## Testing Strategy

### Dual Testing Approach

This feature will be tested using both unit tests and property-based tests:

1. **Unit Tests**: Verify specific examples, edge cases, and error conditions
2. **Property-Based Tests**: Verify universal properties across all valid inputs

### Property-Based Testing Configuration

- **Library**: fast-check
- **Minimum iterations**: 100 per property test
- **Location**: `frontend/src/__tests__/`

### Test Files Structure

```
frontend/src/__tests__/
├── notificationContext.property.test.js   # Properties 1, 2, 3, 14
├── formValidation.property.test.js        # Properties 4, 5, 6
├── apiErrorHandler.property.test.js       # Properties 8, 9
├── rtspValidation.property.test.js        # Property 7
├── userManagement.property.test.js        # Property 10
├── optimisticUpdate.property.test.js      # Property 11
├── loadingState.property.test.js          # Property 12
└── networkStatus.property.test.js         # Property 13
```

### Property Test Annotations

Each property test must include:
- Feature tag: `Feature: admin-ux-improvement`
- Property reference: `Property N: [Property Title]`
- Requirements reference: `Validates: Requirements X.Y`

### Example Property Test Structure

```javascript
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('NotificationContext', () => {
    /**
     * Feature: admin-ux-improvement
     * Property 1: Notification Type Configuration
     * Validates: Requirements 1.1, 1.3, 1.5
     */
    it('should return correct configuration for all notification types', () => {
        const notificationTypes = ['success', 'error', 'warning', 'info'];
        
        fc.assert(
            fc.property(
                fc.constantFrom(...notificationTypes),
                (type) => {
                    const config = getNotificationConfig(type);
                    
                    // Verify color scheme exists
                    expect(config.colorClass).toBeDefined();
                    
                    // Verify icon exists
                    expect(config.icon).toBeDefined();
                    
                    // Verify duration
                    if (type === 'success' || type === 'info') {
                        expect(config.duration).toBe(5000);
                    } else {
                        expect(config.duration).toBe(8000);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
```

### Unit Test Coverage

Unit tests should cover:
- Component rendering with different props
- User interactions (click, blur, submit)
- Error state display
- Loading state transitions
- Empty state rendering
- Toast notification lifecycle
- Form submission flow
- API error handling scenarios

### Integration Test Scenarios

- Login flow with various error conditions
- CRUD operations with success/failure feedback
- Network offline/online transitions
- Session expiry and redirect
- Form validation with real-time feedback
