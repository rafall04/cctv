/*
 * Purpose: One dialog for "who can see this camera", adapting to what the camera actually is:
 *          a class switch for community/owner_private, a publish switch for a rented camera.
 * Caller: CameraManagement page.
 * Deps: ui/Modal + ui/Button, Alert, CAMERA_CLASS_OPTIONS from useCameraClassControl.
 *
 * WHY A RENTED CAMERA GETS A DIFFERENT — AND ONE-WAY — CONTROL
 * Its CLASS is not the operator's to set: it is `subscriber` because a subscription exists, and
 * the backend refuses to change it. Its VISIBILITY is the operator's to REMOVE but not to grant.
 * Publishing someone else's camera to the internet is their consent to give, and they already hold
 * that switch in their own portal; taking a camera down is moderation and has no privacy downside.
 * So this side of the dialog offers one button, and the copy says plainly why the other is absent
 * rather than leaving the operator to wonder whether it is broken. Full rationale lives in
 * backend/services/subscriberCameraPublishService.js.
 *
 * The copy carries weight: this decides whether a camera is visible to the whole internet or to
 * nobody. Each option states what happens rather than naming the enum, and the private->public
 * warning exists because that transition does something the button does not look like it does.
 *
 * WHY THIS ONE KEEPS ui/Modal's DISMISSIBLE DEFAULT, unlike the camera and area FORMS
 * Nothing here is typed. Every control is a choice re-seeded from the camera row each time the
 * dialog opens (see the effect below), so a stray tap on the scrim costs one tap to reopen and
 * loses nothing — and dismissing submits nothing, which makes the accident fail safe. Forcing an
 * explicit Batal on a three-control confirm buys no protection and just adds a step.
 */

import { useEffect, useState } from 'react';
import { Alert, Button, Modal } from '../../ui';
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
    const [cameraClass, setCameraClass] = useState('community');
    const [ownerUserId, setOwnerUserId] = useState('');
    const [isPublic, setIsPublic] = useState(false);

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
        setIsPublic(camera?.is_public === 1 || camera?.is_public === true);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on open, not on every refresh
    }, [cameraId]);

    if (!camera) {
        return null;
    }

    const isSubscriber = camera.camera_class === 'subscriber';
    const needsOwner = !isSubscriber && cameraClass === 'owner_private';
    /* The transition that does more than it looks like it does — see the warning below. */
    const isOpeningUp = camera.camera_class === 'owner_private' && cameraClass === 'community';
    const isSuspended = camera.billing_status === 'suspended';
    /* A rented camera offers exactly one action, and only while there is something to undo. */
    const submitDisabled = isSaving
        || (needsOwner && !ownerUserId)
        || (isSubscriber && !isPublic);

    const handleSubmit = (event) => {
        event.preventDefault();
        onSubmit(isSubscriber
            ? { mode: 'unpublish' }
            : { mode: 'class', cameraClass, ownerUserId });
    };

    return (
        <Modal
            title={isSubscriber ? 'Visibilitas kamera sewa' : 'Kelas kamera'}
            description={camera.name}
            size="md"
            onClose={onClose}
            footer={(
                <>
                    <Button onClick={onClose} disabled={isSaving}>Batal</Button>
                    <Button
                        type="submit"
                        form="camera-class-form"
                        variant="primary"
                        loading={isSaving}
                        disabled={submitDisabled}
                    >
                        {isSaving
                            ? 'Menyimpan…'
                            : (isSubscriber ? 'Sembunyikan dari hub publik' : 'Simpan')}
                    </Button>
                </>
            )}
        >
            <form id="camera-class-form" onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <Alert type="error" message={error} dismissible onDismiss={onDismissError} />
                )}

                {isSubscriber ? (
                    <>
                        <div className="rounded-card border border-edge-strong bg-surface p-3">
                            <p className="text-sm font-medium text-content">
                                Status sekarang: {isPublic ? 'tampil di hub publik' : 'tidak tampil di hub publik'}
                                {isPublic && isSuspended ? ' (tertahan — langganan ditangguhkan)' : ''}
                            </p>
                            <p className="text-xs text-content-muted mt-1">
                                Milik pelanggan {camera.owner_username ? `“${camera.owner_username}”` : `#${camera.owner_user_id}`}.
                                Rekamannya tidak pernah publik apa pun statusnya — kamera sewa memang live-only untuk umum.
                            </p>
                        </div>

                        {/*
                          * Satu arah, disengaja. Mempublikasikan kamera pelanggan adalah
                          * persetujuan yang milik dia, dan sakelarnya sudah ada di portalnya.
                          * Alasan lengkapnya di subscriberCameraPublishService.js.
                          */}
                        {isPublic ? (
                            <Alert
                                type="warning"
                                message="Menyembunyikan kamera ini menurunkannya dari hub publik seketika. Pemiliknya bisa menampilkannya lagi kapan saja dari portalnya sendiri — ini tuas moderasi, bukan kunci."
                            />
                        ) : (
                            <p className="rounded-card border border-edge-strong bg-surface-sunken px-3 py-2 text-xs text-content-muted">
                                Hanya pelanggan pemiliknya yang bisa menampilkan kamera ini ke publik, dari portalnya
                                sendiri. Anda sengaja tidak diberi tombol itu: memajang kamera milik orang lain ke
                                internet adalah persetujuan yang bukan milik operator.
                            </p>
                        )}
                    </>
                ) : (
                    /* min-w-0: a <fieldset> refuses to shrink below its content without it, which is
                     * how a 320px dialog ends up scrolling sideways (earned on the affiliate form). */
                    <fieldset className="min-w-0 space-y-2" disabled={isSaving}>
                        <legend className="text-sm font-semibold text-content mb-1">Kelas</legend>
                        {CAMERA_CLASS_OPTIONS.map((option) => (
                            <label
                                key={option.value}
                                className={`flex gap-3 rounded-card border p-3 cursor-pointer transition-colors ${
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
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium text-content">{option.label}</span>
                                    <span className="block text-xs text-content-muted mt-0.5">{option.hint}</span>
                                </span>
                            </label>
                        ))}
                    </fieldset>
                )}

                {isOpeningUp && (
                    /*
                     * Every access gate reads camera_class as it is NOW, not as it was when the
                     * footage was recorded — true for local recordings and for the Telegram
                     * archive alike. So this switch is retroactive, which is the one thing the
                     * button does not look like it does. No hour count is shown on purpose: the
                     * camera row here comes from the LIST projection, which does not carry
                     * recording_duration_hours, and a fabricated number is worse than none.
                     */
                    <Alert
                        type="warning"
                        message="Ini juga membuka SELURUH riwayat rekaman kamera ini, bukan cuma siarannya — termasuk yang direkam selagi kamera masih privat, dan termasuk salinannya di arsip Telegram. Kalau live-nya saja yang mau publik, setel dulu Mode Playback Publik = Admin only di form kamera."
                    />
                )}

                {needsOwner && (
                    <div>
                        <label htmlFor="camera-class-owner" className="block text-sm font-semibold text-content mb-1">
                            Pemilik kamera
                        </label>
                        <select
                            id="camera-class-owner"
                            value={ownerUserId}
                            onChange={(event) => setOwnerUserId(event.target.value)}
                            disabled={isSaving || users.length === 0}
                            className="w-full rounded-card border border-edge-strong bg-surface px-4 py-2.5 text-sm text-content transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
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

                {needsOwner && (
                    <p className="rounded-card border border-edge-strong bg-surface-sunken px-3 py-2 text-xs text-content-muted">
                        Rekaman tetap berjalan seperti biasa, dan admin tetap bisa memutar ulang lewat
                        /admin/playback. Yang hilang hanya kehadirannya di permukaan publik.
                    </p>
                )}
            </form>
        </Modal>
    );
}
