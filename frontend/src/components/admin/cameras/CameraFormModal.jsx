import { Alert } from '../../ui/Alert';
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

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 my-auto max-h-[90vh] flex flex-col">
                <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700/50 flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                            {editingCamera ? 'Edit Camera' : 'Add Camera'}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Configure stream source</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 transition-colors"
                        disabled={isSubmitting}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={onSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                    {modalError && (
                        <Alert
                            type="error"
                            message={modalError}
                            dismissible
                            onDismiss={() => setModalError('')}
                        />
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

                    <div className="flex gap-3 pt-2 sticky bottom-0 bg-white dark:bg-gray-800 pb-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-primary to-primary-600 text-white font-medium rounded-xl shadow-lg shadow-primary/30 hover:from-primary-600 hover:to-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 text-sm"
                            disabled={isSubmitting}
                        >
                            {isSubmitting && (
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            )}
                            {isSubmitting ? 'Saving...' : (editingCamera ? 'Update' : 'Create')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
