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
            /*
             * left-4 WAJIB, bukan hanya right-4.
             *
             * Dengan patokan kanan saja, wadah ini lebarnya shrink-to-fit: pada font 1,5x
             * (setelan "teks besar" Android) isinya melebar, dan karena ia dipaku di kanan,
             * ia tumbuh ke KIRI menembus tepi layar. Terukur: mulai di -146px pada layar
             * 320px dan -73px pada 393px - separuh toast di luar layar, judulnya tak terbaca.
             * Membatasi kedua sisi membuat lebarnya tidak pernah bisa melewati layar, dan
             * items-end menjaga tampilannya tetap menempel kanan seperti sebelumnya.
             */
            className="fixed top-20 lg:top-4 left-4 right-4 z-toast flex flex-col items-end gap-3 pointer-events-none"
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
