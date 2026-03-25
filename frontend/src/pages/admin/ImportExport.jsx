import { useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cameraService } from '../../services/cameraService';
import { useNotification } from '../../contexts/NotificationContext';

function inferDeliveryType(url, embedUrl = null, streamSource = null) {
    const normalizedUrl = typeof url === 'string' ? url.trim().toLowerCase() : '';
    const normalizedEmbedUrl = typeof embedUrl === 'string' ? embedUrl.trim().toLowerCase() : '';

    if (streamSource === 'internal') {
        return 'internal_hls';
    }
    if (normalizedUrl.startsWith('wss://') || normalizedUrl.startsWith('ws://')) {
        return normalizedUrl.includes('jsmpeg') ? 'external_jsmpeg' : 'external_custom_ws';
    }
    if (normalizedUrl.includes('/zm/cgi-bin/nph-zms')) {
        return 'external_mjpeg';
    }
    if (normalizedUrl.includes('.m3u8')) {
        return 'external_hls';
    }
    if ((normalizedEmbedUrl.startsWith('https://') || normalizedEmbedUrl.startsWith('http://')) && !normalizedUrl) {
        return 'external_embed';
    }
    if (normalizedUrl.startsWith('https://') || normalizedUrl.startsWith('http://')) {
        return 'external_mjpeg';
    }
    return 'external_embed';
}

export default function ImportExport() {
    const { success, error: showError } = useNotification();
    
    // UI State
    const [activeTab, setActiveTab] = useState('import');
    const [isProcessing, setIsProcessing] = useState(false);
    
    // Import Data State
    const [rawPayload, setRawPayload] = useState(null);
    const [parsedCameras, setParsedCameras] = useState([]);
    
    // Global Overrides
    const [overrideArea, setOverrideArea] = useState('DI YOGYAKARTA');
    const [overrideWatermark, setOverrideWatermark] = useState('');
    const [syncLocationWithName, setSyncLocationWithName] = useState(true);
    const [overrideProxy, setOverrideProxy] = useState(true);
    const [overrideEnabled, setOverrideEnabled] = useState(true);
    const [overrideTls, setOverrideTls] = useState('strict');

    const fileInputRef = useRef(null);

    // --- Export Logic ---
    const handleExport = async () => {
        try {
            setIsProcessing(true);
            const result = await cameraService.exportCameras();
            if (result.success) {
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result.data, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", `cctv_backup_${new Date().toISOString().split('T')[0]}.json`);
                document.body.appendChild(downloadAnchorNode); // required for firefox
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

    // --- Import Logic ---
    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);
                // Try to infer payload structure
                let camerasArray = [];
                if (Array.isArray(json)) {
                    camerasArray = json;
                } else if (json.data && Array.isArray(json.data)) {
                    camerasArray = json.data;
                } else if (json.cameras && Array.isArray(json.cameras)) {
                    camerasArray = json.cameras;
                } else {
                    throw new Error('Could not find an array of cameras in the JSON structure.');
                }
                
                setRawPayload(camerasArray);
                success('File Parsed', `Successfully loaded ${camerasArray.length} items from JSON.`);
            } catch (err) {
                showError('Parse Error', `Invalid JSON file structure: ${err.message}`);
            }
        };
        reader.readAsText(file);
    };

    const clearImport = () => {
        setRawPayload(null);
        setParsedCameras([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // --- Dry-Run Preview Mapping ---
    // Automatically apply Global Overrides to raw JSON to generate preview.
    const previewData = useMemo(() => {
        if (!rawPayload) return [];
        return rawPayload.map(item => {
            // Best-effort property mapping (e.g., Jogja JSON uses "title", standard uses "name")
            const resolvedName = item.name || item.title || item.cctv_title || 'Unnamed Camera';
            const resolvedUrl = item.external_stream_url || item.external_hls_url || item.url || item.cctv_link || item.stream || null;
            const resolvedEmbedUrl = item.external_embed_url || item.embed_url || item.page_url || null;
            const resolvedLat = item.latitude || item.lat || item.cctv_latitude || null;
            const resolvedLng = item.longitude || item.lng || item.cctv_longitude || null;
            const resolvedDeliveryType = inferDeliveryType(resolvedUrl, resolvedEmbedUrl, item.stream_source);

            return {
                name: resolvedName,
                description: overrideWatermark || item.description || '',
                location: syncLocationWithName ? resolvedName : (item.location || ''),
                delivery_type: resolvedDeliveryType,
                stream_source: resolvedDeliveryType === 'internal_hls' ? 'internal' : 'external',
                external_hls_url: resolvedDeliveryType === 'external_hls' ? resolvedUrl : null,
                external_stream_url: resolvedDeliveryType !== 'external_embed' ? resolvedUrl : null,
                external_embed_url: resolvedEmbedUrl,
                external_snapshot_url: item.external_snapshot_url || item.thumbnail_url || item.snapshot_url || null,
                external_origin_mode: resolvedDeliveryType === 'external_embed' ? 'embed' : 'direct',
                private_rtsp_url: item.private_rtsp_url || null,
                latitude: resolvedLat,
                longitude: resolvedLng,
                enable_recording: resolvedDeliveryType === 'internal_hls' ? (item.enable_recording || 0) : 0,
                external_use_proxy: overrideProxy ? 1 : 0,
                external_tls_mode: overrideTls,
                enabled: overrideEnabled ? 1 : 0
            };
        });
    }, [rawPayload, overrideWatermark, syncLocationWithName, overrideProxy, overrideTls, overrideEnabled]);

    // Apply Overrides Handler
    const handleImportSubmit = async () => {
        if (!overrideArea.trim()) {
            showError('Validation', 'Target Area name is required.');
            return;
        }
        if (previewData.length === 0) {
            showError('Validation', 'No camera data to import.');
            return;
        }

        const payload = {
            targetArea: overrideArea,
            cameras: previewData
        };

        try {
            setIsProcessing(true);
            const response = await cameraService.importCameras(payload);
            
            if (response.success) {
                const { imported, skipped, errors } = response.result;
                if (imported > 0) {
                    success('Import Complete', `Successfully imported ${imported} cameras.`);
                }
                if (skipped > 0) {
                    showError('Import Completed with Conflicts', `${skipped} duplicate/invalid cameras were skipped. Check console for details.`);
                    console.warn("Import Skipped Details:", errors);
                }
                
                if (imported > 0) clearImport();
            }
        } catch (err) {
            showError('Import Failed', err?.response?.data?.message || err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Bulk Data Transfer</h1>
                    <p className="text-gray-500 dark:text-gray-400">Import configuration JSON or export existing database backups.</p>
                </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 dark:bg-amber-500/10 dark:border-amber-500/20 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <p className="font-semibold text-amber-900 dark:text-amber-200">Backup Restore untuk metadata kamera existing</p>
                    <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                        Gunakan halaman restore jika tujuan Anda adalah memulihkan `external_hls_url` atau metadata source lain ke kamera yang sudah ada. Import di halaman ini tetap khusus untuk ingest per-area.
                    </p>
                </div>
                <Link
                    to="/admin/backup-restore"
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                >
                    Buka Backup Restore
                </Link>
            </div>

            {/* Tabs */}
            <div className="flex space-x-1 border-b border-gray-200 dark:border-gray-800">
                <button 
                    onClick={() => setActiveTab('import')}
                    className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'import' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}`}
                >
                    Import JSON
                </button>
                <button 
                    onClick={() => setActiveTab('export')}
                    className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'export' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}`}
                >
                    Export Database
                </button>
            </div>

            {/* Export Section */}
            {activeTab === 'export' && (
                <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
                    <div className="p-4 bg-primary-50 dark:bg-primary-900/10 text-primary-900 dark:text-primary-100 rounded-xl border border-primary-200 dark:border-primary-800/30">
                        <h3 className="font-semibold text-lg mb-2">Full Database Export</h3>
                        <p className="text-sm mb-4">Click below to download a complete JSON snapshot of all cameras currently maintained in the system. This schema is fully compatible to be imported back later.</p>
                        <button 
                            onClick={handleExport}
                            disabled={isProcessing}
                            className="bg-primary text-white py-2 px-6 rounded-xl hover:bg-primary-600 transition disabled:opacity-50"
                        >
                            {isProcessing ? 'Processing Download...' : 'Export to JSON'}
                        </button>
                    </div>
                </div>
            )}

            {/* Import Section */}
            {activeTab === 'import' && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Left Col: Params */}
                    <div className="lg:col-span-1 space-y-4">
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-5">
                            <h3 className="font-bold text-gray-900 dark:text-white mb-4">1. Select Data Source</h3>
                            <input
                                type="file"
                                accept=".json"
                                onChange={handleFileUpload}
                                ref={fileInputRef}
                                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                            />
                            {rawPayload && (
                                <p className="mt-3 text-sm text-green-600 dark:text-green-400 font-medium">✓ Loaded {rawPayload.length} objects.</p>
                            )}
                        </div>

                        {rawPayload && (
                            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-5 space-y-4">
                                <h3 className="font-bold text-gray-900 dark:text-white">2. Global Overrides</h3>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Area Name</label>
                                    <input 
                                        type="text" 
                                        value={overrideArea} 
                                        onChange={(e) => setOverrideArea(e.target.value)} 
                                        className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white" 
                                        placeholder="DI YOGYAKARTA"
                                    />
                                    <p className="text-xs text-gray-400 mt-1">If area doesn't exist, it will be automatically created.</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Inject Watermark / Desc</label>
                                    <textarea 
                                        value={overrideWatermark} 
                                        onChange={(e) => setOverrideWatermark(e.target.value)} 
                                        className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block p-2.5 dark:bg-gray-800 dark:border-gray-600 dark:text-white h-20" 
                                        placeholder="(Optional) e.g., SOURCE: JOGJAKOTA"
                                    />
                                </div>
                                
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="checkbox" 
                                            id="syncLoc" 
                                            checked={syncLocationWithName} 
                                            onChange={(e) => setSyncLocationWithName(e.target.checked)}
                                            className="w-4 h-4 text-primary bg-gray-100 border-gray-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                        />
                                        <label htmlFor="syncLoc" className="text-sm font-medium text-gray-900 dark:text-gray-300">
                                            Use Camera Name as Location
                                        </label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="checkbox" 
                                            id="useProxy" 
                                            checked={overrideProxy} 
                                            onChange={(e) => setOverrideProxy(e.target.checked)}
                                            className="w-4 h-4 text-primary bg-gray-100 border-gray-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                        />
                                        <label htmlFor="useProxy" className="text-sm font-medium text-gray-900 dark:text-gray-300">
                                            Enable Built-in Proxy (Mask Stream URL)
                                        </label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="checkbox" 
                                            id="startActive" 
                                            checked={overrideEnabled} 
                                            onChange={(e) => setOverrideEnabled(e.target.checked)}
                                            className="w-4 h-4 text-primary bg-gray-100 border-gray-300 rounded focus:ring-primary dark:focus:ring-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                        />
                                        <label htmlFor="startActive" className="text-sm font-medium text-gray-900 dark:text-gray-300">
                                            Import as Active (Visible to public)
                                        </label>
                                    </div>

                                    <div className="flex flex-col gap-1 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                        <label className="text-xs font-medium text-gray-900 dark:text-gray-300">Mode Keamanan TLS</label>
                                        <select 
                                            value={overrideTls}
                                            onChange={(e) => setOverrideTls(e.target.value)}
                                            className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block p-2 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="strict">Strict (Wajib SSL Valid)</option>
                                            <option value="insecure">Insecure (Abaikan SSL kedaluwarsa)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {rawPayload && (
                            <button 
                                onClick={handleImportSubmit}
                                disabled={isProcessing}
                                className="w-full bg-primary text-white py-3 px-4 rounded-xl shadow flex items-center justify-center gap-2 font-medium hover:bg-primary-600 transition disabled:opacity-50"
                            >
                                {isProcessing ? (
                                    <span>Processing Transaction...</span>
                                ) : (
                                    <span>Commit Import to DB</span>
                                )}
                            </button>
                        )}
                    </div>

                    {/* Right Col: Dry-Run Grid */}
                    <div className="lg:col-span-3">
                        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 flex flex-col h-full">
                            <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
                                <h3 className="font-bold text-gray-900 dark:text-white">Dry-Run Preview</h3>
                                {rawPayload && (
                                    <button onClick={clearImport} className="text-sm text-red-500 hover:text-red-700">Clear</button>
                                )}
                            </div>
                            <div className="p-4 flex-1 overflow-x-auto">
                                {!rawPayload ? (
                                    <div className="h-64 flex flex-col items-center justify-center text-gray-400 space-y-3 font-medium">
                                        <svg className="w-12 h-12 stroke-current opacity-30" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                                        <p>Upload a JSON file to preview mapped data.</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                                        <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-700 dark:text-gray-400 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-3 rounded-tl-lg">Name</th>
                                                <th className="px-4 py-3">Parsed URL</th>
                                                <th className="px-4 py-3">Location Mapping</th>
                                                <th className="px-4 py-3">Watermark</th>
                                                <th className="px-4 py-3 rounded-tr-lg">Coords</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewData.slice(0, 50).map((row, idx) => (
                                                <tr key={idx} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                                                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white truncate max-w-[150px]">{row.name}</td>
                                                    <td className="px-4 py-3 truncate max-w-[200px]" title={row.external_hls_url || row.private_rtsp_url}>
                                                        {row.external_hls_url || row.private_rtsp_url ? (
                                                            <span className="text-green-500 bg-green-50 dark:bg-green-900/10 px-2 py-0.5 rounded textxs">Found</span>
                                                        ) : (
                                                            <span className="text-red-500 bg-red-50 dark:bg-red-900/10 px-2 py-0.5 rounded text-xs">Missing</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 truncate max-w-[150px]">{row.location}</td>
                                                    <td className="px-4 py-3 truncate max-w-[150px]">{row.description}</td>
                                                    <td className="px-4 py-3 font-mono text-xs text-gray-400">
                                                        {row.latitude && row.longitude ? `${row.latitude}, ${row.longitude}` : 'N/A'}
                                                    </td>
                                                </tr>
                                            ))}
                                            {previewData.length > 50 && (
                                                <tr>
                                                    <td colSpan="5" className="px-4 py-4 text-center text-xs text-gray-400">
                                                        ... and {previewData.length - 50} more items hidden for performance.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
