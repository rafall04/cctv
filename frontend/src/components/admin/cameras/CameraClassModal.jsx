/*
 * Purpose: Dialog for switching one camera between the public community class and the operator's
 *          own private class, and for naming the user who owns it when it is private.
 * Caller: CameraManagement page.
 * Deps: useFocusTrap, Alert, CAMERA_CLASS_OPTIONS from useCameraClassControl.
 *
 * The copy here carries real weight: this is the control that decides whether a camera is visible
 * to the whole internet or to nobody but its owner, and it is a one-click change with no undo
 * prompt anywhere else in the page. Each option states what actually happens rather than naming the
 * enum value, and the private option says plainly what still keeps working (recording, admin
 * playback) so nobody avoids it thinking it turns the camera off.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert } from '../../ui/Alert';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { CAMERA_CLASS_OPTIONS } from '../../../hooks/admin/useCameraClassControl';

export default function CameraClassModal({
    camera,
    users,
    error,
    isSaving,
    onClose,
    onSubmit,
    onDismissError,
}) {
    const dialogRef = useRef(null);
    const [cameraClass, setCameraClass] = useState('community');
    const [ownerUserId, setOwnerUserId] = useState('');

    useFocusTrap(dialogRef, { active: Boolean(camera), onEscape: onClose });

    // Re-seed whenever a DIFFERENT camera opens the dialog. Keying off camera.id rather than the
    // object keeps a background list refresh (new object, same camera) from wiping a half-made
    // choice underneath the admin.
    const cameraId = camera?.id ?? null;
    useEffect(() => {
        if (cameraId === null) {
            return;
        }
        setCameraClass(camera?.camera_class === 'owner_private' ? 'owner_private' : 'community');
        setOwnerUserId(camera?.owner_user_id ? String(camera.owner_user_id) : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on open, not on every refresh
    }, [cameraId]);

    if (!camera) {
        return null;
    }

    /*
     * A rented camera's class is downstream of its subscription, so the backend refuses to set it
     * here. Showing a disabled form with a reason beats a form that submits and 400s.
     */
    const isSubscriber = camera.camera_class === 'subscriber';
    const needsOwner = cameraClass === 'owner_private';
    const submitDisabled = isSaving || isSubscriber || (needsOwner && !ownerUserId);

    const handleSubmit = (event) => {
        event.preventDefault();
        onSubmit({ cameraClass, ownerUserId });
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-modal p-4 overflow-y-auto">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Ubah kelas kamera"
                className="bg-surface w-full max-w-lg rounded-2xl shadow-2xl border border-edge my-auto max-h-[90vh] flex flex-col"
            >
                <div className="p-4 sm:p-6 border-b border-edge flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="text-lg font-bold text-content">Kelas kamera</h3>
                        <p className="text-sm text-content-muted">{camera.name}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Tutup"
                        className="p-2 rounded-lg hover:bg-surface-sunken text-content-muted transition-colors"
                        disabled={isSaving}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                    {error && (
                        <Alert type="error" message={error} dismissible onDismiss={onDismissError} />
                    )}

                    {isSubscriber ? (
                        <Alert
                            type="warning"
                            message="Kamera ini kamera sewaan pelanggan. Kelasnya mengikuti langganannya — batalkan langganan di halaman Billing dulu kalau memang mau diubah."
                        />
                    ) : (
                        <fieldset className="space-y-2" disabled={isSaving}>
                            <legend className="text-sm font-semibold text-content mb-1">Kelas</legend>
                            {CAMERA_CLASS_OPTIONS.map((option) => (
                                <label
                                    key={option.value}
                                    className={`flex gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                                        cameraClass === option.value
                                            ? 'border-primary bg-primary-100 dark:bg-primary/10'
                                            : 'border-edge-strong bg-surface hover:bg-surface-sunken'
                                    }`}
                                >
                                    <input
                                        type="radio"
                                        name="camera_class"
                                        value={option.value}
                                        checked={cameraClass === option.value}
                                        onChange={() => setCameraClass(option.value)}
                                        className="mt-1 shrink-0"
                                    />
                                    <span>
                                        <span className="block text-sm font-medium text-content">{option.label}</span>
                                        <span className="block text-xs text-content-muted mt-0.5">{option.hint}</span>
                                    </span>
                                </label>
                            ))}
                        </fieldset>
                    )}

                    {!isSubscriber && needsOwner && (
                        <div>
                            <label htmlFor="camera-class-owner" className="block text-sm font-semibold text-content mb-1">
                                Pemilik kamera
                            </label>
                            <select
                                id="camera-class-owner"
                                value={ownerUserId}
                                onChange={(event) => setOwnerUserId(event.target.value)}
                                disabled={isSaving || users.length === 0}
                                className="w-full rounded-xl border border-edge-strong bg-surface px-4 py-2.5 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                            >
                                <option value="">Pilih pemilik…</option>
                                {users.map((user) => (
                                    <option key={user.id} value={String(user.id)}>
                                        {user.username} ({user.role})
                                    </option>
                                ))}
                            </select>
                            <p className="mt-1.5 text-xs text-content-muted">
                                {users.length === 0
                                    ? 'Gagal memuat daftar pengguna — tutup dialog ini lalu coba lagi.'
                                    : 'Pemilik bisa menonton live-nya, dan tautan playback yang DIA terbitkan (cakupan "kamera terpilih") membuka rekaman kamera ini untuk keluarga. Pemilik non-staff tidak bisa membuka rekaman sendiri lewat halaman admin.'}
                            </p>
                        </div>
                    )}

                    {!isSubscriber && needsOwner && (
                        <p className="rounded-xl border border-edge-strong bg-surface-sunken px-3 py-2 text-xs text-content-muted">
                            Rekaman tetap berjalan seperti biasa, dan admin tetap bisa memutar ulang lewat
                            /admin/playback. Yang hilang hanya kehadirannya di permukaan publik.
                        </p>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 bg-surface-sunken text-content-muted font-medium rounded-xl hover:bg-surface-sunken transition-colors disabled:opacity-50 text-sm"
                            disabled={isSaving}
                        >
                            Batal
                        </button>
                        <button
                            type="submit"
                            className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-primary to-primary-600 text-white font-medium rounded-xl shadow-lg shadow-primary/30 hover:from-primary-600 hover:to-blue-700 disabled:opacity-50 transition-all text-sm"
                            disabled={submitDisabled}
                        >
                            {isSaving ? 'Menyimpan…' : 'Simpan kelas'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
