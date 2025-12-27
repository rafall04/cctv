import { useNotification } from '../../contexts/NotificationContext';
import { Toast } from './Toast';

/**
 * ToastContainer Component
 * 
 * Container for displaying stacked toast notifications.
 * Positioned fixed in top-right corner with vertical stacking.
 * On mobile, positioned below the header (top-20 = 80px) to avoid overlap.
 * On desktop (lg+), positioned at top-4 since there's no fixed header.
 * 
 * Requirements: 1.6
 */
export function ToastContainer() {
    const { notifications, dismissNotification } = useNotification();

    if (notifications.length === 0) {
        return null;
    }

    return (
        <div
            aria-live="polite"
            aria-label="Notifications"
            className="fixed top-20 lg:top-4 right-4 z-[60] flex flex-col gap-3 pointer-events-none"
        >
            {notifications.map((notification) => (
                <Toast
                    key={notification.id}
                    notification={notification}
                    onDismiss={dismissNotification}
                />
            ))}
        </div>
    );
}

export default ToastContainer;
