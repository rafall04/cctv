import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs, TabPanel } from '../../components/ui';
import { cameraService } from '../../services/cameraService';
import { useNotification } from '../../contexts/NotificationContext';

const TABS = [
    { id: 'import', label: 'Pusat Impor' },
    { id: 'export', label: 'Ekspor Database' },
];

const IMPORT_MODE_OPTIONS = [
    { value: 'upload_json', label: 'Unggah JSON' },
    { value: 'remote_preset', label: 'Preset Source Remote' },
];

const PROFILE_OPTIONS = [
    { value: 'internal_rtsp_live_only', label: 'RTSP Privat (Live Saja)' },
    { value: 'jombang_mjpeg', label: 'Jombang MJPEG' },
    { value: 'generic_hls', label: 'HLS Umum' },
    { value: 'surakarta_flv', label: 'Surakarta FLV' },
    { value: 'generic_mjpeg', label: 'MJPEG Umum' },
    { value: 'embed_only', label: 'Embed Saja' },
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
    { value: 'preserve', label: 'Pertahankan' },
    { value: 'clear', label: 'Kosongkan' },
    { value: 'derive_if_supported', label: 'Derive jika Didukung' },
];

const LOCATION_MAPPING_OPTIONS = [
    { value: 'name', label: 'Nama' },
    { value: 'source_field', label: 'Field Source' },
    { value: 'area_plus_name', label: 'Area + Nama' },
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
            "internal_ingest_policy_override": "on_demand",
            "internal_on_demand_close_after_seconds_override": 15,
            "latitude": null,
            "longitude": null,
            "status": "active",
            "video_codec": "h264",
            "source_profile": "surabaya_private_rtsp",
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
                source_profile: 'surabaya_private_rtsp',
                internal_ingest_policy_override: 'on_demand',
                internal_on_demand_close_after_seconds_override: 15,
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
    throw new Error('Tidak menemukan array kamera di dalam struktur JSON.');
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
                success('Ekspor Selesai', 'Database berhasil diekspor ke JSON.');
            }
        } catch (err) {
            showError('Ekspor Gagal', err.message || 'Gagal membuat file ekspor.');
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
                success('File Terbaca', `Berhasil memuat ${cameras.length} item dari JSON.`);
            } catch (err) {
                showError('Gagal Parse', `Struktur file JSON tidak valid: ${err.message}`);
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
            showError('Validasi', 'Area target wajib diisi sebelum preview.');
            return;
        }
        if (importMode === 'upload_json' && rawPayload.length === 0) {
            showError('Validasi', 'Unggah JSON terlebih dahulu sebelum preview.');
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
            showError('Preview Gagal', err?.response?.data?.message || err.message);
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleImportSubmit = async () => {
        if (!previewResult?.canImport) {
            showError('Validasi', 'Jalankan preview yang valid sebelum commit import.');
            return;
        }
        try {
            setIsProcessing(true);
            const response = await cameraService.importCameras(importPayload);
            if (response.success) {
                const { imported, skipped, warnings } = response.result;
                success('Impor Selesai', `${imported} kamera diimport ke area ${targetArea}.`);
                if (skipped > 0) {
                    showError('Import Selesai dengan Skip', `${skipped} row tidak diimport. Periksa preview untuk detail duplicate atau invalid source.`);
                }
                if (warnings?.length) {
                    console.warn('Import warnings:', warnings);
                }
                clearImport();
            }
        } catch (err) {
            showError('Impor Gagal', err?.response?.data?.message || err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const previewRows = previewResult?.rows || [];
    const previewSummary = previewResult?.summary || null;
    const sourceStats = previewResult?.sourceStats || null;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Pusat Kendali Impor"
                description="Preview dulu, lalu commit hanya row yang memang valid dan eligible."
            />

            <div className="rounded-card border border-status-warn/30 bg-status-warn/10 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <p className="font-semibold text-status-warn">Backup Restore tetap terpisah dari ingest baru</p>
                    <p className="mt-1 text-sm text-content-muted">
                        Gunakan restore jika targetnya memperbaiki metadata kamera existing. Import di halaman ini fokus untuk ingest kamera baru per area dengan preview server-side.
                    </p>
                </div>
                <Link to="/admin/backup-restore" className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-control bg-status-warn hover:bg-status-warn/90 text-white font-semibold">
                    Buka Backup Restore
                </Link>
            </div>

            <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} idPrefix="importexport" />

            {activeTab === 'export' && (
                <TabPanel id="export" idPrefix="importexport" className="bg-surface rounded-card shadow-e1 border border-edge p-6">
                    <div className="p-4 bg-primary/5 text-content rounded-card border border-primary/20">
                        <h3 className="font-semibold text-lg mb-2">Ekspor Database Penuh</h3>
                        <p className="text-sm mb-4">Unduh snapshot JSON untuk seluruh kamera yang saat ini ada di database. Field private seperti `private_rtsp_url` tidak ikut diekspor di jalur umum ini.</p>
                        <button onClick={handleExport} disabled={isProcessing} className="bg-primary text-white py-2 px-6 rounded-control hover:bg-primary-600 transition disabled:opacity-50">
                            {isProcessing ? 'Memproses Unduhan...' : 'Ekspor ke JSON'}
                        </button>
                    </div>
                </TabPanel>
            )}

            {activeTab === 'import' && (
                <TabPanel id="import" idPrefix="importexport" className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="lg:col-span-1 space-y-4">
                        <div className="bg-surface rounded-card shadow-e1 border border-edge p-5 space-y-4">
                            <div>
                                <h3 className="font-bold text-content">1. Alur Kerja</h3>
                                <p className="text-xs text-content-muted mt-1">Pilih unggah manual atau fetch source preset dari backend.</p>
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
                                        className={`rounded-control px-3 py-2 text-sm font-medium transition ${importMode === option.value ? 'bg-primary text-white' : 'bg-surface-sunken text-content-muted hover:bg-surface-raised'}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>

                            <div>
                                <label htmlFor="import-profile-select" className="block text-sm font-medium text-content-muted mb-1">Profil Impor</label>
                                <select id="import-profile-select" value={sourceProfile} onChange={(event) => setSourceProfile(event.target.value)} className="w-full bg-surface-sunken border border-edge-strong text-content text-base sm:text-sm rounded-control focus:ring-primary focus:border-primary block p-2.5">
                                    {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                            </div>

                            {importMode === 'upload_json' ? (
                                <div>
                                    <label htmlFor="import-json-file" className="block text-sm font-medium text-content-muted mb-1">Unggah JSON</label>
                                    <input id="import-json-file" type="file" accept=".json" onChange={handleFileUpload} ref={fileInputRef} className="w-full text-sm text-content-muted file:mr-4 file:py-2 file:px-4 file:rounded-control file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
                                    {rawPayload.length > 0 && <p className="mt-3 text-sm text-status-live font-medium">Memuat {rawPayload.length} row dari {rawFileName || 'JSON'}.</p>}
                                </div>
                            ) : (
                                <div className="rounded-card border border-primary/20 bg-primary/10 p-3 text-sm text-primary">
                                    Backend akan fetch source preset saat preview. Saat ini preset remote yang aktif adalah Jombang v2 dan Surakarta FLV.
                                </div>
                            )}

                            {isPrivateRtspProfile && importMode === 'upload_json' && (
                                <div className="rounded-card border border-status-warn/30 bg-status-warn/10 p-3 text-sm text-status-warn">
                                    Profile ini khusus dataset private RTSP seperti Surabaya. Import akan dipaksa menjadi `internal_hls`, live-only, recording off, dan preview/export umum hanya menampilkan URL yang sudah disanitasi.
                                </div>
                            )}

                            <div>
                                <label htmlFor="import-target-area" className="block text-sm font-medium text-content-muted mb-1">Area Target</label>
                                <input id="import-target-area" type="text" value={targetArea} onChange={(event) => { setTargetArea(event.target.value); setPreviewResult(null); }} className="w-full bg-surface-sunken border border-edge-strong text-content text-base sm:text-sm rounded-control focus:ring-primary focus:border-primary block p-2.5" placeholder="Nama area target" />
                            </div>
                        </div>

                        <div className="bg-surface rounded-card shadow-e1 border border-edge p-5 space-y-4">
                            <h3 className="font-bold text-content">2. Override Kebijakan</h3>
                            <div className="grid grid-cols-1 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-content-muted mb-1">Override Delivery Type</label>
                                    <select aria-label="Override Delivery Type" value={globalOverrides.delivery_type} onChange={(event) => handleOverrideChange('delivery_type', event.target.value)} disabled={isPrivateRtspProfile} className="w-full rounded-control border border-edge-strong bg-surface-sunken p-2 text-base sm:text-sm disabled:opacity-60 text-content">
                                        {DELIVERY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                    {isPrivateRtspProfile && <p className="mt-1 text-[11px] text-content-muted">Profile ini selalu dipaksa ke `internal_hls`.</p>}
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-content-muted mb-1">External Health Mode</label>
                                    <select aria-label="External Health Mode" value={globalOverrides.external_health_mode} onChange={(event) => handleOverrideChange('external_health_mode', event.target.value)} disabled={isPrivateRtspProfile} className="w-full rounded-control border border-edge-strong bg-surface-sunken p-2 text-base sm:text-sm disabled:opacity-60 text-content">
                                        {HEALTH_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-content-muted mb-1">TLS Mode</label>
                                    <select aria-label="TLS Mode" value={globalOverrides.external_tls_mode} onChange={(event) => handleOverrideChange('external_tls_mode', event.target.value)} disabled={isPrivateRtspProfile} className="w-full rounded-control border border-edge-strong bg-surface-sunken p-2 text-base sm:text-sm disabled:opacity-60 text-content">
                                        {TLS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-content-muted mb-1">Origin Mode</label>
                                    <select aria-label="Origin Mode" value={globalOverrides.external_origin_mode} onChange={(event) => handleOverrideChange('external_origin_mode', event.target.value)} disabled={isPrivateRtspProfile} className="w-full rounded-control border border-edge-strong bg-surface-sunken p-2 text-base sm:text-sm disabled:opacity-60 text-content">
                                        {ORIGIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-content-muted mb-1">Penanganan Snapshot</label>
                                    <select aria-label="Penanganan Snapshot" value={globalOverrides.external_snapshot_url_handling} onChange={(event) => handleOverrideChange('external_snapshot_url_handling', event.target.value)} className="w-full rounded-control border border-edge-strong bg-surface-sunken p-2 text-sm text-content">
                                        {SNAPSHOT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-content-muted mb-1">Pemetaan Lokasi</label>
                                    <select aria-label="Pemetaan Lokasi" value={importPolicy.locationMapping} onChange={(event) => handlePolicyChange('locationMapping', event.target.value)} className="w-full rounded-control border border-edge-strong bg-surface-sunken p-2 text-sm text-content">
                                        {LOCATION_MAPPING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-content-muted mb-1">Filter Baris Source</label>
                                    <select aria-label="Filter Baris Source" value={importPolicy.filterSourceRows} onChange={(event) => handlePolicyChange('filterSourceRows', event.target.value)} className="w-full rounded-control border border-edge-strong bg-surface-sunken p-2 text-sm text-content">
                                        {SOURCE_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-content-muted mb-1">Template Deskripsi</label>
                                <textarea aria-label="Template Deskripsi" value={globalOverrides.descriptionTemplate} onChange={(event) => handleOverrideChange('descriptionTemplate', event.target.value)} className="w-full rounded-control border border-edge-strong bg-surface-sunken p-2.5 text-sm text-content h-20" placeholder="SOURCE: {sourceProfile} | status: {sourceStatus}" />
                            </div>
                            <div className="space-y-3">
                                <label className="flex items-center gap-2 text-sm text-content-muted"><input type="checkbox" checked={globalOverrides.enabled} onChange={(event) => handleOverrideChange('enabled', event.target.checked)} />Import sebagai aktif</label>
                                <label className={`flex items-center gap-2 text-sm ${isPrivateRtspProfile ? 'text-content-subtle' : 'text-content-muted'}`}><input type="checkbox" checked={globalOverrides.external_use_proxy} onChange={(event) => handleOverrideChange('external_use_proxy', event.target.checked)} disabled={isPrivateRtspProfile} />Aktifkan proxy bawaan</label>
                                <label className="flex items-center gap-2 text-sm text-content-muted"><input type="checkbox" checked={globalOverrides.syncLocationWithName} onChange={(event) => handleOverrideChange('syncLocationWithName', event.target.checked)} />Pakai nama kamera sebagai location</label>
                                <label className="flex items-center gap-2 text-sm text-content-muted"><input type="checkbox" checked={importPolicy.normalizeNames} onChange={(event) => handlePolicyChange('normalizeNames', event.target.checked)} />Normalisasi nama kamera</label>
                                <label className="flex items-center gap-2 text-sm text-content-muted"><input type="checkbox" checked={importPolicy.dropOfflineSourceRows} onChange={(event) => handlePolicyChange('dropOfflineSourceRows', event.target.checked)} />Buang baris source offline</label>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <button onClick={handlePreview} disabled={previewLoading} className="w-full bg-primary text-white py-3 px-4 rounded-control shadow-e1 font-medium hover:bg-primary-600 transition disabled:opacity-50">
                                {previewLoading ? 'Membuat Preview...' : 'Preview Import'}
                            </button>
                            <button onClick={handleImportSubmit} disabled={isProcessing || !previewResult?.canImport} className="w-full bg-primary text-white py-3 px-4 rounded-control shadow-e1 font-medium hover:bg-primary-600 transition disabled:opacity-50">
                                {isProcessing ? 'Memproses Transaksi...' : 'Commit Import ke DB'}
                            </button>
                            <button onClick={clearImport} className="w-full rounded-control border border-edge-strong px-4 py-3 text-sm font-medium text-content-muted transition hover:bg-surface-sunken">
                                Bersihkan
                            </button>
                        </div>
                    </div>

                    <div className="lg:col-span-3 space-y-6">
                        <div className="bg-surface rounded-card shadow-e1 border border-edge">
                            <div className="p-4 border-b border-edge flex justify-between items-center">
                                <div>
                                    <h3 className="font-bold text-content">Preview Server</h3>
                                    <p className="text-xs text-content-muted mt-1">Preview dan apply memakai logic backend yang sama.</p>
                                </div>
                                <button onClick={() => setShowTemplate((current) => !current)} className="text-sm text-primary hover:text-primary-600">
                                    {showTemplate ? 'Tutup Template JSON' : 'Lihat Template JSON'}
                                </button>
                            </div>
                            {showTemplate && (
                                <div className="px-4 pt-4">
                                    <div className="rounded-card border border-edge bg-surface-sunken p-4">
                                        <pre className="overflow-x-auto text-xs text-content-muted">{templateJson}</pre>
                                    </div>
                                </div>
                            )}
                            <div className="p-4 space-y-4">
                                {!previewResult ? (
                                    <div className="h-64 flex flex-col items-center justify-center text-content-subtle space-y-3 font-medium">
                                        <svg className="w-12 h-12 stroke-current opacity-30" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                                        <p>Jalankan preview untuk melihat hasil validasi server-side.</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                                            <div className="rounded-card border border-edge bg-surface-sunken p-4"><div className="text-xs text-content-muted">Bisa Diimport</div><div className="text-2xl font-bold text-status-live">{previewSummary?.importableCount || 0}</div></div>
                                            <div className="rounded-card border border-edge bg-surface-sunken p-4"><div className="text-xs text-content-muted">Duplikat</div><div className="text-2xl font-bold text-status-warn">{previewSummary?.duplicateCount || 0}</div></div>
                                            <div className="rounded-card border border-edge bg-surface-sunken p-4"><div className="text-xs text-content-muted">Tidak Valid</div><div className="text-2xl font-bold text-status-fault">{previewSummary?.invalidCount || 0}</div></div>
                                            <div className="rounded-card border border-edge bg-surface-sunken p-4"><div className="text-xs text-content-muted">Terfilter</div><div className="text-2xl font-bold text-content-muted">{previewSummary?.filteredOutCount || 0}</div></div>
                                        </div>

                                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                                            <div className="rounded-card border border-edge bg-surface-sunken p-4">
                                                <h4 className="font-semibold text-content mb-2">Statistik Source</h4>
                                                <p className="text-sm text-content-muted">Total: {sourceStats?.totalRows || 0}</p>
                                                <p className="text-sm text-content-muted">Online: {sourceStats?.onlineCount || 0}</p>
                                                <p className="text-sm text-content-muted">Offline: {sourceStats?.offlineCount || 0}</p>
                                                <p className="text-sm text-content-muted">Koordinat Kosong: {sourceStats?.missingCoordsCount || 0}</p>
                                                <p className="text-sm text-content-muted">URL Duplikat: {sourceStats?.duplicateUrlCount || 0}</p>
                                            </div>
                                            <div className="rounded-card border border-edge bg-surface-sunken p-4">
                                                <h4 className="font-semibold text-content mb-2">Pemetaan Field</h4>
                                                <div className="space-y-1 text-sm text-content-muted">
                                                    {Object.entries(previewResult.fieldMapping || {}).map(([key, value]) => (
                                                        <p key={key}><span className="font-medium text-content">{key}</span>: {value}</p>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="rounded-card border border-edge bg-surface-sunken p-4">
                                                <h4 className="font-semibold text-content mb-2">Rincian</h4>
                                                <p className="text-sm text-content-muted">Delivery: {formatBreakdown(previewSummary?.deliveryTypeBreakdown, 'deliveryType')}</p>
                                                <p className="text-sm text-content-muted mt-2">Kategori: {formatBreakdown(sourceStats?.categoryBreakdown, 'category')}</p>
                                            </div>
                                        </div>

                                        {previewResult.warnings?.length > 0 && (
                                            <div className="rounded-card border border-status-warn/30 bg-status-warn/10 p-4">
                                                <h4 className="font-semibold text-status-warn mb-2">Peringatan Impor</h4>
                                                <ul className="space-y-1 text-sm text-content-muted">
                                                    {previewResult.warnings.map((warning) => (
                                                        <li key={warning.code}>[{warning.count}] {warning.message}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm text-left text-content-muted">
                                                <thead className="bg-surface-sunken text-xs uppercase text-content-muted sticky top-0">
                                                    <tr>
                                                        <th className="px-4 py-3 rounded-tl-control">Status</th>
                                                        <th className="px-4 py-3">Nama</th>
                                                        <th className="px-4 py-3">Delivery</th>
                                                        <th className="px-4 py-3">URL</th>
                                                        <th className="px-4 py-3">Health</th>
                                                        <th className="px-4 py-3">TLS</th>
                                                        <th className="px-4 py-3 rounded-tr-control">Alasan</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {previewRows.slice(0, 80).map((row) => (
                                                        <tr key={`${row.index}-${row.resolvedName || 'row'}`} className="border-b border-edge hover:bg-surface-sunken">
                                                            <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.status === 'importable' ? 'bg-status-live/10 text-status-live' : row.status === 'duplicate_name' || row.status === 'duplicate_url' ? 'bg-status-warn/10 text-status-warn' : row.status === 'filtered_out' ? 'bg-surface-sunken text-content-muted' : 'bg-status-fault/10 text-status-fault'}`}>{row.status}</span></td>
                                                            <td className="px-4 py-3 font-medium text-content max-w-[200px] truncate">{row.resolvedName || `Row ${row.index + 1}`}</td>
                                                            <td className="px-4 py-3">
                                                                <div className="font-medium text-content">{row.resolvedDeliveryType || '-'}</div>
                                                                <div className="text-xs text-content-muted">
                                                                    {(row.resolvedStreamSource || '-')}{row.resolvedRecordingEnabled === 0 ? ' • live saja' : ''}
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
                                                            <td colSpan="7" className="px-4 py-4 text-center text-xs text-content-subtle">... dan {previewRows.length - 80} row lainnya disembunyikan demi performa.</td>
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
                </TabPanel>
            )}
        </div>
    );
}
