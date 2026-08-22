/*
 * Purpose: The admin add/edit camera form, rendered through the one dialog shell (ui/Modal).
 * Caller: CameraManagement page.
 * Deps: ui/Modal + ui/Button, ui/Alert, the four camera field sections.
 * MainFuncs: CameraFormModal.
 * SideEffects: None of its own — the shell owns focus trap, Escape and the body scroll lock.
 *
 * WHY THIS IS NOT A HAND-ROLLED PANEL ANY MORE
 * It used to rebuild the scrim, the panel, the header, the close button and the focus-trap wiring
 * itself. Two things that cost the operator real behaviour came with that: it never set
 * `document.body.overflow`, so a touch-drag aimed at this (tall) form scrolled the 750-row camera
 * LIST underneath it; and it capped at `max-h-[90vh]`, where `vh` still counts the mobile URL bar,
 * so the panel could reach past the visible viewport. ui/Modal fixes both (92dvh + scroll lock) and
 * every admin dialog then behaves the same way.
 *
 * `dismissible={false}` is deliberately the OPPOSITE of ui/Modal's default. This form carries an
 * RTSP URL, coordinates and the recording policy; a stray tap on the scrim next to it would throw
 * the whole draft away with nothing to undo it, so closing has to be deliberate — Batal or the
 * shell's own Escape are not offered here at all.
 *
 * The footer Simpan sits OUTSIDE <form>, joined to it only by `form="camera-form"`. A stale id does
 * not throw; the button just silently stops saving, which is why CameraManagement.test.jsx asserts
 * the association directly.
 */

import { Alert, Button, Modal } from '../../ui';
import CameraBasicFields from './CameraBasicFields';
import CameraSourceFields from './CameraSourceFields';
import CameraLocationSection from './CameraLocationSection';
import CameraRecordingSection from './CameraRecordingSection';

export default function CameraFormModal({
    show,
    editingCamera,
    areas,
    formData,
    modalError,
    isSubmitting,
    loadingDetail = false,
    getFieldError,
    onClose,
    onSubmit,
    onChange,
    onBlur,
    setFieldValue,
    setModalError,
}) {
    if (!show) {
        return null;
    }

    // Edit opens instantly with row data; the full detail (RTSP) streams in a beat
    // later. Block submit until it lands so an internal camera's RTSP can't be wiped.
    const submitDisabled = isSubmitting || loadingDetail;

    return (
        <Modal
            title={editingCamera ? 'Edit Camera' : 'Add Camera'}
            description="Configure stream source"
            size="md"
            onClose={onClose}
            dismissible={false}
            footer={(
                <>
                    <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
                    <Button
                        type="submit"
                        form="camera-form"
                        variant="primary"
                        loading={submitDisabled}
                    >
                        {isSubmitting ? 'Saving...' : (loadingDetail ? 'Memuat...' : (editingCamera ? 'Update' : 'Create'))}
                    </Button>
                </>
            )}
        >
            <form id="camera-form" onSubmit={onSubmit} className="space-y-4">
                {modalError && (
                    <Alert
                        type="error"
                        message={modalError}
                        dismissible
                        onDismiss={() => setModalError('')}
                    />
                )}

                {loadingDetail && (
                    <div className="flex items-center gap-2 rounded-card border border-primary-300 bg-primary-100 px-3 py-2 text-xs text-primary dark:bg-primary/10">
                        <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Memuat detail kamera…
                    </div>
                )}

                <CameraBasicFields
                    formData={formData}
                    areas={areas}
                    isSubmitting={isSubmitting}
                    onChange={onChange}
                    onBlur={onBlur}
                    getFieldError={getFieldError}
                />

                <CameraSourceFields
                    formData={formData}
                    isSubmitting={isSubmitting}
                    onChange={onChange}
                    onBlur={onBlur}
                    getFieldError={getFieldError}
                />

                <CameraLocationSection
                    latitude={formData.latitude}
                    longitude={formData.longitude}
                    isSubmitting={isSubmitting}
                    onLocationChange={(lat, lng) => {
                        setFieldValue('latitude', lat);
                        setFieldValue('longitude', lng);
                    }}
                    isTunnel={formData.is_tunnel}
                    onTunnelToggle={() => onChange({ target: { name: 'is_tunnel', value: !formData.is_tunnel, type: 'checkbox', checked: !formData.is_tunnel } })}
                />

                <CameraRecordingSection
                    formData={formData}
                    isSubmitting={isSubmitting}
                    onChange={onChange}
                />
            </form>
        </Modal>
    );
}
