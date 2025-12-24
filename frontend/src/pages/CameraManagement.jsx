import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cameraService } from '../services/cameraService';
import { areaService } from '../services/areaService';

export default function CameraManagement() {
    const navigate = useNavigate();
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
            if (response.success) {
                setAreas(response.data);
            }
        } catch (err) {
            console.error('Load areas error:', err);
        }
    };

    const loadCameras = async () => {
        try {
            setLoading(true);
            const response = await cameraService.getAllCameras();
            if (response.success) {
                setCameras(response.data);
            }
        } catch (err) {
            console.error('Load cameras error:', err);
        } finally {
            setLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingCamera(null);
        setFormData({
            name: '',
            private_rtsp_url: '',
            description: '',
            location: '',
            group_name: '',
            area_id: '',
            enabled: true,
        });
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
        setFormData({
            ...formData,
            [e.target.name]: value,
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);

        try {
            const data = {
                ...formData,
                enabled: formData.enabled ? 1 : 0,
            };

            let result;
            if (editingCamera) {
                result = await cameraService.updateCamera(editingCamera.id, data);
            } else {
                result = await cameraService.createCamera(data);
            }

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
        if (!window.confirm(`Are you sure you want to delete camera "${camera.name}"?`)) return;

        try {
            const result = await cameraService.deleteCamera(camera.id);
            if (result.success) {
                loadCameras();
            }
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to delete camera');
        }
    };

    const toggleStatus = async (camera) => {
        try {
            await cameraService.updateCamera(camera.id, {
                enabled: camera.enabled === 1 ? 0 : 1,
            });
            loadCameras();
        } catch (err) {
            alert('Failed to update camera status');
        }
    };

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse"></div>
                        <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.3em]">Hardware Management</span>
                    </div>
                    <h1 className="text-4xl font-black text-white tracking-tighter">Cameras</h1>
                    <p className="text-dark-400 font-medium mt-1">Configure and monitor your CCTV hardware endpoints</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="px-8 py-4 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-primary-500/20 active:scale-95 flex items-center gap-3"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Register New Camera
                </button>
            </div>

            {/* Main content */}
            <div className="space-y-6">
                {loading ? (
                    <div className="flex flex-col items-center justify-center min-h-[400px]">
                        <div className="w-12 h-12 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin"></div>
                    </div>
                ) : cameras.length === 0 ? (
                    <div className="text-center py-24 bg-dark-900/40 border border-white/5 rounded-[3rem] backdrop-blur-sm">
                        <div className="w-20 h-20 bg-dark-800 rounded-3xl flex items-center justify-center mx-auto mb-6 text-dark-600">
                            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-black text-white mb-2">No Cameras Registered</h3>
                        <p className="text-dark-500 max-w-xs mx-auto mb-8">Start by adding your first RTSP stream to the network.</p>
                        <button onClick={openAddModal} className="text-primary-500 font-black text-[10px] uppercase tracking-[0.2em] hover:text-primary-400 transition-colors">
                            Add First Camera →
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {cameras.map((camera) => (
                            <div key={camera.id} className="group bg-dark-900/40 border border-white/5 rounded-[2.5rem] overflow-hidden hover:bg-dark-900/60 transition-all duration-500 hover:border-primary-500/20">
                                <div className="aspect-video bg-black relative overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60"></div>
                                    <div className="absolute inset-0 flex items-center justify-center text-dark-800 group-hover:scale-110 transition-transform duration-700">
                                        <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                    <div className="absolute top-5 right-5">
                                        <span className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest backdrop-blur-md border ${camera.enabled
                                                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                                                : 'bg-red-500/10 border-red-500/20 text-red-400'
                                            }`}>
                                            {camera.enabled ? 'Live' : 'Offline'}
                                        </span>
                                    </div>
                                    <div className="absolute bottom-5 left-5 right-5 flex justify-between items-end">
                                        <div>
                                            <p className="text-[10px] font-black text-primary-500 uppercase tracking-[0.2em] mb-1">{camera.area_name || 'Uncategorized'}</p>
                                            <h3 className="text-lg font-black text-white truncate max-w-[180px]">{camera.name}</h3>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-8">
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black text-dark-500 uppercase tracking-widest">Location</p>
                                            <p className="text-sm font-bold text-dark-200">{camera.location || 'Not specified'}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => openEditModal(camera)} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-dark-400 hover:bg-primary-500/10 hover:text-primary-500 transition-all">
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                </svg>
                                            </button>
                                            <button onClick={() => handleDelete(camera)} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-dark-400 hover:bg-red-500/10 hover:text-red-500 transition-all">
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="pt-6 border-t border-white/5 flex items-center justify-between">
                                        <span className="text-[10px] font-black text-dark-600 uppercase tracking-[0.2em]">ID: {camera.id}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-black text-dark-500 uppercase tracking-widest">{camera.enabled ? 'Enabled' : 'Disabled'}</span>
                                            <button
                                                onClick={() => toggleStatus(camera)}
                                                className={`relative w-10 h-5 rounded-full transition-all duration-300 ${camera.enabled ? 'bg-primary-500' : 'bg-dark-700'}`}
                                            >
                                                <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all duration-300 ${camera.enabled ? 'left-6' : 'left-1'}`}></div>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[200] p-6 animate-in fade-in duration-300">
                    <div className="bg-dark-900 max-w-xl w-full rounded-[2.5rem] shadow-2xl border border-white/5 overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                            <div>
                                <h3 className="text-xl font-black text-white tracking-tight">
                                    {editingCamera ? 'Edit Camera Configuration' : 'Register New Camera'}
                                </h3>
                                <p className="text-xs text-dark-500 mt-1">Configure RTSP stream and metadata</p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-dark-400 hover:text-white transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-8 space-y-6">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3">
                                    <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-red-400 text-xs font-bold">{error}</p>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Camera Name</label>
                                    <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700" placeholder="e.g., Front Entrance" required />
                                </div>
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Area / Category</label>
                                    <select name="area_id" value={formData.area_id} onChange={handleChange} className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all appearance-none">
                                        <option value="">Select Area</option>
                                        {areas.map(area => (
                                            <option key={area.id} value={area.id}>{area.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">RTSP Stream URL</label>
                                <input type="text" name="private_rtsp_url" value={formData.private_rtsp_url} onChange={handleChange} className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm font-mono focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700" placeholder="rtsp://user:pass@ip:port/path" required />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Physical Location</label>
                                    <input type="text" name="location" value={formData.location} onChange={handleChange} className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700" placeholder="e.g., Building A, Floor 2" />
                                </div>
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Logical Group</label>
                                    <input type="text" name="group_name" value={formData.group_name} onChange={handleChange} className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700" placeholder="e.g., Security" />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Description</label>
                                <textarea name="description" value={formData.description} onChange={handleChange} className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700 resize-none" rows="3" placeholder="Optional notes about this camera..." />
                            </div>

                            <div className="flex items-center gap-4 pt-4">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-6 py-4 bg-dark-800 hover:bg-dark-700 text-dark-300 font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all" disabled={submitting}>Cancel</button>
                                <button type="submit" className="flex-[2] px-6 py-4 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all shadow-xl shadow-primary-500/20 disabled:opacity-50" disabled={submitting}>
                                    {submitting ? 'Processing...' : (editingCamera ? 'Update Configuration' : 'Register Camera')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
