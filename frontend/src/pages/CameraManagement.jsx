import { useEffect, useState } from 'react';
import { cameraService } from '../services/cameraService';
import { areaService } from '../services/areaService';

export default function CameraManagement() {
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingCamera, setEditingCamera] = useState(null);
    const [areas, setAreas] = useState([]);
    const [formData, setFormData] = useState({
        name: '',
        private_rtsp_url: '',
        description: '',
        location: '',
        group_name: '',
        area_id: '',
        enabled: true,
    });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        loadCameras();
        loadAreas();
    }, []);

    const loadAreas = async () => {
        try {
            const response = await areaService.getAllAreas();
            if (response.success) setAreas(response.data);
        } catch (err) {
            console.error('Load areas error:', err);
        }
    };

    const loadCameras = async () => {
        try {
            setLoading(true);
            const response = await cameraService.getAllCameras();
            if (response.success) setCameras(response.data);
        } catch (err) {
            console.error('Load cameras error:', err);
        } finally {
            setLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingCamera(null);
        setFormData({ name: '', private_rtsp_url: '', description: '', location: '', group_name: '', area_id: '', enabled: true });
        setError('');
        setShowModal(true);
    };

    const openEditModal = (camera) => {
        setEditingCamera(camera);
        setFormData({
            name: camera.name,
            private_rtsp_url: camera.private_rtsp_url,
            description: camera.description || '',
            location: camera.location || '',
            group_name: camera.group_name || '',
            area_id: camera.area_id || '',
            enabled: camera.enabled === 1,
        });
        setError('');
        setShowModal(true);
    };

    const handleChange = (e) => {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        setFormData({ ...formData, [e.target.name]: value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            const data = { ...formData, enabled: formData.enabled ? 1 : 0 };
            const result = editingCamera 
                ? await cameraService.updateCamera(editingCamera.id, data)
                : await cameraService.createCamera(data);
            if (result.success) {
                setShowModal(false);
                loadCameras();
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (camera) => {
        if (!window.confirm(`Delete camera "${camera.name}"?`)) return;
        try {
            const result = await cameraService.deleteCamera(camera.id);
            if (result.success) loadCameras();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to delete');
        }
    };

    const toggleStatus = async (camera) => {
        try {
            await cameraService.updateCamera(camera.id, { enabled: camera.enabled === 1 ? 0 : 1 });
            loadCameras();
        } catch (err) {
            alert('Failed to update status');
        }
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-500 mb-1">Hardware Management</p>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Cameras</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">Configure and monitor your CCTV endpoints</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-sky-500/25 transition-all"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add Camera
                </button>
            </div>

            {/* Content */}
            {loading ? (
                <div className="flex items-center justify-center min-h-[400px]">
                    <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
                </div>
            ) : cameras.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4 text-gray-400">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Cameras</h3>
                    <p className="text-gray-500 dark:text-gray-400 mb-6">Add your first RTSP camera to get started</p>
                    <button onClick={openAddModal} className="text-sky-500 font-medium hover:text-sky-600 transition-colors">
                        Add First Camera →
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {cameras.map((camera) => (
                        <div key={camera.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden hover:shadow-lg transition-shadow">
                            {/* Preview */}
                            <div className="aspect-video bg-gray-100 dark:bg-gray-800 relative">
                                <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600">
                                    <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                </div>
                                <div className="absolute top-3 right-3">
                                    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                                        camera.enabled
                                            ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400'
                                            : 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400'
                                    }`}>
                                        {camera.enabled ? 'Live' : 'Offline'}
                                    </span>
                                </div>
                                <div className="absolute bottom-3 left-3">
                                    <p className="text-xs font-medium text-sky-400 mb-0.5">{camera.area_name || 'Uncategorized'}</p>
                                    <h3 className="text-sm font-bold text-white drop-shadow-lg">{camera.name}</h3>
                                </div>
                            </div>

                            {/* Info */}
                            <div className="p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Location</p>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">{camera.location || 'Not specified'}</p>
                                    </div>
                                    <div className="flex gap-1">
                                        <button onClick={() => openEditModal(camera)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-all">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                        </button>
                                        <button onClick={() => handleDelete(camera)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-800">
                                    <span className="text-xs text-gray-400">ID: {camera.id}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{camera.enabled ? 'On' : 'Off'}</span>
                                        <button
                                            onClick={() => toggleStatus(camera)}
                                            className={`relative w-10 h-5 rounded-full transition-colors ${camera.enabled ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-700'}`}
                                        >
                                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${camera.enabled ? 'left-5' : 'left-0.5'}`}></div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                    {editingCamera ? 'Edit Camera' : 'Add Camera'}
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Configure RTSP stream</p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            {error && (
                                <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                                    <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
                                    <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Front Entrance" required />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Area</label>
                                    <select name="area_id" value={formData.area_id} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500">
                                        <option value="">Select Area</option>
                                        {areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">RTSP URL</label>
                                <input type="text" name="private_rtsp_url" value={formData.private_rtsp_url} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="rtsp://user:pass@ip:port/path" required />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Location</label>
                                    <input type="text" name="location" value={formData.location} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Building A" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Group</label>
                                    <input type="text" name="group_name" value={formData.group_name} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Security" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Description</label>
                                <textarea name="description" value={formData.description} onChange={handleChange} rows="2" className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" placeholder="Optional notes..." />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" disabled={submitting}>
                                    Cancel
                                </button>
                                <button type="submit" className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white font-medium rounded-xl shadow-lg shadow-sky-500/25 hover:from-sky-600 hover:to-blue-700 disabled:opacity-50 transition-all" disabled={submitting}>
                                    {submitting ? 'Saving...' : (editingCamera ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
