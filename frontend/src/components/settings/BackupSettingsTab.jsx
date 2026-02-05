import { useState, useRef } from 'react';
import { adminAPI } from '../../services/api';
import { Download, Upload, Database, FileJson, Info } from 'lucide-react';

export default function BackupSettingsTab() {
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importMode, setImportMode] = useState('merge');
    const [backupPreview, setBackupPreview] = useState(null);
    const [backupFile, setBackupFile] = useState(null);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const fileInputRef = useRef(null);

    const handleExportBackup = async () => {
        setExporting(true);
        setError(null);
        try {
            // Get JSON data directly (not blob)
            const { data } = await adminAPI.get('/api/admin/backup/export');
            
            // Convert to blob for download
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `rafnet-cctv-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            setSuccess('Backup berhasil diexport');
            setTimeout(() => setSuccess(false), 3000);
        } catch (error) {
            console.error('Failed to export backup:', error);
            setError('Gagal export backup: ' + (error.response?.data?.message || error.message));
        } finally {
            setExporting(false);
        }
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setError(null);
        setBackupPreview(null);

        try {
            const text = await file.text();
            const backup = JSON.parse(text);
            
            // Get preview
            const { data } = await adminAPI.post('/api/admin/backup/preview', { backup });
            setBackupPreview(data.data);
            setBackupFile(backup);
        } catch (error) {
            console.error('Failed to read backup file:', error);
            setError('File backup tidak valid');
            setBackupFile(null);
            setBackupPreview(null);
        }
    };

    const handleImportBackup = async () => {
        if (!backupFile) {
            setError('Pilih file backup terlebih dahulu');
            return;
        }

        if (!window.confirm(
            importMode === 'replace' 
                ? '⚠️ PERINGATAN: Mode REPLACE akan menghapus semua data existing dan menggantinya dengan data dari backup. Lanjutkan?' 
                : 'Import backup dalam mode MERGE? Data existing akan dipertahankan.'
        )) {
            return;
        }

        setImporting(true);
        setError(null);
        try {
            const { data } = await adminAPI.post('/api/admin/backup/import', {
                backup: backupFile,
                mode: importMode
            });
            
            setSuccess(`Backup berhasil diimport: ${Object.keys(data.data.imported).length} tabel`);
            setBackupFile(null);
            setBackupPreview(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            
            setTimeout(() => {
                setSuccess(false);
                window.location.reload();
            }, 2000);
        } catch (error) {
            console.error('Failed to import backup:', error);
            setError('Gagal import backup: ' + (error.response?.data?.message || error.message));
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-6">
                <Database className="w-6 h-6 text-purple-600" />
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        Backup & Restore Database
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Export/import data untuk migrasi atau backup
                    </p>
                </div>
            </div>

            <div className="space-y-6">
                {/* Export Section */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                        <Download className="w-5 h-5 text-blue-600" />
                        Export Backup
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Download semua data database dalam format JSON untuk migrasi ke backend Go atau backup.
                    </p>
                    <button
                        onClick={handleExportBackup}
                        disabled={exporting}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg 
                                 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                                 transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        {exporting ? 'Exporting...' : 'Export Backup'}
                    </button>
                </div>

                {/* Import Section */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                        <Upload className="w-5 h-5 text-green-600" />
                        Import Backup
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Restore data dari file backup JSON.
                    </p>

                    <div className="space-y-4">
                        {/* File Input */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Pilih File Backup
                            </label>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json"
                                onChange={handleFileSelect}
                                disabled={importing}
                                className="block w-full text-sm text-gray-900 dark:text-white
                                         border border-gray-300 dark:border-gray-600 rounded-lg
                                         cursor-pointer bg-gray-50 dark:bg-gray-700
                                         focus:outline-none disabled:opacity-50"
                            />
                        </div>

                        {/* Import Mode */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Mode Import
                            </label>
                            <select
                                value={importMode}
                                onChange={(e) => setImportMode(e.target.value)}
                                disabled={importing}
                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                                         focus:ring-2 focus:ring-purple-500 focus:border-transparent
                                         disabled:opacity-50"
                            >
                                <option value="merge">Merge (Gabung dengan data existing)</option>
                                <option value="replace">Replace (Ganti semua data)</option>
                            </select>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {importMode === 'merge' 
                                    ? '✓ Data existing dipertahankan, hanya menambah data baru'
                                    : '⚠️ PERINGATAN: Semua data existing akan dihapus!'}
                            </p>
                        </div>

                        {/* Backup Preview */}
                        {backupPreview && (
                            <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <FileJson className="w-5 h-5 text-purple-600" />
                                    <h4 className="font-medium text-gray-900 dark:text-white">
                                        Preview Backup
                                    </h4>
                                </div>
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-600 dark:text-gray-400">Version:</span>
                                        <span className="font-mono text-gray-900 dark:text-white">
                                            {backupPreview.version}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-600 dark:text-gray-400">Exported:</span>
                                        <span className="font-mono text-gray-900 dark:text-white">
                                            {new Date(backupPreview.exported_at).toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                    <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
                                        <p className="text-gray-600 dark:text-gray-400 mb-2">Data Tables:</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {Object.entries(backupPreview.tables).map(([table, count]) => (
                                                <div key={table} className="flex justify-between text-xs">
                                                    <span className="text-gray-600 dark:text-gray-400">{table}:</span>
                                                    <span className="font-mono text-gray-900 dark:text-white">
                                                        {count} rows
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Import Button */}
                        <button
                            onClick={handleImportBackup}
                            disabled={!backupFile || importing}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg 
                                     hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed
                                     transition-colors"
                        >
                            <Upload className="w-4 h-4" />
                            {importing ? 'Importing...' : 'Import Backup'}
                        </button>
                    </div>
                </div>

                {/* Info Box */}
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                    <div className="flex gap-3">
                        <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-amber-800 dark:text-amber-300">
                            <p className="font-medium mb-2">Catatan Penting:</p>
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>Backup mencakup semua data: cameras, users, areas, settings, dll</li>
                                <li>Mode MERGE: Aman untuk restore partial data</li>
                                <li>Mode REPLACE: Gunakan untuk migrasi penuh (HAPUS semua data existing)</li>
                                <li>Backup dalam format JSON standar, mudah diimport ke Go backend</li>
                                <li>Simpan file backup di tempat aman sebagai disaster recovery</li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Error/Success Messages */}
                {error && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                        <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                    </div>
                )}

                {success && (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                        <p className="text-sm text-green-800 dark:text-green-300">{success}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
