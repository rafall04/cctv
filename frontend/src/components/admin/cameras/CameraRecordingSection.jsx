import { recordingDurationOptions } from '../../../utils/admin/cameraFormAdapter';

const PUBLIC_PLAYBACK_MODES = [
    { value: 'inherit', label: 'Ikuti global' },
    { value: 'disabled', label: 'Nonaktif publik' },
    { value: 'preview_only', label: 'Preview publik' },
    { value: 'admin_only', label: 'Admin only' },
];

const PUBLIC_PLAYBACK_PREVIEW_OPTIONS = [
    { value: '', label: 'Ikuti global' },
    { value: 0, label: '0 menit (mati)' },
    { value: 10, label: '10 menit' },
    { value: 20, label: '20 menit' },
    { value: 30, label: '30 menit' },
    { value: 60, label: '60 menit' },
];

export default function CameraRecordingSection({ formData, isSubmitting, onChange }) {
    return (
        <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl space-y-3">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/20 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <circle cx="12" cy="12" r="10" />
                        <circle cx="12" cy="12" r="3" fill="currentColor" />
                    </svg>
                </div>
                <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Pengaturan Rekaman</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Rolling buffer 1 jam - 3 bulan</p>
                </div>
            </div>

            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">Aktifkan Rekaman</span>
                <button
                    type="button"
                    onClick={() => onChange({ target: { name: 'enable_recording', value: !formData.enable_recording, type: 'checkbox', checked: !formData.enable_recording } })}
                    disabled={isSubmitting}
                    className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 shrink-0 ${formData.enable_recording ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${formData.enable_recording ? 'left-5' : 'left-0.5'}`}></div>
                </button>
            </div>

            {formData.enable_recording && (
                <div>
                    <label htmlFor="camera-recording-duration" className="block text-sm text-gray-700 dark:text-gray-300 mb-2">Durasi Penyimpanan</label>
                    <select
                        id="camera-recording-duration"
                        name="recording_duration_hours"
                        value={formData.recording_duration_hours || 5}
                        onChange={onChange}
                        disabled={isSubmitting}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                    >
                        {recordingDurationOptions.map((group) => (
                            <optgroup key={group.label} label={group.label}>
                                {group.options.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        File lama otomatis terhapus sesuai durasi. Estimasi untuk 1080p@25fps.
                    </p>
                </div>
            )}

            <div className="border-t border-red-200 dark:border-red-500/20 pt-3 space-y-3">
                <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Akses Playback Publik</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Atur apakah kamera ini mengikuti global, tampil preview terbatas, admin only, atau mati di publik.
                    </p>
                </div>

                <div>
                    <label htmlFor="camera-public-playback-mode" className="block text-sm text-gray-700 dark:text-gray-300 mb-2">
                        Mode Playback Publik
                    </label>
                    <select
                        id="camera-public-playback-mode"
                        name="public_playback_mode"
                        value={formData.public_playback_mode || 'inherit'}
                        onChange={onChange}
                        disabled={isSubmitting}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                    >
                        {PUBLIC_PLAYBACK_MODES.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="camera-public-playback-preview" className="block text-sm text-gray-700 dark:text-gray-300 mb-2">
                        Batas Preview Publik
                    </label>
                    <select
                        id="camera-public-playback-preview"
                        name="public_playback_preview_minutes"
                        value={formData.public_playback_preview_minutes ?? ''}
                        onChange={onChange}
                        disabled={isSubmitting}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                    >
                        {PUBLIC_PLAYBACK_PREVIEW_OPTIONS.map((option) => (
                            <option key={String(option.value)} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Dipakai hanya saat mode kamera `preview_only`. Durasi mengikuti kelipatan segment 10 menit.
                    </p>
                </div>
            </div>
        </div>
    );
}
