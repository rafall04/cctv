import { useState, useEffect } from 'react';
import { useNotification } from '../../contexts/NotificationContext';
import { Icons } from '../../components/ui/Icons';
import apiClient from '../../services/apiClient';

export default function DiscoveryDashboard() {
    const { showNotification } = useNotification();
    
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [areas, setAreas] = useState([]);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isScraping, setIsScraping] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    
    // Modal states
    const [showImportModal, setShowImportModal] = useState(false);
    const [selectedAreaId, setSelectedAreaId] = useState('');

    useEffect(() => {
        fetchItems();
        fetchAreas();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchItems = async () => {
        try {
            setLoading(true);
            const response = await apiClient.get('/admin/discovery');
            if (response.data.success) {
                setItems(response.data.data);
            }
        } catch (error) {
            showNotification('error', 'Gagal mengambil data discovery');
        } finally {
            setLoading(false);
        }
    };

    const fetchAreas = async () => {
        try {
            const response = await apiClient.get('/areas');
            if (response.data.success) {
                setAreas(response.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch areas:', error);
        }
    };

    const handleScrape = async () => {
        if (!confirm('Jalankan Auto-Discovery untuk Yogyakarta (ATCS)?')) return;
        
        try {
            setIsScraping(true);
            showNotification('info', 'Menjalankan Scraper...', 3000);
            const response = await apiClient.post('/admin/discovery/scrape', {
                source_type: 'jogja_atcs'
            });
            
            if (response.data.success) {
                const results = response.data.data;
                showNotification('success', `Scraping Selesai: ${results.newly_added} Baru, ${results.duplicates_flagged} Duplikat, ${results.links_updated} Link Berubah.`);
                fetchItems();
            }
        } catch (error) {
            showNotification('error', error.response?.data?.message || 'Gagal menjalankan scraper');
        } finally {
            setIsScraping(false);
        }
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const pendingIds = items.filter(i => i.status === 'pending' || i.status === 'link_changed').map(i => i.id);
            setSelectedIds(new Set(pendingIds));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectOne = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleImportSubmit = async () => {
        if (!selectedAreaId) {
            showNotification('error', 'Pilih Area tujuan terlebih dahulu');
            return;
        }

        try {
            setIsImporting(true);
            const response = await apiClient.post('/admin/discovery/import', {
                ids: Array.from(selectedIds),
                target_area_id: parseInt(selectedAreaId)
            });
            
            if (response.data.success) {
                showNotification('success', response.data.message);
                setShowImportModal(false);
                setSelectedIds(new Set());
                fetchItems();
            }
        } catch (error) {
            showNotification('error', 'Gagal melakukan import data');
        } finally {
            setIsImporting(false);
        }
    };

    const handleRejectSelected = async () => {
        if (!confirm(`Tolak (Reject) ${selectedIds.size} kamera yang dipilih? Data ini tidak akan di-import.`)) return;
        
        try {
            const response = await apiClient.post('/admin/discovery/reject', {
                ids: Array.from(selectedIds)
            });
            
            if (response.data.success) {
                showNotification('success', response.data.message);
                setSelectedIds(new Set());
                fetchItems();
            }
        } catch (error) {
            showNotification('error', 'Gagal menolak data');
        }
    };

    const getStatusBadge = (status) => {
        switch(status) {
            case 'pending': return <span className="px-2 py-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs rounded-full font-medium">NEW</span>;
            case 'duplicate': return <span className="px-2 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs rounded-full font-medium">DUPLICATE RISK</span>;
            case 'link_changed': return <span className="px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 text-xs rounded-full font-medium">LINK CHANGED</span>;
            case 'imported': return <span className="px-2 py-1 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 text-xs rounded-full font-medium">Imported</span>;
            case 'rejected': return <span className="px-2 py-1 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-xs rounded-full font-medium">Rejected</span>;
            default: return <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded-full font-medium">{status}</span>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Discovery & Sync</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Karantina sementara untuk data CCTV hasil scraping. Review sebelum dimasukkan ke Map View.
                    </p>
                </div>
                
                <button
                    onClick={handleScrape}
                    disabled={isScraping}
                    className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm font-medium"
                >
                    <Icons.Refresh className={`w-5 h-5 mr-2 ${isScraping ? 'animate-spin' : ''}`} />
                    {isScraping ? 'Mencari...' : 'Run Auto-Discovery'}
                </button>
            </div>

            {/* Selection Actions */}
            {selectedIds.size > 0 && (
                <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl flex items-center justify-between border border-indigo-100 dark:border-indigo-800">
                    <span className="text-indigo-800 dark:text-indigo-300 font-medium">
                        {selectedIds.size} kamera dipilih
                    </span>
                    <div className="space-x-3">
                        <button
                            onClick={handleRejectSelected}
                            className="px-4 py-2 bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors font-medium text-sm"
                        >
                            Reject Selected
                        </button>
                        <button
                            onClick={() => setShowImportModal(true)}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-medium text-sm"
                        >
                            Import Selected to Cameras
                        </button>
                    </div>
                </div>
            )}

            {/* Data Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900/50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left">
                                    <input
                                        type="checkbox"
                                        onChange={handleSelectAll}
                                        checked={items.length > 0 && items.filter(i => i.status === 'pending' || i.status === 'link_changed').every(i => selectedIds.has(i.id))}
                                        className="h-4 w-4 text-primary-600 rounded border-gray-300 dark:border-gray-600 focus:ring-primary-500 bg-white dark:bg-gray-700"
                                    />
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nama Kamera</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sumber</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lokasi</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Waktu Ditarik</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {loading ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                                        Memuat data...
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                                        <div className="flex flex-col items-center">
                                            <Icons.Inbox className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
                                            <p>Belum ada data di Ruang Karantina</p>
                                            <p className="text-sm mt-1">Klik &quot;Run Auto-Discovery&quot; untuk memindai kamera publik.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                items.map((item) => (
                                    <tr 
                                        key={item.id} 
                                        className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${selectedIds.has(item.id) ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}`}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(item.id)}
                                                onChange={() => handleSelectOne(item.id)}
                                                disabled={item.status === 'imported' || item.status === 'rejected' || item.status === 'duplicate'}
                                                className="h-4 w-4 text-primary-600 rounded border-gray-300 dark:border-gray-600 focus:ring-primary-500 bg-white dark:bg-gray-700 disabled:opacity-50"
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getStatusBadge(item.status)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1" title={item.name}>
                                                    {item.name}
                                                </span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1 break-all line-clamp-1" title={item.hls_url}>
                                                    {item.hls_url}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            {item.source_type}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {item.latitude ? (
                                                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono border border-gray-200 dark:border-gray-600 rounded px-2 py-1 inline-block">
                                                    {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400 italic">No GPS</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            {new Date(item.created_at).toLocaleString('id-ID', {
                                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                                            })}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Import Modal */}
            {showImportModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                        <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Import {selectedIds.size} Kamera</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                Pilih Area tujuan untuk memindahkan kamera yang dipilih ke Map View utama.
                            </p>
                        </div>
                        
                        <div className="p-6">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Tujuan Area Induk <span className="text-red-500">*</span>
                            </label>
                            <select
                                value={selectedAreaId}
                                onChange={(e) => setSelectedAreaId(e.target.value)}
                                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            >
                                <option value="">-- Pilih Area --</option>
                                {areas.map(area => (
                                    <option key={area.id} value={area.id}>{area.name}</option>
                                ))}
                            </select>
                            
                            <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-100 dark:border-yellow-800">
                                <p className="text-sm text-yellow-800 dark:text-yellow-300 flex items-start">
                                    <Icons.Info className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
                                    <span>Kamera yang di-import akan otomatis dikonfigurasi sebagai <strong>External Stream</strong> dengan mode <strong>Proxy Aktif</strong> (CORS Safe).</span>
                                </p>
                            </div>
                        </div>
                        
                        <div className="p-6 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700 flex justify-end space-x-3">
                            <button
                                onClick={() => setShowImportModal(false)}
                                disabled={isImporting}
                                className="px-4 py-2 font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                                Batal
                            </button>
                            <button
                                onClick={handleImportSubmit}
                                disabled={isImporting || !selectedAreaId}
                                className="px-4 py-2 font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center"
                            >
                                {isImporting ? (
                                    <>
                                        <Icons.Refresh className="w-4 h-4 mr-2 animate-spin" />
                                        Mengunggah...
                                    </>
                                ) : 'Konfirmasi Import'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
