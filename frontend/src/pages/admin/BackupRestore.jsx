import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cameraService } from '../../services/cameraService';
import { areaService } from '../../services/areaService';
import { useNotification } from '../../contexts/NotificationContext';

function parseBackupFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);
                if (Array.isArray(json)) {
                    resolve(json);
                    return;
                }
                if (Array.isArray(json?.data)) {
                    resolve(json.data);
                    return;
                }
                if (Array.isArray(json?.cameras)) {
                    resolve(json.cameras);
                    return;
                }
                reject(new Error('Struktur JSON backup tidak berisi array kamera.'));
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('Gagal membaca file backup.'));
        reader.readAsText(file);
    });
}

export default function BackupRestore() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [areas, setAreas] = useState([]);
    const [loadingAreas, setLoadingAreas] = useState(true);
    const [fileName, setFileName] = useState('');
    const [backupItems, setBackupItems] = useState([]);
    const [scopeMode, setScopeMode] = useState(searchParams.get('scope') === 'unresolved_only' ? 'unresolved_only' : (searchParams.get('areaId') ? 'area_ids' : 'all'));
    const [selectedAreaId, setSelectedAreaId] = useState(searchParams.get('areaId') || '');
    const [rowFilter, setRowFilter] = useState('all');
    const [preview, setPreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const fileInputRef = useRef(null);
    const { success, error: showError } = useNotification();

    useEffect(() => {
        let mounted = true;

        const loadAreas = async () => {
            try {
                setLoadingAreas(true);
                const response = await areaService.getAllAreas();
                if (mounted && response.success) {
                    setAreas(response.data || response.areas || []);
                }
            } catch (error) {
                console.error('Load areas for backup restore error:', error);
            } finally {
                if (mounted) {
                    setLoadingAreas(false);
                }
            }
        };

        loadAreas();
        return () => {
            mounted = false;
        };
    }, []);

    const requestPayload = useMemo(() => ({
        backupFileName: fileName || null,
        backupItems,
        matchMode: 'id_then_name_area',
        applyPolicy: 'repair_existing',
        scope: {
            mode: scopeMode,
            areaIds: scopeMode === 'area_ids' && selectedAreaId ? [parseInt(selectedAreaId, 10)] : [],
        },
    }), [backupItems, fileName, scopeMode, selectedAreaId]);

    const filteredRows = useMemo(() => {
        const rows = preview?.rows || [];
        if (rowFilter === 'repairable') {
            return rows.filter((row) => row.status === 'matched_repairable');
        }
        if (rowFilter === 'issues') {
            return rows.filter((row) => row.status === 'ambiguous_matches' || row.status === 'missing_target' || row.status === 'invalid_backup_row');
        }
        if (rowFilter === 'external_only') {
            return rows.filter((row) => row.backupDeliveryType && row.backupDeliveryType !== 'internal_hls');
        }
        return rows;
    }, [preview, rowFilter]);

    const handleFileUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        try {
            const parsed = await parseBackupFile(file);
            setFileName(file.name);
            setBackupItems(parsed);
            setPreview(null);
            success('Backup Dibaca', `${parsed.length} item kamera siap dipreview untuk restore.`);
        } catch (error) {
            showError('Backup Tidak Valid', error.message || 'Gagal membaca file backup JSON.');
        }
    };

    const clearBackup = () => {
        setFileName('');
        setBackupItems([]);
        setPreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handlePreview = async () => {
        if (!backupItems.length) {
            showError('File Backup Belum Ada', 'Unggah file backup JSON terlebih dahulu.');
            return;
        }

        try {
            setPreviewLoading(true);
            const response = await cameraService.previewCameraRestore(requestPayload);
            if (response.success) {
                setPreview(response.data);
                success('Preview Restore Siap', `Terdapat ${response.data?.counts?.matched_repairable || 0} kamera yang bisa dipulihkan.`);
            }
        } catch (error) {
            showError('Preview Restore Gagal', error.response?.data?.message || error.message || 'Gagal membuat preview restore.');
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleApply = async () => {
        if (!preview?.canApply) {
            showError('Tidak Ada Perubahan', 'Preview belum berisi kamera repairable untuk dipulihkan.');
            return;
        }

        try {
            setApplying(true);
            const response = await cameraService.applyCameraRestore(requestPayload);
            if (response.success) {
                success('Backup Restore Berhasil', `Berhasil memulihkan ${response.data?.repaired || 0} kamera dari backup.`);
                setPreview(null);
            }
        } catch (error) {
            showError('Backup Restore Gagal', error.response?.data?.message || error.message || 'Gagal menerapkan restore backup.');
        } finally {
            setApplying(false);
        }
    };

    const updateQuickScope = (nextScopeMode, nextAreaId = '') => {
        setScopeMode(nextScopeMode);
        setSelectedAreaId(nextAreaId);

        const params = new URLSearchParams(searchParams);
        if (nextScopeMode === 'unresolved_only') {
            params.set('scope', 'unresolved_only');
            params.delete('areaId');
        } else if (nextScopeMode === 'area_ids' && nextAreaId) {
            params.delete('scope');
            params.set('areaId', nextAreaId);
        } else {
            params.delete('scope');
            params.delete('areaId');
        }
        setSearchParams(params, { replace: true });
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-primary mb-1">Pemulihan Metadata Kamera</p>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Backup Restore</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Cocokkan backup lama ke kamera existing lalu pulihkan URL source yang hilang tanpa membuat duplikat baru.
                    </p>
                </div>
                <Link
                    to="/admin/import-export"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                    Kembali ke Import/Export
                </Link>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50/80 dark:bg-blue-500/10 dark:border-blue-500/20 p-5">
                <p className="font-semibold text-blue-900 dark:text-blue-200">Gunakan restore untuk kamera unresolved</p>
                <p className="mt-2 text-sm text-blue-800 dark:text-blue-300">
                    Import biasa tetap khusus untuk ingest per-area. Restore ini dipakai untuk memperbaiki kamera existing yang kehilangan `external_hls_url`, `external_stream_url`, atau metadata source lain.
                </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
                <section className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 space-y-5">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">1. Unggah Backup JSON</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">File backup lama akan dibaca di browser lalu dikirim ke backend untuk preview restore.</p>
                    </div>

                    <div className="flex flex-col md:flex-row gap-3">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,application/json"
                            onChange={handleFileUpload}
                            className="block w-full text-sm text-gray-700 dark:text-gray-200 file:mr-4 file:rounded-xl file:border-0 file:bg-primary file:px-4 file:py-2.5 file:font-semibold file:text-white hover:file:bg-primary-600"
                        />
                        <button
                            type="button"
                            onClick={clearBackup}
                            className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                        >
                            Bersihkan
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">File</p>
                            <p className="mt-1 font-semibold text-gray-900 dark:text-white">{fileName || 'Belum ada file'}</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">Total Item Backup</p>
                            <p className="mt-1 font-semibold text-gray-900 dark:text-white">{backupItems.length}</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">Mode Restore</p>
                            <p className="mt-1 font-semibold text-gray-900 dark:text-white">Repair Existing</p>
                        </div>
                    </div>
                </section>

                <section className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 space-y-5">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">2. Scope & Matching</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Default pencocokan menggunakan ID lalu fallback `name + area_name`.</p>
                    </div>

                    <div className="space-y-4">
                        <label className="block">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Scope</span>
                            <select
                                value={scopeMode}
                                onChange={(event) => updateQuickScope(event.target.value, selectedAreaId)}
                                className="mt-2 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-gray-900 dark:text-white"
                            >
                                <option value="all">Semua kamera existing</option>
                                <option value="unresolved_only">Hanya kamera unresolved</option>
                                <option value="area_ids">Hanya area tertentu</option>
                            </select>
                        </label>

                        <label className="block">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Area Filter</span>
                            <select
                                value={selectedAreaId}
                                disabled={scopeMode !== 'area_ids' || loadingAreas}
                                onChange={(event) => updateQuickScope('area_ids', event.target.value)}
                                className="mt-2 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-gray-900 dark:text-white disabled:opacity-60"
                            >
                                <option value="">Pilih area</option>
                                {areas.map((area) => (
                                    <option key={area.id} value={area.id}>{area.name}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <button
                        type="button"
                        onClick={handlePreview}
                        disabled={previewLoading || !backupItems.length || (scopeMode === 'area_ids' && !selectedAreaId)}
                        className="w-full px-4 py-3 rounded-xl bg-primary hover:bg-primary-600 text-white font-semibold disabled:opacity-60"
                    >
                        {previewLoading ? 'Membuat Preview...' : 'Buat Preview Restore'}
                    </button>
                </section>
            </div>

            {preview && (
                <section className="space-y-6">
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">Repairable</p>
                            <p className="mt-1 text-2xl font-bold text-emerald-600">{preview.counts?.matched_repairable || 0}</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">Sudah Sinkron</p>
                            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{preview.counts?.matched_no_changes || 0}</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">Ambigu</p>
                            <p className="mt-1 text-2xl font-bold text-amber-500">{preview.counts?.ambiguous_matches || 0}</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">Target Hilang</p>
                            <p className="mt-1 text-2xl font-bold text-rose-500">{preview.counts?.missing_target || 0}</p>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">Backup Invalid</p>
                            <p className="mt-1 text-2xl font-bold text-rose-500">{preview.counts?.invalid_backup_row || 0}</p>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">3. Review Hasil Preview</h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Tinjau kamera yang cocok, butuh perbaikan, atau masih ambigu.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => setRowFilter('all')} className={`px-3 py-2 rounded-xl text-sm ${rowFilter === 'all' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300'}`}>Semua</button>
                                <button type="button" onClick={() => setRowFilter('repairable')} className={`px-3 py-2 rounded-xl text-sm ${rowFilter === 'repairable' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300'}`}>Repairable</button>
                                <button type="button" onClick={() => setRowFilter('external_only')} className={`px-3 py-2 rounded-xl text-sm ${rowFilter === 'external_only' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300'}`}>External Only</button>
                                <button type="button" onClick={() => setRowFilter('issues')} className={`px-3 py-2 rounded-xl text-sm ${rowFilter === 'issues' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300'}`}>Isu</button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                                        <th className="py-3 pr-4">Backup</th>
                                        <th className="py-3 pr-4">Target</th>
                                        <th className="py-3 pr-4">Status</th>
                                        <th className="py-3 pr-4">Match</th>
                                        <th className="py-3 pr-4">Perubahan</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredRows.slice(0, 120).map((row, index) => (
                                        <tr key={`${row.backupId || row.backupName}-${index}`} className="border-b border-gray-100 dark:border-gray-800 align-top">
                                            <td className="py-3 pr-4">
                                                <div className="font-medium text-gray-900 dark:text-white">{row.backupName}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">ID backup: {row.backupId ?? '-'}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">{row.backupAreaName || 'Tanpa area backup'}</div>
                                            </td>
                                            <td className="py-3 pr-4">
                                                <div className="font-medium text-gray-900 dark:text-white">{row.targetCameraName || '-'}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">ID target: {row.targetCameraId ?? '-'}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">{row.targetAreaName || '-'}</div>
                                            </td>
                                            <td className="py-3 pr-4">
                                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                                    row.status === 'matched_repairable'
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                                                        : row.status === 'matched_no_changes'
                                                            ? 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300'
                                                            : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'
                                                }`}>
                                                    {row.status}
                                                </span>
                                                {row.reason && (
                                                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{row.reason}</div>
                                                )}
                                            </td>
                                            <td className="py-3 pr-4 text-xs text-gray-500 dark:text-gray-400">{row.matchReason || '-'}</td>
                                            <td className="py-3 pr-4 text-xs text-gray-500 dark:text-gray-400">
                                                {row.changedFields?.length ? row.changedFields.join(', ') : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Menampilkan {Math.min(filteredRows.length, 120)} dari {filteredRows.length} baris preview.
                            </p>
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={applying || !preview.canApply}
                                className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
                            >
                                {applying ? 'Menerapkan Restore...' : 'Terapkan Backup Restore'}
                            </button>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}
