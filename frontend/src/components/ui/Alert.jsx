import { useState } from 'react';

/**
 * Alert Component
 * 
 * Inline alert for displaying messages within forms or content areas.
 * Supports success, error, warning, and info variants with optional dismiss.
 * 
 * Requirements: 2.1, 2.2, 2.3
 */

// Icon components for each alert type
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

// Alert configuration by type
export const ALERT_CONFIG = {
    success: {
        colorClass: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        iconColor: 'text-emerald-500',
        icon: CheckCircleIcon,
    },
    error: {
        colorClass: 'bg-red-50 border-red-200 text-red-800',
        iconColor: 'text-red-500',
        icon: XCircleIcon,
    },
    warning: {
        colorClass: 'bg-amber-50 border-amber-200 text-amber-800',
        iconColor: 'text-amber-500',
        icon: AlertTriangleIcon,
    },
    info: {
        colorClass: 'bg-sky-50 border-sky-200 text-sky-800',
        iconColor: 'text-sky-500',
        icon: InfoIcon,
    },
};

/**
 * Get alert configuration for a given type
 * @param {string} type - Alert type (success, error, warning, info)
 * @returns {Object} Alert configuration
 */
export function getAlertConfig(type) {
    return ALERT_CONFIG[type] || ALERT_CONFIG.info;
}

/**
 * Alert component for inline messages
 * @param {Object} props
 * @param {'success' | 'error' | 'warning' | 'info'} props.type - Alert type
 * @param {string} [props.title] - Optional title
 * @param {string} props.message - Alert message
 * @param {boolean} [props.dismissible=false] - Whether alert can be dismissed
 * @param {Function} [props.onDismiss] - Callback when alert is dismissed
 * @param {string} [props.className] - Additional CSS classes
 */
export function Alert({ 
    type = 'info', 
    title, 
    message, 
    dismissible = false, 
    onDismiss,
    className = '' 
}) {
    const [isDismissed, setIsDismissed] = useState(false);
    const config = getAlertConfig(type);
    const Icon = config.icon;

    const handleDismiss = () => {
        setIsDismissed(true);
        if (onDismiss) {
            onDismiss();
        }
    };

    if (isDismissed) {
        return null;
    }

    return (
        <div
            className={`
                border rounded-lg p-4
                ${config.colorClass}
                ${className}
            `}
            role="alert"
        >
            <div className="flex">
                {/* Icon */}
                <div className={`flex-shrink-0 ${config.iconColor}`}>
                    <Icon />
                </div>

                {/* Content */}
                <div className="ml-3 flex-1">
                    {title && (
                        <h3 className="text-sm font-medium">
                            {title}
                        </h3>
                    )}
                    <p className={`text-sm ${title ? 'mt-1' : ''}`}>
                        {message}
                    </p>
                </div>

                {/* Dismiss button */}
                {dismissible && (
                    <div className="ml-4 flex-shrink-0">
                        <button
                            onClick={handleDismiss}
                            className="inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 opacity-70 hover:opacity-100 transition-opacity"
                            aria-label="Dismiss alert"
                        >
                            <CloseIcon />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Alert;
