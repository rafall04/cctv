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
 *
 * LAPISAN: `z-toast` (1400), bukan angka mentah.
 *
 * Tiernya pernah dinaikkan di tailwind.config.js — komentarnya sendiri mencatat "modal was 60
 * and toast was 70" — tapi wadah ini tak pernah ikut pindah dan tetap di `z-[60]`. Modal duduk
 * di `z-modal` (1300), jadi SETIAP toast yang muncul saat dialog terbuka dirender di belakangnya,
 * tak terlihat. Menyimpan barang berhasil, mengabarkannya, dan operator tidak melihat apa pun.
 *
 * Umpan balik sesaat harus mengalahkan apa pun yang sedang dilaporkannya — itulah yang dikodekan
 * tier bernama. Jangan pernah menaruh angka mentah di sini lagi. Dijaga oleh adoption.test.jsx.
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
            className="fixed top-20 lg:top-4 right-4 z-toast flex flex-col gap-3 pointer-events-none"
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
