import { useState } from 'react';
import { getNotificationConfig } from '../../contexts/NotificationContext';

/**
 * Toast Component
 * 
 * Individual toast notification with animations and dismiss functionality.
 * Supports success, error, warning, and info types with appropriate styling.
 * 
 * Requirements: 1.2, 1.4, 1.5, 1.7
 */

// Icon components for each notification type
const CheckCircleIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const XCircleIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const AlertTriangleIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);

const InfoIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const CloseIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M6 18L18 6M6 6l12 12" />
    </svg>
);

// Map notification types to icons
const ICONS = {
    success: CheckCircleIcon,
    error: XCircleIcon,
    warning: AlertTriangleIcon,
    info: InfoIcon,
};

/**
 * Toast notification component
 * @param {Object} props
 * @param {Object} props.notification - Notification object
 * @param {Function} props.onDismiss - Callback when toast is dismissed
 */
export function Toast({ notification, onDismiss }) {
    const [isExiting, setIsExiting] = useState(false);
    const config = getNotificationConfig(notification.type);
    const Icon = ICONS[notification.type] || ICONS.info;

    const handleDismiss = () => {
        setIsExiting(true);
        // Wait for animation to complete before removing
        setTimeout(() => {
            onDismiss(notification.id);
        }, 200);
    };

    // Handle action button click
    const handleAction = () => {
        if (notification.action?.onClick) {
            notification.action.onClick();
        }
        handleDismiss();
    };

    return (
        <div
            className={`
                max-w-sm w-full pointer-events-auto
                border rounded-lg shadow-lg overflow-hidden
                ${config.colorClass}
                ${isExiting ? 'animate-fade-out' : 'animate-slide-in-right'}
            `}
            role="alert"
            aria-live="assertive"
        >
            <div className="p-4">
                <div className="flex items-start">
                    {/* Icon */}
                    <div className={`flex-shrink-0 ${config.iconColor}`}>
                        <Icon />
                    </div>

                    {/* Content */}
                    <div className="ml-3 flex-1">
                        <p className="text-sm font-medium">
                            {notification.title}
                        </p>
                        {notification.message && (
                            <p className="mt-1 text-sm opacity-90">
                                {notification.message}
                            </p>
                        )}
                        {/* Action button */}
                        {notification.action && (
                            <div className="mt-2">
                                <button
                                    onClick={handleAction}
                                    className="text-sm font-medium underline hover:no-underline focus:outline-none"
                                >
                                    {notification.action.label}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Dismiss button */}
                    {notification.dismissible !== false && (
                        <div className="ml-4 flex-shrink-0">
                            <button
                                onClick={handleDismiss}
                                className="inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 opacity-70 hover:opacity-100 transition-opacity"
                                aria-label="Dismiss notification"
                            >
                                <CloseIcon />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Toast;
