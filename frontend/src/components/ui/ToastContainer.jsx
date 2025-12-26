import { useNotification } from '../../contexts/NotificationContext';
import { Toast } from './Toast';

/**
 * ToastContainer Component
 * 
 * Container for displaying stacked toast notifications.
 * Positioned fixed in top-right corner with vertical stacking.
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
            className="fixed top-4 right-4 z-50 flex flex-col gap-3 pointer-events-none"
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
