/*
Purpose: Admin dashboard for monitoring and controlling CCTV recording state.
Caller: Admin router recording page.
Deps: recordingService, NotificationContext, recording dashboard data hook, recording UI components, components/ui (PageHeader/Button).
MainFuncs: RecordingDashboard(), recording start/stop/settings handlers.
SideEffects: Calls recording APIs, refreshes dashboard data, displays operator notifications.
*/

import { useState } from 'react';
import recordingService from '../services/recordingService';
import { useNotification } from '../contexts/NotificationContext';
import { Button, PageHeader } from '../components/ui';
import { TableSkeleton, StatCardSkeleton } from '../components/ui/Skeleton';
import { useRecordingDashboardData } from '../hooks/admin/useRecordingDashboardData';
import RecordingSummaryCards from '../components/admin/recordings/RecordingSummaryCards';
import RecordingHealthPanel from '../components/admin/recordings/RecordingHealthPanel';
import RecordingCapacityPanel from '../components/admin/recordings/RecordingCapacityPanel';
import RecordingStorageSettings from '../components/admin/recordings/RecordingStorageSettings';
import RecordingAssuranceSummary from '../components/admin/recordings/RecordingAssuranceSummary';
import RecordingAssuranceTable from '../components/admin/recordings/RecordingAssuranceTable';
import RecordingCameraGrid from '../components/admin/recordings/RecordingCameraGrid';
import RecordingRestartLogs from '../components/admin/recordings/RecordingRestartLogs';

function RecordingLoadingState() {
    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:gap-6">
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
            </div>
            <TableSkeleton rows={8} columns={6} />
        </div>
    );
}

export default function RecordingDashboard() {
    const { success, error: notifyError } = useNotification();
    const [updatingCameraId, setUpdatingCameraId] = useState(null);
    const {
        recordings,
        restartLogs,
        assurance,
        loading,
        error,
        refreshError,
        lastSuccessfulUpdate,
        summary,
        fetchData,
    } = useRecordingDashboardData();

    const formatLastUpdate = (date) => {
        if (!date) return 'Belum ada data';
        const diff = Math.floor((Date.now() - date.getTime()) / 1000);
        if (diff < 60) return 'Baru saja';
        if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
        return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    };

    const handleStartRecording = async (cameraId) => {
        try {
            const response = await recordingService.startRecording(cameraId);
            if (response.success) {
                success('Recording Dimulai', `Kamera ${cameraId} mulai direkam.`);
                fetchData({ mode: 'initial' });
            }
        } catch (error) {
            notifyError('Gagal Memulai Recording', error.response?.data?.message || 'Failed to start recording');
        }
    };

    const handleStopRecording = async (cameraId) => {
        try {
            const response = await recordingService.stopRecording(cameraId);
            if (response.success) {
                success('Recording Dihentikan', `Kamera ${cameraId} berhenti direkam.`);
                fetchData({ mode: 'initial' });
            }
        } catch (error) {
            notifyError('Gagal Menghentikan Recording', error.response?.data?.message || 'Failed to stop recording');
        }
    };

    const handleUpdateSettings = async (cameraId, settings) => {
        try {
            setUpdatingCameraId(cameraId);
            const response = await recordingService.updateRecordingSettings(cameraId, settings);
            if (response.success) {
                success('Pengaturan Recording Tersimpan', `Pengaturan kamera ${cameraId} berhasil diperbarui.`);
                await fetchData({ mode: 'initial' });
            }
        } catch (error) {
            notifyError('Gagal Menyimpan Recording', error.response?.data?.message || 'Failed to update recording settings');
            throw error;
        } finally {
            setUpdatingCameraId(null);
        }
    };

    if (loading) {
        return <RecordingLoadingState />;
    }

    return (
        <div className="space-y-4 md:space-y-6">
            {/*
              * The `rounded-2xl border bg-surface p-5` panel this header used to sit in is GONE, and
              * that is the point of the migration here rather than a side effect of it. This was the
              * only admin route that boxed its own title: measured against the same header bare, the
              * panel cost the title 42px of line at 320px and 62px at 320px/1.5x (288 -> 246,
              * 272 -> 210) and turned "Dasbor Rekaman" into a two-line title on a phone. It also said
              * the wrong thing — the surface/edge tokens mark a content GROUPING, so panelling the h1
              * filed the page's own identity as one of its sections. See PageHeader.jsx.
              *
              * The timestamp goes to `meta` and the button to `actions`: one is state, the other is a
              * control, and they were only adjacent before because both were "the right-hand side".
              */}
            <PageHeader
                eyebrow="Recording Overview"
                title="Dasbor Rekaman"
                description="Monitor recording aktif, kapasitas segmen, dan auto-restart kamera."
                meta={(
                    <span className="rounded-full bg-surface-sunken px-3 py-1.5 font-mono text-xs font-medium tabular-nums text-content-muted">
                        Update terakhir: {formatLastUpdate(lastSuccessfulUpdate)}
                    </span>
                )}
                actions={(
                    <Button
                        onClick={() => fetchData({ mode: 'initial' })}
                        icon={(
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        )}
                    >
                        Refresh
                    </Button>
                )}
            />

            {refreshError && !error && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                    Refresh background gagal. Data terakhir yang valid tetap ditampilkan.
                </div>
            )}

            {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-500/30 dark:bg-red-500/10">
                    <div className="flex items-center gap-3">
                        <svg className="w-6 h-6 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <h3 className="font-semibold text-red-700 dark:text-red-400">Error Loading Data</h3>
                            <p className="mt-1 text-sm text-red-600 dark:text-red-300">{error}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => fetchData({ mode: 'initial' })}
                        className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
                    >
                        Retry
                    </button>
                </div>
            )}

            <RecordingSummaryCards summary={summary} />
            <RecordingCapacityPanel />

            <RecordingStorageSettings />
            <RecordingHealthPanel />
            <RecordingAssuranceSummary summary={assurance?.summary} />
            <RecordingAssuranceTable cameras={assurance?.cameras || []} />
            <RecordingCameraGrid
                recordings={recordings}
                onStartRecording={handleStartRecording}
                onStopRecording={handleStopRecording}
                onUpdateSettings={handleUpdateSettings}
                updatingCameraId={updatingCameraId}
            />
            <RecordingRestartLogs logs={restartLogs} />
        </div>
    );
}
