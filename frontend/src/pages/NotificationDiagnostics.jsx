/*
Purpose: Render admin workflow for Telegram camera notification routing preview, drill delivery, and recent diagnostic audit rows.
Caller: App.jsx protected /admin/notification-diagnostics route.
Deps: adminService, cameraService, React hooks, TimezoneContext, Tailwind admin UI classes.
MainFuncs: NotificationDiagnostics.
SideEffects: Fetches cameras/diagnostics and can trigger Telegram diagnostic drill sends.
*/

import { useEffect, useMemo, useState } from 'react';
import { adminService } from '../services/adminService';
import { cameraService } from '../services/cameraService';
import { TIMESTAMP_STORAGE, useTimezone } from '../contexts/TimezoneContext';

const EVENT_OPTIONS = [
    { value: 'offline', label: 'Offline' },
    { value: 'online', label: 'Online' },
];

function statusTone(success) {
    return success ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300';
}

export default function NotificationDiagnostics() {
    const { formatDateTime, timezone } = useTimezone();
    const [cameras, setCameras] = useState([]);
    const [cameraId, setCameraId] = useState('');
    const [eventType, setEventType] = useState('offline');
    const [preview, setPreview] = useState(null);
    const [runs, setRuns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [drilling, setDrilling] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        let mounted = true;
        async function loadInitialData() {
            const [cameraResponse, runsResponse] = await Promise.all([
                cameraService.getAllCameras(),
                adminService.getNotificationDiagnosticsRuns({ limit: 20 }),
            ]);
            if (!mounted) return;
            if (cameraResponse.success) {
                setCameras(cameraResponse.data || []);
            }
            if (runsResponse.success) {
                setRuns(runsResponse.data || []);
            }
        }
        loadInitialData();
        return () => {
            mounted = false;
        };
    }, []);

    const selectedCameraId = useMemo(() => Number.parseInt(cameraId, 10), [cameraId]);
    const canPreview = Number.isInteger(selectedCameraId) && selectedCameraId > 0;
    const canDrill = Boolean(preview?.routing?.canSend && canPreview && !drilling);
    const timezoneLabel = !timezone || timezone === 'Asia/Jakarta' ? 'WIB' : timezone;

    function formatRuntimeTimestamp(value) {
        if (!value) return '-';
        return formatDateTime(value, { storage: TIMESTAMP_STORAGE.LOCAL_SQL });
    }

    function formatAuditTimestamp(value) {
        if (!value) return '-';
        return formatDateTime(value, { storage: TIMESTAMP_STORAGE.UTC_SQL });
    }

    async function refreshRuns() {
        const response = await adminService.getNotificationDiagnosticsRuns({ cameraId: selectedCameraId || '', limit: 20 });
        if (response.success) {
            setRuns(response.data || []);
        }
    }

    async function handlePreview() {
        if (!canPreview) return;
        setLoading(true);
        setError('');
        setMessage('');
        const response = await adminService.previewNotificationDiagnostics({ cameraId: selectedCameraId, eventType });
        setLoading(false);
        if (!response.success) {
            setError(response.message);
            setPreview(null);
            return;
        }
        setPreview(response.data);
    }

    async function handleDrill() {
        if (!canDrill) return;
        setDrilling(true);
        setError('');
        setMessage('');
        const response = await adminService.runNotificationDiagnosticsDrill({ cameraId: selectedCameraId, eventType });
        setDrilling(false);
        if (!response.success) {
            setError(response.message || response.data?.skippedReason || 'Diagnostic drill failed');
        } else {
            setMessage('Diagnostic drill terkirim ke target Telegram yang match.');
        }
        await refreshRuns();
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notification Diagnostics</h1>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    Preview routing dan kirim drill Telegram untuk memastikan CCTV masuk ke grup yang tepat.
                </p>
            </div>

            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="grid gap-4 md:grid-cols-[1fr_180px_auto_auto] md:items-end">
                    <label className="block">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">CCTV</span>
                        <select
                            aria-label="CCTV"
                            value={cameraId}
                            onChange={(event) => {
                                setCameraId(event.target.value);
                                setPreview(null);
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                        >
                            <option value="">Pilih CCTV</option>
                            {cameras.map((camera) => (
                                <option key={camera.id} value={camera.id}>
                                    {camera.name} {camera.area_name ? `- ${camera.area_name}` : ''}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Event</span>
                        <select
                            aria-label="Event"
                            value={eventType}
                            onChange={(event) => {
                                setEventType(event.target.value);
                                setPreview(null);
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                        >
                            {EVENT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>

                    <button
                        type="button"
                        onClick={handlePreview}
                        disabled={!canPreview || loading}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900"
                    >
                        {loading ? 'Loading...' : 'Preview Routing'}
                    </button>

                    <button
                        type="button"
                        onClick={handleDrill}
                        disabled={!canDrill}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {drilling ? 'Mengirim...' : `Kirim Drill ${eventType === 'offline' ? 'Offline' : 'Online'}`}
                    </button>
                </div>
            </section>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
            {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{message}</div>}

            {preview && (
                <section className="grid gap-4 lg:grid-cols-3">
                    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Camera Health</h2>
                        <dl className="mt-3 space-y-2 text-sm">
                            <div className="flex justify-between gap-3"><dt className="text-gray-500">Camera</dt><dd className="font-semibold text-gray-900 dark:text-white">{preview.camera.name}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-gray-500">Area</dt><dd className="text-gray-900 dark:text-white">{preview.camera.areaName}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-gray-500">Status</dt><dd className="text-gray-900 dark:text-white">{preview.health.status}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-gray-500">Last Check ({timezoneLabel})</dt><dd className="text-gray-900 dark:text-white">{formatRuntimeTimestamp(preview.health.lastCheckedAt)}</dd></div>
                        </dl>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Matched Targets</h2>
                        {preview.routing.matchedTargets.length === 0 ? (
                            <p className="mt-3 text-sm text-red-600 dark:text-red-300">{preview.routing.skippedReason || 'Tidak ada target match'}</p>
                        ) : (
                            <ul className="mt-3 space-y-2">
                                {preview.routing.matchedTargets.map((target) => (
                                    <li key={target.id} className="rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-950">
                                        <span className="font-semibold text-gray-900 dark:text-white">{target.name}</span>
                                        <span className="ml-2 text-gray-500">{target.chatIdMasked}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Matched Rules</h2>
                        <ul className="mt-3 space-y-2 text-sm">
                            {preview.routing.matchedRules.map((rule) => (
                                <li key={rule.id} className="rounded-md bg-emerald-50 p-2 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                    {rule.id} - {rule.targetName} - {rule.scope}
                                </li>
                            ))}
                            {preview.routing.matchedRules.length === 0 && <li className="text-gray-500">Tidak ada rule match.</li>}
                        </ul>
                    </div>
                </section>
            )}

            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Recent Diagnostic Runs</h2>
                <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500">
                                <th className="py-2 pr-4">Time ({timezoneLabel})</th>
                                <th className="py-2 pr-4">Camera</th>
                                <th className="py-2 pr-4">Event</th>
                                <th className="py-2 pr-4">Targets</th>
                                <th className="py-2 pr-4">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {runs.map((run) => (
                                <tr key={run.id}>
                                    <td className="py-2 pr-4 text-gray-500">{formatAuditTimestamp(run.createdAt)}</td>
                                    <td className="py-2 pr-4 text-gray-900 dark:text-white">{run.cameraName}</td>
                                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{run.eventType}</td>
                                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{run.sentCount}/{run.targetCount}</td>
                                    <td className={`py-2 pr-4 font-semibold ${statusTone(run.success)}`}>
                                        {run.success ? 'Sent' : (run.skippedReason || 'Failed')}
                                    </td>
                                </tr>
                            ))}
                            {runs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="py-6 text-center text-gray-500">Belum ada diagnostic run.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
