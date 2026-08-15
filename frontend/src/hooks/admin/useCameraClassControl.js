/**
 * Purpose: Owns the "what class is this camera" dialog — the admin-side switch between a public
 *          community camera and an operator's own private one.
 * Caller: useCameraManagementPage (which re-exports it to the Camera Management page).
 * Deps: billingAdminService (PUT /api/admin/billing/cameras/:id/class), userService, notifications.
 * MainFuncs: useCameraClassControl.
 * SideEffects: Changes a camera's class + owner on the server; loads the user list once per open.
 *
 * WHY THIS IS ITS OWN FILE
 * ------------------------
 * The endpoint and the frontend service wrapper for this have existed since the subscriber-rental
 * work; nothing ever called them, so `owner_private` was a class the database understood and the
 * product had no way to reach. This hook is that missing call, kept out of useCameraManagementPage
 * because it owns a different endpoint family (billing admin) and its own async user list.
 *
 * SUBSCRIBER IS DELIBERATELY NOT OFFERED. The backend refuses it — subscriber class is a
 * consequence of an active subscription, and letting an admin set it here would create a rental
 * camera with no subscription behind it, which the billing engine has no way to charge or suspend.
 */

import { useCallback, useRef, useState } from 'react';
import billingAdminService from '../../services/billingAdminService';
import { userService } from '../../services/userService';
import { useNotification } from '../../contexts/NotificationContext';

export const CAMERA_CLASS_OPTIONS = [
    {
        value: 'community',
        label: 'Community (Publik)',
        hint: 'Tampil di halaman depan, peta, dan daftar stream. Rekamannya bisa dibuka publik sesuai kebijakan playback.',
    },
    {
        value: 'owner_private',
        label: 'Owner Private',
        hint: 'Hilang dari SEMUA permukaan publik. Hanya admin, pemiliknya, dan pemegang tautan playback terbitan pemiliknya yang bisa membuka.',
    },
];

export function useCameraClassControl({ onChanged } = {}) {
    const [classCamera, setClassCamera] = useState(null);
    const [classUsers, setClassUsers] = useState([]);
    const [isSavingClass, setIsSavingClass] = useState(false);
    const [classError, setClassError] = useState('');
    // The user list does not change while the page is open, and this dialog is opened repeatedly
    // while an admin sorts out a batch of cameras. Fetch once, reuse.
    const usersLoadedRef = useRef(false);

    const { success, error: showError } = useNotification();

    const openClassModal = useCallback(async (camera) => {
        setClassError('');
        setClassCamera(camera);

        if (usersLoadedRef.current) {
            return;
        }
        try {
            const response = await userService.getAllUsers();
            if (response?.success && Array.isArray(response.data)) {
                usersLoadedRef.current = true;
                setClassUsers(response.data);
            }
        } catch {
            /*
             * An empty owner list is a visible, self-explaining state in the dialog ("gagal memuat
             * daftar pengguna"), and the class change is still possible for `community`, which needs
             * no owner. A toast on top of that would be the same news twice.
             */
            setClassUsers([]);
        }
    }, []);

    const closeClassModal = useCallback(() => {
        setClassCamera(null);
        setClassError('');
    }, []);

    const saveCameraClass = useCallback(async ({ cameraClass, ownerUserId }) => {
        if (!classCamera) {
            return;
        }

        setIsSavingClass(true);
        setClassError('');
        try {
            // owner_user_id is required by the backend for owner_private and meaningless for
            // community, where it is cleared along with any billing state.
            const payload = cameraClass === 'owner_private'
                ? { camera_class: cameraClass, owner_user_id: Number(ownerUserId) }
                : { camera_class: cameraClass };
            const result = await billingAdminService.setCameraClass(classCamera.id, payload);

            if (!result?.success) {
                setClassError(result?.message || 'Gagal mengubah kelas kamera');
                return;
            }

            success('Kelas kamera diperbarui', `${classCamera.name} sekarang ${cameraClass === 'owner_private' ? 'privat (tidak tampil di publik)' : 'kamera komunitas'}.`);
            setClassCamera(null);
            await onChanged?.();
        } catch (error) {
            const message = error.response?.data?.message || 'Gagal mengubah kelas kamera';
            setClassError(message);
            showError('Gagal mengubah kelas kamera', message);
        } finally {
            setIsSavingClass(false);
        }
    }, [classCamera, onChanged, showError, success]);

    return {
        classCamera,
        classUsers,
        classError,
        isSavingClass,
        openClassModal,
        closeClassModal,
        saveCameraClass,
        setClassError,
    };
}

export default useCameraClassControl;
