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
            /*
             * bg-surface-overlay LEBIH DULU, dan ia wajib: tint status hanya 10% alpha, jadi
             * tanpa latar opak di bawahnya toast ini 90% tembus pandang dan teks halaman di
             * belakangnya ikut terbaca menumpuk. Tintnya menumpang di div dalam.
             */
            className={`
                max-w-sm w-full pointer-events-auto
                border rounded-control shadow-e2 overflow-hidden
                bg-surface-overlay
                ${config.frameClass}
                ${isExiting ? 'animate-fade-out' : 'animate-slide-in-right'}
            `}
            role="alert"
            aria-live="assertive"
        >
            <div className={`p-4 ${config.tintClass}`}>
                <div className="flex items-start">
                    {/* Icon */}
                    <div className={`flex-shrink-0 ${config.iconColor}`}>
                        <Icon />
                    </div>

                    {/* Content */}
                    {/* min-w-0: tanpa ini flex item TIDAK BISA menciut di bawah lebar
                        min-content-nya, dan break-words di dalamnya tidak berpengaruh sama
                        sekali - pesan galat bertoken panjang tetap memaksa lebar. Terukur:
                        isinya 152px lebih lebar dari toast-nya pada font 1,5x di layar
                        320px. Jerat yang sama sudah pernah memakan <fieldset> di repo ini. */}
                    <div className="ml-3 min-w-0 flex-1">
                        {/* break-words: pesan galat nyata penuh token tanpa spasi - nama
                            berkas, URL, kode server - dan tanpa ini ia memaksa lebar toast. */}
                        <p className="break-words text-sm font-medium">
                            {notification.title}
                        </p>
                        {notification.message && (
                            <p className="mt-1 break-words text-sm opacity-90">
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
                                /* min 24x24: WCAG 2.5.8. Ikonnya 16px, dan tanpa padding
                                   sasarannya ikut 16px - di bawah ambang. Toast menutupi sudut
                                   layar dan hilang sendiri dalam 5-8 detik, jadi ketukan yang
                                   meleset menekan apa pun yang ada DI BAWAHNYA. -m-1 menjaga
                                   posisi visualnya tidak bergeser. */
                                className="-m-1 inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded-md p-1 focus:outline-none focus:ring-2 focus:ring-offset-2 opacity-70 hover:opacity-100 transition-opacity"
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
