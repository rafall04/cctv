import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { areaService } from '../services/areaService';

export default function AreaManagement() {
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingArea, setEditingArea] = useState(null);
    const [formData, setFormData] = useState({ name: '', description: '' });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        loadAreas();
    }, []);

    const loadAreas = async () => {
        try {
            setLoading(true);
            const response = await areaService.getAllAreas();
            if (response.success) setAreas(response.data);
        } catch (err) {
            console.error('Load areas error:', err);
        } finally {
            setLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingArea(null);
        setFormData({ name: '', description: '' });
        setError('');
        setShowModal(true);
    };

    const openEditModal = (area) => {
        setEditingArea(area);
        setFormData({ name: area.name, description: area.description || '' });
        setError('');
        setShowModal(true);
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            const result = editingArea
                ? await areaService.updateArea(editingArea.id, formData)
                : await areaService.createArea(formData);
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
        if (!window.confirm(`Delete area "${area.name}"?`)) return;
        try {
            const result = await areaService.deleteArea(area.id);
            if (result.success) loadAreas();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to delete');
        }
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-500 mb-1">Logical Organization</p>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Areas</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">Group cameras by location or function</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-sky-500/25 transition-all"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Create Area
                </button>
            </div>

            {/* Content */}
            {loading ? (
                <div className="flex items-center justify-center min-h-[400px]">
                    <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
                </div>
            ) : areas.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4 text-gray-400">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Areas</h3>
                    <p className="text-gray-500 dark:text-gray-400 mb-6">Create your first area to organize cameras</p>
                    <button onClick={openAddModal} className="text-sky-500 font-medium hover:text-sky-600 transition-colors">
                        Create First Area →
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {areas.map((area) => (
                        <div key={area.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 hover:shadow-lg transition-shadow">
                            <div className="flex justify-between items-start mb-5">
                                <div className="w-12 h-12 bg-sky-100 dark:bg-sky-500/10 rounded-xl flex items-center justify-center text-sky-500">
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                    </svg>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => openEditModal(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-all">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                    <button onClick={() => handleDelete(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{area.name}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-5 min-h-[2.5rem]">
                                {area.description || 'No description provided'}
                            </p>

                            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-800">
                                <span className="text-xs text-gray-400">ID: {area.id}</span>
                                <Link to="/admin/cameras" className="text-sm font-medium text-sky-500 hover:text-sky-600 transition-colors flex items-center gap-1">
                                    View Cameras
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                    {editingArea ? 'Edit Area' : 'Create Area'}
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Define a logical group</p>
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

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Area Name</label>
                                <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Building A" required />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Description</label>
                                <textarea name="description" value={formData.description} onChange={handleChange} rows="3" className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" placeholder="Optional notes..." />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" disabled={submitting}>
                                    Cancel
                                </button>
                                <button type="submit" className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white font-medium rounded-xl shadow-lg shadow-sky-500/25 hover:from-sky-600 hover:to-blue-700 disabled:opacity-50 transition-all" disabled={submitting}>
                                    {submitting ? 'Saving...' : (editingArea ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
