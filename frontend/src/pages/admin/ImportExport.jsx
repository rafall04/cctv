import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cameraService } from '../../services/cameraService';
import { useNotification } from '../../contexts/NotificationContext';

const IMPORT_MODE_OPTIONS = [
    { value: 'upload_json', label: 'Upload JSON' },
    { value: 'remote_preset', label: 'Remote Source Preset' },
];

const PROFILE_OPTIONS = [
    { value: 'internal_rtsp_live_only', label: 'Private RTSP (Live Only)' },
    { value: 'jombang_mjpeg', label: 'Jombang MJPEG' },
    { value: 'generic_hls', label: 'Generic HLS' },
    { value: 'surakarta_flv', label: 'Surakarta FLV' },
    { value: 'generic_mjpeg', label: 'Generic MJPEG' },
    { value: 'embed_only', label: 'Embed Only' },
];

const REMOTE_PROFILE_OPTIONS = [
    { value: 'jombang_mjpeg', label: 'Jombang v2' },
    { value: 'surakarta_flv', label: 'Surakarta FLV' },
];

const DELIVERY_TYPE_OPTIONS = [
    { value: '', label: 'Auto / Ikuti Source' },
    { value: 'internal_hls', label: 'Internal HLS' },
    { value: 'external_hls', label: 'External HLS' },
    { value: 'external_flv', label: 'External FLV' },
    { value: 'external_mjpeg', label: 'External MJPEG' },
    { value: 'external_embed', label: 'External Embed' },
    { value: 'external_jsmpeg', label: 'External JSMPEG' },
    { value: 'external_custom_ws', label: 'External Custom WS' },
];

const HEALTH_MODE_OPTIONS = [
    { value: '', label: 'Auto / Ikuti Profile' },
    { value: 'default', label: 'Default' },
    { value: 'passive_first', label: 'Passive First' },
    { value: 'hybrid_probe', label: 'Hybrid Probe' },
    { value: 'probe_first', label: 'Probe First' },
    { value: 'disabled', label: 'Disabled' },
];

const TLS_OPTIONS = [
    { value: 'strict', label: 'Strict' },
    { value: 'insecure', label: 'Insecure' },
];

const ORIGIN_OPTIONS = [
    { value: 'direct', label: 'Direct' },
    { value: 'embed', label: 'Embed' },
];

const SOURCE_FILTER_OPTIONS = [
    { value: 'all', label: 'Semua Source Rows' },
    { value: 'online_only', label: 'Hanya Online' },
    { value: 'offline_only', label: 'Hanya Offline' },
];

const SNAPSHOT_OPTIONS = [
    { value: 'preserve', label: 'Preserve' },
    { value: 'clear', label: 'Clear' },
    { value: 'derive_if_supported', label: 'Derive if Supported' },
];

const LOCATION_MAPPING_OPTIONS = [
    { value: 'name', label: 'Name' },
    { value: 'source_field', label: 'Source Field' },
    { value: 'area_plus_name', label: 'Area + Name' },
];

function getTemplateJson(profile) {
    if (profile === 'internal_rtsp_live_only') {
        return `{
    "targetArea": "SURABAYA",
    "sourceProfile": "internal_rtsp_live_only",
    "cameras": [
        {
            "name": "A. YANI - JEMURSARI",
            "private_rtsp_url": "rtsp://user:pass@host:554/Streaming/Channels/402",
            "stream_source": "internal",
            "delivery_type": "internal_hls",
            "enable_recording": 0,
            "latitude": null,
            "longitude": null,
            "status": "active",
            "video_codec": "h264",
            "source_tag": "surabaya_private_rtsp",
            "notes": "live_only"
        }
    ]
}`;
    }

    return `[
    {
        "name": "Contoh CCTV",
        "location": "Simpang A",
        "description": "SOURCE: MANUAL IMPORT",
        "delivery_type": "external_hls",
        "stream_source": "external",
        "external_stream_url": "https://example.com/live/index.m3u8",
        "external_snapshot_url": "https://example.com/snapshot.jpg",
        "external_use_proxy": 1,
        "external_tls_mode": "strict",
        "external_health_mode": "hybrid_probe",
        "latitude": -7.557,
        "longitude": 112.233,
        "enabled": 1
    }
]`;
}

function getProfileDefaults(profile) {
    switch (profile) {
        case 'internal_rtsp_live_only':
            return {
                delivery_type: 'internal_hls',
                external_use_proxy: false,
                enabled: true,
                external_tls_mode: 'strict',
                external_health_mode: 'default',
                external_origin_mode: 'direct',
                descriptionTemplate: 'SOURCE: PRIVATE RTSP LIVE ONLY | source_tag: {sourceTag} | notes: {notes}',
                locationMapping: 'source_field',
                sourceFilter: 'all',
            };
        case 'jombang_mjpeg':
            return {
                delivery_type: 'external_mjpeg',
                external_use_proxy: true,
                enabled: true,
                external_tls_mode: 'strict',
                external_health_mode: 'passive_first',
                external_origin_mode: 'direct',
                descriptionTemplate: 'SOURCE: JOMBANG V2 | kategori: {sourceCategory} | source_status: {sourceStatus}',
                locationMapping: 'name',
                sourceFilter: 'all',
            };
        case 'generic_hls':
            return {
                delivery_type: 'external_hls',
                external_use_proxy: true,
                enabled: true,
                external_tls_mode: 'strict',
                external_health_mode: 'hybrid_probe',
                external_origin_mode: 'direct',
                descriptionTemplate: '',
                locationMapping: 'source_field',
                sourceFilter: 'all',
            };
        case 'surakarta_flv':
            return {
                delivery_type: 'external_flv',
                external_use_proxy: false,
                enabled: true,
                external_tls_mode: 'strict',
                external_health_mode: 'passive_first',
                external_origin_mode: 'direct',
                descriptionTemplate: 'SOURCE: SURAKARTA FLV | source_profile: {sourceProfile}',
                locationMapping: 'name',
                sourceFilter: 'all',
            };
        case 'embed_only':
            return {
                delivery_type: 'external_embed',
                external_use_proxy: false,
                enabled: true,
                external_tls_mode: 'strict',
                external_health_mode: 'passive_first',
                external_origin_mode: 'embed',
                descriptionTemplate: '',
                locationMapping: 'source_field',
                sourceFilter: 'all',
            };
        case 'generic_mjpeg':
        default:
            return {
                delivery_type: 'external_mjpeg',
                external_use_proxy: true,
                enabled: true,
                external_tls_mode: 'strict',
                external_health_mode: 'passive_first',
                external_origin_mode: 'direct',
                descriptionTemplate: '',
                locationMapping: 'name',
                sourceFilter: 'all',
            };
    }
}

function extractCameraArrayFromJson(json) {
    if (Array.isArray(json)) return json;
    if (Array.isArray(json?.data)) return json.data;
    if (Array.isArray(json?.cameras)) return json.cameras;
    throw new Error('Could not find an array of cameras in the JSON structure.');
}

function formatBreakdown(items = [], keyName = 'label') {
    if (!Array.isArray(items) || items.length === 0) {
        return 'Tidak ada data';
    }

    return items.map((item) => `${item[keyName] || item.deliveryType || item.category}: ${item.count}`).join(' • ');
}

export default function ImportExport() {
    const { success, error: showError } = useNotification();
    const [searchParams] = useSearchParams();
    const fileInputRef = useRef(null);

    const [activeTab, setActiveTab] = useState('import');
    const [importMode, setImportMode] = useState('upload_json');
    const [sourceProfile, setSourceProfile] = useState('jombang_mjpeg');
    const [targetArea, setTargetArea] = useState('DI YOGYAKARTA');
    const [rawPayload, setRawPayload] = useState([]);
    const [rawFileName, setRawFileName] = useState('');
    const [previewResult, setPreviewResult] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [showTemplate, setShowTemplate] = useState(false);
    const [globalOverrides, setGlobalOverrides] = useState(() => {
        const defaults = getProfileDefaults('jombang_mjpeg');
        return {
            delivery_type: defaults.delivery_type,
            external_health_mode: defaults.external_health_mode,
            external_origin_mode: defaults.external_origin_mode,
            enabled: defaults.enabled,
            external_use_proxy: defaults.external_use_proxy,
            external_tls_mode: defaults.external_tls_mode,
            external_snapshot_url_handling: 'preserve',
            syncLocationWithName: defaults.locationMapping === 'name',
            locationMapping: defaults.locationMapping,
            descriptionTemplate: defaults.descriptionTemplate,
        };
    });
    const [importPolicy, setImportPolicy] = useState({
        duplicateMode: 'skip_existing_name_or_url',
        areaMode: 'single_target_area',
        normalizeNames: true,
        dropOfflineSourceRows: false,
        filterSourceRows: 'all',
        snapshotHandling: 'preserve',
        locationMapping: 'name',
    });

    useEffect(() => {
        const prefilledArea = searchParams.get('area');
        if (prefilledArea) {
            setTargetArea(prefilledArea);
        }
    }, [searchParams]);

    useEffect(() => {
        const defaults = getProfileDefaults(sourceProfile);
        setGlobalOverrides((current) => ({
            ...current,
            delivery_type: defaults.delivery_type,
            external_health_mode: defaults.external_health_mode,
            external_origin_mode: defaults.external_origin_mode,
            enabled: defaults.enabled,
            external_use_proxy: defaults.external_use_proxy,
            external_tls_mode: defaults.external_tls_mode,
            syncLocationWithName: defaults.locationMapping === 'name',
            locationMapping: defaults.locationMapping,
            descriptionTemplate: defaults.descriptionTemplate,
        }));
        setImportPolicy((current) => ({
            ...current,
            filterSourceRows: defaults.sourceFilter,
            locationMapping: defaults.locationMapping,
        }));
        setPreviewResult(null);
    }, [sourceProfile]);

    const sourceOptions = importMode === 'remote_preset' ? REMOTE_PROFILE_OPTIONS : PROFILE_OPTIONS;
    const isPrivateRtspProfile = sourceProfile === 'internal_rtsp_live_only';
    const templateJson = useMemo(() => getTemplateJson(sourceProfile), [sourceProfile]);

    const importPayload = useMemo(() => ({
        targetArea,
        cameras: importMode === 'upload_json' ? rawPayload : undefined,
        globalOverrides: {
            ...globalOverrides,
            enabled: globalOverrides.enabled ? 1 : 0,
            external_use_proxy: globalOverrides.external_use_proxy ? 1 : 0,
        },
        importPolicy: {
            ...importPolicy,
            snapshotHandling: globalOverrides.external_snapshot_url_handling || importPolicy.snapshotHandling,
            locationMapping: globalOverrides.syncLocationWithName ? 'name' : importPolicy.locationMapping,
        },
        sourceProfile,
    }), [globalOverrides, importMode, importPolicy, rawPayload, sourceProfile, targetArea]);

    const handleExport = async () => {
        try {
            setIsProcessing(true);
            const result = await cameraService.exportCameras();
            if (result.success) {
                const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result.data, null, 2))}`;
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute('href', dataStr);
                downloadAnchorNode.setAttribute('download', `cctv_backup_${new Date().toISOString().split('T')[0]}.json`);
                document.body.appendChild(downloadAnchorNode);
                downloadAnchorNode.click();
                downloadAnchorNode.remove();
                success('Export Complete', 'Database successfully exported to JSON.');
            }
        } catch (err) {
            showError('Export Failed', err.message || 'Failed to generate export file.');
        } finally {
            setIsProcessing(false);
        }
    };

    const clearImport = () => {
        setRawPayload([]);
        setRawFileName('');
        setPreviewResult(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleFileUpload = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            try {
                const parsed = JSON.parse(loadEvent.target.result);
                const cameras = extractCameraArrayFromJson(parsed);
                setRawPayload(cameras);
                setRawFileName(file.name);
                setPreviewResult(null);
                success('File Parsed', `Successfully loaded ${cameras.length} items from JSON.`);
            } catch (err) {
                showError('Parse Error', `Invalid JSON file structure: ${err.message}`);
            }
        };
        reader.readAsText(file);
    };

    const handleOverrideChange = (key, value) => {
        setGlobalOverrides((current) => ({ ...current, [key]: value }));
        setPreviewResult(null);
    };

    const handlePolicyChange = (key, value) => {
        setImportPolicy((current) => ({ ...current, [key]: value }));
        setPreviewResult(null);
    };

    const handlePreview = async () => {
        if (!targetArea.trim()) {
            showError('Validation', 'Target area is required before preview.');
            return;
        }
        if (importMode === 'upload_json' && rawPayload.length === 0) {
            showError('Validation', 'Upload JSON terlebih dahulu sebelum preview.');
            return;
        }
        try {
            setPreviewLoading(true);
            const response = await cameraService.previewImportCameras(importPayload);
            if (response.success) {
                setPreviewResult(response.data);
                success('Preview Siap', `Preview menghasilkan ${response.data.summary.importableCount} row yang bisa diimport.`);
            }
        } catch (err) {
            setPreviewResult(null);
            showError('Preview Failed', err?.response?.data?.message || err.message);
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleImportSubmit = async () => {
        if (!previewResult?.canImport) {
            showError('Validation', 'Jalankan preview yang valid sebelum commit import.');
            return;
        }
        try {
            setIsProcessing(true);
            const response = await cameraService.importCameras(importPayload);
            if (response.success) {
                const { imported, skipped, warnings } = response.result;
                success('Import Complete', `Imported ${imported} cameras ke area ${targetArea}.`);
                if (skipped > 0) {
                    showError('Import Selesai dengan Skip', `${skipped} row tidak diimport. Periksa preview untuk detail duplicate atau invalid source.`);
                }
                if (warnings?.length) {
                    console.warn('Import warnings:', warnings);
                }
                clearImport();
            }
        } catch (err) {
            showError('Import Failed', err?.response?.data?.message || err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const previewRows = previewResult?.rows || [];
    const previewSummary = previewResult?.summary || null;
    const sourceStats = previewResult?.sourceStats || null;

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Import Control Center</h1>
                    <p className="text-gray-500 dark:text-gray-400">Preview dulu, lalu commit hanya row yang memang valid dan eligible.</p>
                </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 dark:bg-amber-500/10 dark:border-amber-500/20 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <p className="font-semibold text-amber-900 dark:text-amber-200">Backup Restore tetap terpisah dari ingest baru</p>
                    <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                        Gunakan restore jika targetnya memperbaiki metadata kamera existing. Import di halaman ini fokus untuk ingest kamera baru per area dengan preview server-side.
                    </p>
                </div>
                <Link to="/admin/backup-restore" className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold">
                    Buka Backup Restore
                </Link>
            </div>

            <div className="flex space-x-1 border-b border-gray-200 dark:border-gray-800">
                <button onClick={() => setActiveTab('import')} className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'import' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}`}>
                    Import Center
                </button>
                <button onClick={() => setActiveTab('export')} className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'export' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}`}>
                    Export Database
                </button>
            </div>

            {activeTab === 'export' && (
                <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
                    <div className="p-4 bg-primary-50 dark:bg-primary-900/10 text-primary-900 dark:text-primary-100 rounded-xl border border-primary-200 dark:border-primary-800/30">
                        <h3 className="font-semibold text-lg mb-2">Full Database Export</h3>
                        <p className="text-sm mb-4">Unduh snapshot JSON untuk seluruh kamera yang saat ini ada di database. Field private seperti `private_rtsp_url` tidak ikut diekspor di jalur umum ini.</p>
                        <button onClick={handleExport} disabled={isProcessing} className="bg-primary text-white py-2 px-6 rounded-xl hover:bg-primary-600 transition disabled:opacity-50">
                            {isProcessing ? 'Processing Download...' : 'Export to JSON'}
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'import' && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="lg:col-span-1 space-y-4">
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-5 space-y-4">
                            <div>
                                <h3 className="font-bold text-gray-900 dark:text-white">1. Workflow</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Pilih upload manual atau fetch source preset dari backend.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {IMPORT_MODE_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => {
                                            setImportMode(option.value);
                                            if (option.value === 'remote_preset') setSourceProfile('jombang_mjpeg');
                                            setPreviewResult(null);
                                        }}
                                        className={`rounded-xl px-3 py-2 text-sm font-medium transition ${importMode === option.value ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>

                            <div>
                                <label htmlFor="import-profile-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Import Profile</label>
                                <select id="import-profile-select" value={sourceProfile} onChange={(event) => setSourceProfile(event.target.value)} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white">
                                    {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                            </div>

                            {importMode === 'upload_json' ? (
                                <div>
                                    <label htmlFor="import-json-file" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Upload JSON</label>
                                    <input id="import-json-file" type="file" accept=".json" onChange={handleFileUpload} ref={fileInputRef} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100" />
                                    {rawPayload.length > 0 && <p className="mt-3 text-sm text-green-600 dark:text-green-400 font-medium">Loaded {rawPayload.length} rows from {rawFileName || 'JSON'}.</p>}
                                </div>
                            ) : (
                                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200">
                                    Backend akan fetch source preset saat preview. Saat ini preset remote yang aktif adalah Jombang v2 dan Surakarta FLV.
                                </div>
                            )}

                            {isPrivateRtspProfile && importMode === 'upload_json' && (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                                    Profile ini khusus dataset private RTSP seperti Surabaya. Import akan dipaksa menjadi `internal_hls`, live-only, recording off, dan preview/export umum hanya menampilkan URL yang sudah disanitasi.
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Area</label>
                                <input type="text" value={targetArea} onChange={(event) => { setTargetArea(event.target.value); setPreviewResult(null); }} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white" placeholder="Nama area target" />
                            </div>
                        </div>

                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-5 space-y-4">
                            <h3 className="font-bold text-gray-900 dark:text-white">2. Policy Overrides</h3>
                            <div className="grid grid-cols-1 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Delivery Type Override</label>
                                    <select value={globalOverrides.delivery_type} onChange={(event) => handleOverrideChange('delivery_type', event.target.value)} disabled={isPrivateRtspProfile} className="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm disabled:opacity-60 dark:bg-gray-800 dark:border-gray-600 dark:text-white">
                                        {DELIVERY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                    {isPrivateRtspProfile && <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Profile ini selalu dipaksa ke `internal_hls`.</p>}
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">External Health Mode</label>
                                    <select value={globalOverrides.external_health_mode} onChange={(event) => handleOverrideChange('external_health_mode', event.target.value)} disabled={isPrivateRtspProfile} className="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm disabled:opacity-60 dark:bg-gray-800 dark:border-gray-600 dark:text-white">
                                        {HEALTH_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">TLS Mode</label>
                                    <select value={globalOverrides.external_tls_mode} onChange={(event) => handleOverrideChange('external_tls_mode', event.target.value)} disabled={isPrivateRtspProfile} className="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm disabled:opacity-60 dark:bg-gray-800 dark:border-gray-600 dark:text-white">
                                        {TLS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Origin Mode</label>
                                    <select value={globalOverrides.external_origin_mode} onChange={(event) => handleOverrideChange('external_origin_mode', event.target.value)} disabled={isPrivateRtspProfile} className="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm disabled:opacity-60 dark:bg-gray-800 dark:border-gray-600 dark:text-white">
                                        {ORIGIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Snapshot Handling</label>
                                    <select value={globalOverrides.external_snapshot_url_handling} onChange={(event) => handleOverrideChange('external_snapshot_url_handling', event.target.value)} className="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white">
                                        {SNAPSHOT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Location Mapping</label>
                                    <select value={importPolicy.locationMapping} onChange={(event) => handlePolicyChange('locationMapping', event.target.value)} className="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white">
                                        {LOCATION_MAPPING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Filter Source Rows</label>
                                    <select value={importPolicy.filterSourceRows} onChange={(event) => handlePolicyChange('filterSourceRows', event.target.value)} className="w-full rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white">
                                        {SOURCE_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Description Template</label>
                                <textarea value={globalOverrides.descriptionTemplate} onChange={(event) => handleOverrideChange('descriptionTemplate', event.target.value)} className="w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white h-20" placeholder="SOURCE: {sourceProfile} | status: {sourceStatus}" />
                            </div>
                            <div className="space-y-3">
                                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={globalOverrides.enabled} onChange={(event) => handleOverrideChange('enabled', event.target.checked)} />Import as enabled</label>
                                <label className={`flex items-center gap-2 text-sm ${isPrivateRtspProfile ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}><input type="checkbox" checked={globalOverrides.external_use_proxy} onChange={(event) => handleOverrideChange('external_use_proxy', event.target.checked)} disabled={isPrivateRtspProfile} />Enable built-in proxy</label>
                                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={globalOverrides.syncLocationWithName} onChange={(event) => handleOverrideChange('syncLocationWithName', event.target.checked)} />Pakai nama kamera sebagai location</label>
                                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={importPolicy.normalizeNames} onChange={(event) => handlePolicyChange('normalizeNames', event.target.checked)} />Normalize camera names</label>
                                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={importPolicy.dropOfflineSourceRows} onChange={(event) => handlePolicyChange('dropOfflineSourceRows', event.target.checked)} />Drop offline source rows</label>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <button onClick={handlePreview} disabled={previewLoading} className="w-full bg-sky-600 text-white py-3 px-4 rounded-xl shadow font-medium hover:bg-sky-700 transition disabled:opacity-50">
                                {previewLoading ? 'Generating Preview...' : 'Preview Import'}
                            </button>
                            <button onClick={handleImportSubmit} disabled={isProcessing || !previewResult?.canImport} className="w-full bg-primary text-white py-3 px-4 rounded-xl shadow font-medium hover:bg-primary-600 transition disabled:opacity-50">
                                {isProcessing ? 'Processing Transaction...' : 'Commit Import to DB'}
                            </button>
                            <button onClick={clearImport} className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                                Clear
                            </button>
                        </div>
                    </div>

                    <div className="lg:col-span-3 space-y-6">
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800">
                            <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white">Server Preview</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Preview dan apply memakai logic backend yang sama.</p>
                                </div>
                                <button onClick={() => setShowTemplate((current) => !current)} className="text-sm text-primary hover:text-primary-600">
                                    {showTemplate ? 'Tutup Template JSON' : 'Lihat Template JSON'}
                                </button>
                            </div>
                            {showTemplate && (
                                <div className="px-4 pt-4">
                                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-950">
                                        <pre className="overflow-x-auto text-xs text-gray-700 dark:text-gray-300">{templateJson}</pre>
                                    </div>
                                </div>
                            )}
                            <div className="p-4 space-y-4">
                                {!previewResult ? (
                                    <div className="h-64 flex flex-col items-center justify-center text-gray-400 space-y-3 font-medium">
                                        <svg className="w-12 h-12 stroke-current opacity-30" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                                        <p>Jalankan preview untuk melihat hasil validasi server-side.</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40"><div className="text-xs text-gray-500 dark:text-gray-400">Importable</div><div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{previewSummary?.importableCount || 0}</div></div>
                                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40"><div className="text-xs text-gray-500 dark:text-gray-400">Duplicate</div><div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{previewSummary?.duplicateCount || 0}</div></div>
                                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40"><div className="text-xs text-gray-500 dark:text-gray-400">Invalid</div><div className="text-2xl font-bold text-red-600 dark:text-red-400">{previewSummary?.invalidCount || 0}</div></div>
                                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40"><div className="text-xs text-gray-500 dark:text-gray-400">Filtered Out</div><div className="text-2xl font-bold text-slate-600 dark:text-slate-300">{previewSummary?.filteredOutCount || 0}</div></div>
                                        </div>

                                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                                                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Source Stats</h4>
                                                <p className="text-sm text-gray-600 dark:text-gray-300">Total: {sourceStats?.totalRows || 0}</p>
                                                <p className="text-sm text-gray-600 dark:text-gray-300">Online: {sourceStats?.onlineCount || 0}</p>
                                                <p className="text-sm text-gray-600 dark:text-gray-300">Offline: {sourceStats?.offlineCount || 0}</p>
                                                <p className="text-sm text-gray-600 dark:text-gray-300">Missing Coords: {sourceStats?.missingCoordsCount || 0}</p>
                                                <p className="text-sm text-gray-600 dark:text-gray-300">Duplicate URLs: {sourceStats?.duplicateUrlCount || 0}</p>
                                            </div>
                                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                                                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Field Mapping</h4>
                                                <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                                                    {Object.entries(previewResult.fieldMapping || {}).map(([key, value]) => (
                                                        <p key={key}><span className="font-medium text-gray-900 dark:text-white">{key}</span>: {value}</p>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                                                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Breakdown</h4>
                                                <p className="text-sm text-gray-600 dark:text-gray-300">Delivery: {formatBreakdown(previewSummary?.deliveryTypeBreakdown, 'deliveryType')}</p>
                                                <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">Kategori: {formatBreakdown(sourceStats?.categoryBreakdown, 'category')}</p>
                                            </div>
                                        </div>

                                        {previewResult.warnings?.length > 0 && (
                                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                                                <h4 className="font-semibold text-amber-900 dark:text-amber-200 mb-2">Import Warnings</h4>
                                                <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-300">
                                                    {previewResult.warnings.map((warning) => (
                                                        <li key={warning.code}>[{warning.count}] {warning.message}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                                                <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-700 dark:text-gray-400 sticky top-0">
                                                    <tr>
                                                        <th className="px-4 py-3 rounded-tl-lg">Status</th>
                                                        <th className="px-4 py-3">Name</th>
                                                        <th className="px-4 py-3">Delivery</th>
                                                        <th className="px-4 py-3">URL</th>
                                                        <th className="px-4 py-3">Health</th>
                                                        <th className="px-4 py-3">TLS</th>
                                                        <th className="px-4 py-3 rounded-tr-lg">Reason</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {previewRows.slice(0, 80).map((row) => (
                                                        <tr key={`${row.index}-${row.resolvedName || 'row'}`} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                                                            <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.status === 'importable' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : row.status === 'duplicate_name' || row.status === 'duplicate_url' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' : row.status === 'filtered_out' ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' : 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>{row.status}</span></td>
                                                            <td className="px-4 py-3 font-medium text-gray-900 dark:text-white max-w-[200px] truncate">{row.resolvedName || `Row ${row.index + 1}`}</td>
                                                            <td className="px-4 py-3">
                                                                <div className="font-medium text-gray-900 dark:text-white">{row.resolvedDeliveryType || '-'}</div>
                                                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                    {(row.resolvedStreamSource || '-')}{row.resolvedRecordingEnabled === 0 ? ' • live only' : ''}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 max-w-[260px] truncate" title={row.resolvedUrl || ''}>{row.resolvedUrl || '-'}</td>
                                                            <td className="px-4 py-3">{row.resolvedHealthMode || '-'}</td>
                                                            <td className="px-4 py-3">{row.resolvedTlsMode || '-'}</td>
                                                            <td className="px-4 py-3 max-w-[260px] truncate" title={row.reason || ''}>{row.reason || '-'}</td>
                                                        </tr>
                                                    ))}
                                                    {previewRows.length > 80 && (
                                                        <tr>
                                                            <td colSpan="7" className="px-4 py-4 text-center text-xs text-gray-400">... and {previewRows.length - 80} more rows hidden for performance.</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
