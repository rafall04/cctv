/*
Purpose: Provide stack-based notification state and convenience notification helpers.
Caller: App provider tree and API/client UI components.
Deps: React context/state/callback refs.
MainFuncs: NotificationProvider, useNotification, getNotificationConfig.
SideEffects: Schedules and clears notification dismissal timers.
*/

import { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';

/**
 * Notification Context
 * 
 * Centralized notification system for managing toast notifications across the application.
 * Provides four notification types: success, error, warning, info with auto-dismiss timers.
 * 
 * Requirements: 1.1, 1.3, 1.6
 */

const NotificationContext = createContext(null);

// Notification type configurations
export const NOTIFICATION_CONFIG = {
    /*
     * Theme-aware by construction. These four were hardcoded light ramps —
     * `bg-emerald-50 border-emerald-200 text-emerald-800` and friends, with zero `dark:`
     * variants — so every toast in dark mode was a pale card pasted onto a dark shell. It was
     * the only piece of shared admin chrome that ignored the theme, and it is the piece an
     * operator sees most often: all 20 admin pages raise notifications through here.
     *
     * The BODY text is `text-content`, not the status colour. A status colour on a 10% tint of
     * itself is legible in one theme and marginal in the other, and this repo has already paid
     * for a contrast pass once. The colour signal lives on the border and the icon, where it
     * cannot cost readability. `status-*` are channel triplets in index.css, so slash-opacity
     * genuinely compiles here — unlike `primary`, which holds a full colour and needs the
     * pre-declared `primary-100` scale instead.
     */
    success: {
        duration: 5000,
        colorClass: 'bg-status-live/10 border-status-live/30 text-content',
        iconColor: 'text-status-live',
    },
    error: {
        duration: 8000,
        colorClass: 'bg-status-fault/10 border-status-fault/30 text-content',
        iconColor: 'text-status-fault',
    },
    warning: {
        duration: 8000,
        colorClass: 'bg-status-warn/10 border-status-warn/30 text-content',
        iconColor: 'text-status-warn',
    },
    info: {
        duration: 5000,
        colorClass: 'bg-primary-100 border-edge-strong text-content',
        iconColor: 'text-primary',
    },
};

// Maximum number of visible notifications
const MAX_NOTIFICATIONS = 5;

/**
 * Generate unique notification ID
 */
const generateId = () => `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/**
 * Get notification configuration by type
 * @param {string} type - Notification type (success, error, warning, info)
 * @returns {Object} Configuration object with duration, colorClass, iconColor
 */
export const getNotificationConfig = (type) => {
    // Use hasOwnProperty to check for own properties only, avoiding prototype properties
    // like 'constructor', 'valueOf', 'toString', etc.
    if (Object.prototype.hasOwnProperty.call(NOTIFICATION_CONFIG, type)) {
        return NOTIFICATION_CONFIG[type];
    }
    return NOTIFICATION_CONFIG.info;
};

export function NotificationProvider({ children }) {
    const [notifications, setNotifications] = useState([]);
    const timersRef = useRef({});

    /**
     * Dismiss a notification by ID
     * @param {string} id - Notification ID
     */
    const dismissNotification = useCallback((id) => {
        // Clear timer if exists
        if (timersRef.current[id]) {
            clearTimeout(timersRef.current[id]);
            delete timersRef.current[id];
        }

        setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, []);

    /**
     * Add a notification to the stack.
     *
     * Accepts either the full object form, or the `('Tersimpan', 'success')` shorthand that admin
     * pages already use. Without the shorthand a string argument produced a toast with no title and
     * no message — a visible but completely empty box (seen live on the archive + ronda pages).
     *
     * @param {Object|string} notification - Notification object, or the message text
     * @param {string} [shorthandType] - Type when the first argument is a string
     * @returns {string} Notification ID
     */
    const showNotification = useCallback((notification, shorthandType) => {
        const input = typeof notification === 'string'
            ? { type: shorthandType || 'info', title: notification }
            : (notification || {});

        const id = generateId();
        const config = getNotificationConfig(input.type);
        const duration = input.duration ?? config.duration;
        const dismissible = input.dismissible ?? true;

        const newNotification = {
            id,
            type: input.type || 'info',
            title: input.title,
            message: input.message,
            duration,
            dismissible,
            action: input.action,
            createdAt: Date.now(),
        };

        setNotifications((prev) => {
            // Remove oldest if at max capacity (FIFO)
            const updated = prev.length >= MAX_NOTIFICATIONS 
                ? prev.slice(1) 
                : prev;
            return [...updated, newNotification];
        });

        // Set auto-dismiss timer if duration > 0
        if (duration > 0) {
            timersRef.current[id] = setTimeout(() => {
                dismissNotification(id);
            }, duration);
        }

        return id;
    }, [dismissNotification]);

    /**
     * Clear all notifications
     */
    const clearAll = useCallback(() => {
        // Clear all timers
        Object.values(timersRef.current).forEach(clearTimeout);
        timersRef.current = {};
        setNotifications([]);
    }, []);

    // Convenience methods
    const success = useCallback((title, message) => {
        return showNotification({ type: 'success', title, message });
    }, [showNotification]);

    const error = useCallback((title, message) => {
        return showNotification({ type: 'error', title, message });
    }, [showNotification]);

    const warning = useCallback((title, message) => {
        return showNotification({ type: 'warning', title, message });
    }, [showNotification]);

    const info = useCallback((title, message) => {
        return showNotification({ type: 'info', title, message });
    }, [showNotification]);

    const value = useMemo(() => ({
        notifications,
        showNotification,
        dismissNotification,
        clearAll,
        success,
        error,
        warning,
        info,
    }), [notifications, showNotification, dismissNotification, clearAll, success, error, warning, info]);

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
}

/**
 * Hook to access notification context
 * @returns {Object} Notification context value
 */
export function useNotification() {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotification must be used within a NotificationProvider');
    }
    return context;
}

export default NotificationContext;
