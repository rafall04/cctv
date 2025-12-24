import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { areaService } from '../services/areaService';

export default function AreaManagement() {
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingArea, setEditingArea] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
    });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        loadAreas();
    }, []);

    const loadAreas = async () => {
        try {
            setLoading(true);
            const response = await areaService.getAllAreas();
            if (response.success) {
                setAreas(response.data);
            }
        } catch (err) {
            console.error('Load areas error:', err);
        } finally {
            setLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingArea(null);
        setFormData({
            name: '',
            description: '',
        });
        setError('');
        setShowModal(true);
    };

    const openEditModal = (area) => {
        setEditingArea(area);
        setFormData({
            name: area.name,
            description: area.description || '',
        });
        setError('');
        setShowModal(true);
    };

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value,
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);

        try {
            let result;
            if (editingArea) {
                result = await areaService.updateArea(editingArea.id, formData);
            } else {
                result = await areaService.createArea(formData);
            }

            if (result.success) {
                setShowModal(false);
                loadAreas();
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (area) => {
        if (!window.confirm(`Are you sure you want to delete area "${area.name}"?`)) return;

        try {
            const result = await areaService.deleteArea(area.id);
            if (result.success) {
                loadAreas();
            }
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to delete area');
        }
    };

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse"></div>
                        <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.3em]">Logical Organization</span>
                    </div>
                    <h1 className="text-4xl font-black text-white tracking-tighter">Areas</h1>
                    <p className="text-dark-400 font-medium mt-1">Group your cameras by location, department, or function</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="px-8 py-4 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-primary-500/20 active:scale-95 flex items-center gap-3"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create New Area
                </button>
            </div>

            {/* Main content */}
            <div className="space-y-6">
                {loading ? (
                    <div className="flex flex-col items-center justify-center min-h-[400px]">
                        <div className="w-12 h-12 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin"></div>
                    </div>
                ) : areas.length === 0 ? (
                    <div className="text-center py-24 bg-dark-900/40 border border-white/5 rounded-[3rem] backdrop-blur-sm">
                        <div className="w-20 h-20 bg-dark-800 rounded-3xl flex items-center justify-center mx-auto mb-6 text-dark-600">
                            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-black text-white mb-2">No Areas Defined</h3>
                        <p className="text-dark-500 max-w-xs mx-auto mb-8">Organize your camera network by creating your first area.</p>
                        <button onClick={openAddModal} className="text-primary-500 font-black text-[10px] uppercase tracking-[0.2em] hover:text-primary-400 transition-colors">
                            Create First Area →
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {areas.map((area) => (
                            <div key={area.id} className="group bg-dark-900/40 border border-white/5 rounded-[2.5rem] p-8 hover:bg-dark-900/60 transition-all duration-500 hover:border-primary-500/20">
                                <div className="flex justify-between items-start mb-8">
                                    <div className="w-14 h-14 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 border border-primary-500/10">
                                        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                        </svg>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => openEditModal(area)} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-dark-400 hover:bg-primary-500/10 hover:text-primary-500 transition-all">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                        </button>
                                        <button onClick={() => handleDelete(area)} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-dark-400 hover:bg-red-500/10 hover:text-red-500 transition-all">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>

                                <h3 className="text-2xl font-black text-white mb-3 group-hover:text-primary-400 transition-colors">{area.name}</h3>
                                <p className="text-sm text-dark-400 line-clamp-2 mb-8 min-h-[2.5rem]">{area.description || 'No description provided for this area.'}</p>

                                <div className="pt-6 border-t border-white/5 flex items-center justify-between">
                                    <span className="text-[10px] font-black text-dark-600 uppercase tracking-[0.2em]">ID: {area.id}</span>
                                    <Link to="/admin/cameras" className="text-[10px] font-black text-primary-500 uppercase tracking-[0.2em] hover:text-primary-400 transition-colors flex items-center gap-2">
                                        View Cameras
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </Link>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[200] p-6 animate-in fade-in duration-300">
                    <div className="bg-dark-900 max-w-md w-full rounded-[2.5rem] shadow-2xl border border-white/5 overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                            <div>
                                <h3 className="text-xl font-black text-white tracking-tight">
                                    {editingArea ? 'Edit Area Details' : 'Create New Area'}
                                </h3>
                                <p className="text-xs text-dark-500 mt-1">Define a logical group for cameras</p>
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

                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Area Name</label>
                                <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700" placeholder="e.g., Building A" required />
                            </div>

                            <div className="space-y-2">
                                <label className="block text-[10px] font-black text-dark-500 uppercase tracking-widest ml-1">Description</label>
                                <textarea name="description" value={formData.description} onChange={handleChange} className="w-full bg-dark-950 border border-white/5 rounded-2xl px-5 py-3.5 text-white text-sm focus:outline-none focus:border-primary-500/50 transition-all placeholder:text-dark-700 resize-none" rows="4" placeholder="Optional notes about this location..." />
                            </div>

                            <div className="flex items-center gap-4 pt-4">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-6 py-4 bg-dark-800 hover:bg-dark-700 text-dark-300 font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all" disabled={submitting}>Cancel</button>
                                <button type="submit" className="flex-[2] px-6 py-4 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all shadow-xl shadow-primary-500/20 disabled:opacity-50" disabled={submitting}>
                                    {submitting ? 'Creating...' : (editingArea ? 'Update Area' : 'Create Area')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
