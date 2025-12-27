import { createContext, useContext, useState, useCallback, useRef } from 'react';

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
    success: {
        duration: 5000,
        colorClass: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        iconColor: 'text-emerald-500',
    },
    error: {
        duration: 8000,
        colorClass: 'bg-red-50 border-red-200 text-red-800',
        iconColor: 'text-red-500',
    },
    warning: {
        duration: 8000,
        colorClass: 'bg-amber-50 border-amber-200 text-amber-800',
        iconColor: 'text-amber-500',
    },
    info: {
        duration: 5000,
        colorClass: 'bg-sky-50 border-sky-200 text-sky-800',
        iconColor: 'text-sky-500',
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
    // Use Object.hasOwn to check for own properties only, avoiding prototype properties
    // like 'constructor', 'valueOf', 'toString', etc.
    if (Object.hasOwn(NOTIFICATION_CONFIG, type)) {
        return NOTIFICATION_CONFIG[type];
    }
    return NOTIFICATION_CONFIG.info;
};

export function NotificationProvider({ children }) {
    const [notifications, setNotifications] = useState([]);
    const timersRef = useRef({});

    /**
     * Add a notification to the stack
     * @param {Object} notification - Notification object
     * @returns {string} Notification ID
     */
    const showNotification = useCallback((notification) => {
        const id = generateId();
        const config = getNotificationConfig(notification.type);
        const duration = notification.duration ?? config.duration;
        const dismissible = notification.dismissible ?? true;

        const newNotification = {
            id,
            type: notification.type || 'info',
            title: notification.title,
            message: notification.message,
            duration,
            dismissible,
            action: notification.action,
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
    }, []);

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

    const value = {
        notifications,
        showNotification,
        dismissNotification,
        clearAll,
        success,
        error,
        warning,
        info,
    };

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
