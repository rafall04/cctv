import { useEffect, useState } from 'react';
import { recordingDurationOptions } from '../../../utils/admin/cameraFormAdapter';

function formatFileSize(bytes) {
    if (bytes === 0) {
        return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const index = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, index)) * 100) / 100} ${sizes[index]}`;
}

function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function RecordingQuickEditCard({
    recording,
    onStartRecording,
    onStopRecording,
    onUpdateSettings,
    updatingCameraId,
}) {
    const cameraId = recording.id || recording.camera_id;
    const isRecording = recording.runtime_status?.isRecording || recording.recording_status === 'recording';
    const segmentCount = recording.storage?.segmentCount || recording.segment_count || 0;
    const totalSize = recording.storage?.totalSize || recording.total_size || 0;
    const oldestSegment = recording.storage?.oldestSegment || recording.oldest_segment;
    const newestSegment = recording.storage?.newestSegment || recording.newest_segment;
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState({
        enable_recording: recording.enable_recording === 1 || recording.enable_recording === true,
        recording_duration_hours: recording.recording_duration_hours || 5,
    });

    const isSaving = updatingCameraId === cameraId;

    useEffect(() => {
        if (isEditing) {
            return;
        }

        setDraft({
            enable_recording: recording.enable_recording === 1 || recording.enable_recording === true,
            recording_duration_hours: recording.recording_duration_hours || 5,
        });
    }, [isEditing, recording.enable_recording, recording.recording_duration_hours]);

    const handleDraftChange = (field, value) => {
        setDraft((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const handleCancel = () => {
        setDraft({
            enable_recording: recording.enable_recording === 1 || recording.enable_recording === true,
            recording_duration_hours: recording.recording_duration_hours || 5,
        });
        setIsEditing(false);
    };

    const handleSave = async () => {
        await onUpdateSettings(cameraId, {
            enable_recording: draft.enable_recording,
            recording_duration_hours: Number(draft.recording_duration_hours) || 5,
        });
        setIsEditing(false);
    };

    return (
        <div key={cameraId} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-800/70 md:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold leading-tight text-gray-900 dark:text-white">
                            {recording.name || recording.camera_name}
                        </h3>
                        <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-700 dark:bg-gray-700/90 dark:text-gray-100">
                            {recording.stream_source || 'internal'}
                        </span>
                        {(recording.enabled === 0 || recording.enabled === false) && (
                            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">
                                Disabled
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-200">
                        {recording.location || 'No location'}
                    </p>
                </div>
                <div
                    data-testid={`recording-status-${cameraId}`}
                    className={`inline-flex shrink-0 self-start rounded-full px-3 py-1 text-xs font-semibold ${
                        isRecording
                            ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-100'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-700/90 dark:text-gray-100'
                    }`}
                >
                    {isRecording ? 'Recording' : 'Stopped'}
                </div>
            </div>

            <div className="mb-4 space-y-2.5">
                <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-200">Duration:</span>
                    <span className="text-gray-900 dark:text-white">{recording.recording_duration_hours || 5}h</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-200">Recording Enabled:</span>
                    <span className="text-gray-900 dark:text-white">
                        {recording.enable_recording === 1 || recording.enable_recording === true ? 'Yes' : 'No'}
                    </span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-200">Segments:</span>
                    <span className="text-gray-900 dark:text-white">{segmentCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-200">Total Size:</span>
                    <span className="text-gray-900 dark:text-white">{formatFileSize(totalSize)}</span>
                </div>
                {oldestSegment && (
                    <div className="flex justify-between text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-200">Oldest:</span>
                        <span className="text-gray-900 dark:text-white">{formatTimestamp(oldestSegment)}</span>
                    </div>
                )}
                {newestSegment && (
                    <div className="flex justify-between text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-200">Newest:</span>
                        <span className="text-gray-900 dark:text-white">{formatTimestamp(newestSegment)}</span>
                    </div>
                )}
            </div>

            <div className="space-y-3">
                {isEditing ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/10">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-semibold text-gray-900 dark:text-white">Quick Edit Recording</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Ubah setting rekaman tanpa keluar dari dashboard.</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-700 dark:text-gray-300">Aktifkan Rekaman</span>
                                <button
                                    type="button"
                                    onClick={() => handleDraftChange('enable_recording', !draft.enable_recording)}
                                    disabled={isSaving}
                                    aria-label="Aktifkan Rekaman"
                                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                                        draft.enable_recording ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'
                                    }`}
                                >
                                    <div
                                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                                            draft.enable_recording ? 'left-5' : 'left-0.5'
                                        }`}
                                    />
                                </button>
                            </div>

                            {draft.enable_recording && (
                                <div>
                                    <label htmlFor={`recording-duration-${cameraId}`} className="mb-2 block text-sm text-gray-700 dark:text-gray-300">
                                        Durasi Penyimpanan
                                    </label>
                                    <select
                                        id={`recording-duration-${cameraId}`}
                                        value={draft.recording_duration_hours}
                                        onChange={(event) => handleDraftChange('recording_duration_hours', event.target.value)}
                                        disabled={isSaving}
                                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-red-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    >
                                        {recordingDurationOptions.map((group) => (
                                            <optgroup key={group.label} label={group.label}>
                                                {group.options.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                                >
                                    {isSaving ? 'Menyimpan...' : 'Simpan'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    disabled={isSaving}
                                    className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                                >
                                    Batal
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        disabled={isSaving}
                        className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
                    >
                        Pengaturan Rekaman
                    </button>
                )}

                {isRecording ? (
                    <button
                        onClick={() => onStopRecording(cameraId)}
                        disabled={isSaving}
                        className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                        Stop Recording
                    </button>
                ) : (
                    <button
                        onClick={() => onStartRecording(cameraId)}
                        disabled={isSaving}
                        className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                    >
                        Start Recording
                    </button>
                )}
            </div>
        </div>
    );
}

export default function RecordingCameraGrid({
    recordings,
    onStartRecording,
    onStopRecording,
    onUpdateSettings,
    updatingCameraId = null,
}) {
    if (recordings.length === 0) {
        return (
            <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700/50 dark:bg-gray-800/60">
                <p className="text-gray-600 dark:text-gray-300">Tidak ada kamera dengan recording enabled</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
            {recordings.map((recording) => (
                <RecordingQuickEditCard
                    key={recording.id || recording.camera_id}
                    recording={recording}
                    onStartRecording={onStartRecording}
                    onStopRecording={onStopRecording}
                    onUpdateSettings={onUpdateSettings}
                    updatingCameraId={updatingCameraId}
                />
            ))}
        </div>
    );
}
