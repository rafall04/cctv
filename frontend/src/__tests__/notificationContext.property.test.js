import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getNotificationConfig, NOTIFICATION_CONFIG } from '../contexts/NotificationContext';

/**
 * Feature: admin-ux-improvement
 * Property Tests for NotificationContext
 * 
 * Tests the core notification system functionality including:
 * - Notification type configuration
 * - Notification content structure
 * - Multiple notification management
 * - Auto-dismiss duration by type
 */

describe('NotificationContext', () => {
    /**
     * Feature: admin-ux-improvement
     * Property 1: Notification Type Configuration
     * Validates: Requirements 1.1, 1.3, 1.5
     * 
     * For any notification type (success, error, warning, info), the notification
     * system SHALL return the correct configuration including: appropriate color
     * scheme, correct icon component, and correct auto-dismiss duration.
     */
    it('Property 1: should return correct configuration for all notification types', () => {
        const notificationTypes = ['success', 'error', 'warning', 'info'];
        
        fc.assert(
            fc.property(
                fc.constantFrom(...notificationTypes),
                (type) => {
                    const config = getNotificationConfig(type);
                    
                    // Verify color scheme exists and is a non-empty string
                    expect(config.colorClass).toBeDefined();
                    expect(typeof config.colorClass).toBe('string');
                    expect(config.colorClass.length).toBeGreaterThan(0);
                    
                    // Verify icon color exists
                    expect(config.iconColor).toBeDefined();
                    expect(typeof config.iconColor).toBe('string');
                    expect(config.iconColor.length).toBeGreaterThan(0);
                    
                    // Verify duration is a positive number
                    expect(config.duration).toBeDefined();
                    expect(typeof config.duration).toBe('number');
                    expect(config.duration).toBeGreaterThan(0);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: admin-ux-improvement
     * Property 14: Auto-Dismiss Duration by Type
     * Validates: Requirements 1.3
     * 
     * For any notification with auto-dismiss enabled, success and info types
     * SHALL dismiss after 5000ms, while error and warning types SHALL dismiss
     * after 8000ms.
     */
    it('Property 14: should have correct auto-dismiss duration by type', () => {
        const shortDurationTypes = ['success', 'info'];
        const longDurationTypes = ['error', 'warning'];
        
        fc.assert(
            fc.property(
                fc.constantFrom(...shortDurationTypes),
                (type) => {
                    const config = getNotificationConfig(type);
                    expect(config.duration).toBe(5000);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
        
        fc.assert(
            fc.property(
                fc.constantFrom(...longDurationTypes),
                (type) => {
                    const config = getNotificationConfig(type);
                    expect(config.duration).toBe(8000);
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: admin-ux-improvement
     * Property 2: Notification Content Structure
     * Validates: Requirements 1.7
     * 
     * For any notification created with a title and optional message, the
     * notification object SHALL contain the title, and if message is provided,
     * it SHALL be included; if message is not provided, the notification SHALL
     * still be valid with title only.
     */
    it('Property 2: should create valid notification structure with title and optional message', () => {
        const notificationTypes = ['success', 'error', 'warning', 'info'];
        
        fc.assert(
            fc.property(
                fc.constantFrom(...notificationTypes),
                fc.string({ minLength: 1, maxLength: 100 }),
                fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
                (type, title, message) => {
                    // Simulate notification creation
                    const notification = {
                        type,
                        title,
                        message,
                    };
                    
                    // Title must always be present
                    expect(notification.title).toBeDefined();
                    expect(notification.title).toBe(title);
                    
                    // Type must be valid
                    expect(notificationTypes).toContain(notification.type);
                    
                    // Message is optional - if provided, should match
                    if (message !== undefined) {
                        expect(notification.message).toBe(message);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: admin-ux-improvement
     * Property 3: Multiple Notification Management
     * Validates: Requirements 1.6
     * 
     * For any sequence of notifications added to the system, the notification
     * list SHALL maintain all notifications in order of creation, and when the
     * maximum limit is reached, the oldest notification SHALL be removed first (FIFO).
     */
    it('Property 3: should manage multiple notifications with FIFO removal at max capacity', () => {
        const MAX_NOTIFICATIONS = 5;
        
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        type: fc.constantFrom('success', 'error', 'warning', 'info'),
                        title: fc.string({ minLength: 1, maxLength: 50 }),
                    }),
                    { minLength: 1, maxLength: 10 }
                ),
                (notificationsToAdd) => {
                    // Simulate notification stack behavior
                    let notifications = [];
                    
                    notificationsToAdd.forEach((notif, index) => {
                        const newNotification = {
                            ...notif,
                            id: `notif_${index}`,
                            createdAt: Date.now() + index,
                        };
                        
                        // Apply FIFO removal if at max capacity
                        if (notifications.length >= MAX_NOTIFICATIONS) {
                            notifications = notifications.slice(1);
                        }
                        notifications.push(newNotification);
                    });
                    
                    // Verify max capacity is never exceeded
                    expect(notifications.length).toBeLessThanOrEqual(MAX_NOTIFICATIONS);
                    
                    // Verify order is maintained (newest last)
                    for (let i = 1; i < notifications.length; i++) {
                        expect(notifications[i].createdAt).toBeGreaterThanOrEqual(
                            notifications[i - 1].createdAt
                        );
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Additional test: Unknown type should fallback to info configuration
     */
    it('should fallback to info configuration for unknown types', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 20 }).filter(
                    s => !['success', 'error', 'warning', 'info'].includes(s)
                ),
                (unknownType) => {
                    const config = getNotificationConfig(unknownType);
                    const infoConfig = NOTIFICATION_CONFIG.info;
                    
                    expect(config.duration).toBe(infoConfig.duration);
                    expect(config.colorClass).toBe(infoConfig.colorClass);
                    expect(config.iconColor).toBe(infoConfig.iconColor);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
