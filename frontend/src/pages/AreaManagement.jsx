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
        rt: '', 
        rw: '', 
        kelurahan: '', 
        kecamatan: '' 
    });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [filterKecamatan, setFilterKecamatan] = useState('');

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
        setFormData({ name: '', description: '', rt: '', rw: '', kelurahan: '', kecamatan: '' });
        setError('');
        setShowModal(true);
    };

    const openEditModal = (area) => {
        setEditingArea(area);
        setFormData({ 
            name: area.name, 
            description: area.description || '',
            rt: area.rt || '',
            rw: area.rw || '',
            kelurahan: area.kelurahan || '',
            kecamatan: area.kecamatan || '',
        });
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

    // Get unique kecamatans for filter
    const kecamatans = [...new Set(areas.map(a => a.kecamatan).filter(Boolean))].sort();
    
    // Filter areas
    const filteredAreas = filterKecamatan 
        ? areas.filter(a => a.kecamatan === filterKecamatan)
        : areas;

    // Build location string
    const getLocationString = (area) => {
        const parts = [];
        if (area.rt) parts.push(`RT ${area.rt}`);
        if (area.rw) parts.push(`RW ${area.rw}`);
        if (area.kelurahan) parts.push(area.kelurahan);
        if (area.kecamatan) parts.push(area.kecamatan);
        return parts.join(', ') || 'No location details';
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-500 mb-1">Logical Organization</p>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Areas</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">Group cameras by RT, RW, Kelurahan, Kecamatan</p>
                </div>
                <div className="flex items-center gap-3">
                    {kecamatans.length > 0 && (
                        <select
                            value={filterKecamatan}
                            onChange={(e) => setFilterKecamatan(e.target.value)}
                            className="px-4 py-2.5 bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        >
                            <option value="">All Kecamatan</option>
                            {kecamatans.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                    )}
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
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{areas.length}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Areas</p>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{kecamatans.length}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Kecamatan</p>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {[...new Set(areas.map(a => a.kelurahan).filter(Boolean))].length}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Kelurahan</p>
                </div>
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {areas.reduce((sum, a) => sum + (a.camera_count || 0), 0)}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Cameras</p>
                </div>
            </div>

            {/* Content */}
            {loading ? (
                <div className="flex items-center justify-center min-h-[400px]">
                    <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
                </div>
            ) : filteredAreas.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700/50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-gray-400 dark:text-gray-500">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                            <circle cx="12" cy="11" r="3" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        {filterKecamatan ? 'No Areas in this Kecamatan' : 'No Areas'}
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400 mb-6">
                        {filterKecamatan ? 'Try selecting a different filter' : 'Create your first area to organize cameras'}
                    </p>
                    {!filterKecamatan && (
                        <button onClick={openAddModal} className="text-sky-500 font-semibold hover:text-sky-600 transition-colors">
                            Create First Area →
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredAreas.map((area) => (
                        <div key={area.id} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl p-6 hover:shadow-xl hover:border-sky-500/30 transition-all group">
                            <div className="flex justify-between items-start mb-4">
                                <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-sky-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-sky-500/30 group-hover:scale-110 transition-transform">
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                        <circle cx="12" cy="11" r="3" />
                                    </svg>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => openEditModal(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-all">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                    <button onClick={() => handleDelete(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{area.name}</h3>
                            
                            {/* Location Details */}
                            <div className="space-y-1 mb-4">
                                <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                    <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                    </svg>
                                    {getLocationString(area)}
                                </p>
                            </div>

                            {/* Tags */}
                            <div className="flex flex-wrap gap-2 mb-4">
                                {area.kecamatan && (
                                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400">
                                        {area.kecamatan}
                                    </span>
                                )}
                                {area.kelurahan && (
                                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">
                                        {area.kelurahan}
                                    </span>
                                )}
                                {area.rw && (
                                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400">
                                        RW {area.rw}
                                    </span>
                                )}
                                {area.rt && (
                                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400">
                                        RT {area.rt}
                                    </span>
                                )}
                            </div>

                            {area.description && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-4">
                                    {area.description}
                                </p>
                            )}

                            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700/50">
                                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                                    {area.camera_count || 0} Camera{(area.camera_count || 0) !== 1 ? 's' : ''}
                                </span>
                                <Link to="/admin/cameras" className="text-sm font-semibold text-sky-500 hover:text-sky-600 transition-colors flex items-center gap-1">
                                    View
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
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700/50 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                    {editingArea ? 'Edit Area' : 'Create Area'}
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Define location details</p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            {error && (
                                <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl">
                                    <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Area Name *</label>
                                <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="e.g., Pos Kamling RT 01" required />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">RT</label>
                                    <input type="text" name="rt" value={formData.rt} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="01" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">RW</label>
                                    <input type="text" name="rw" value={formData.rw} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="05" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Kelurahan</label>
                                    <input type="text" name="kelurahan" value={formData.kelurahan} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Kelurahan name" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Kecamatan</label>
                                    <input type="text" name="kecamatan" value={formData.kecamatan} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Kecamatan name" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Description</label>
                                <textarea name="description" value={formData.description} onChange={handleChange} rows="2" className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" placeholder="Optional notes..." />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" disabled={submitting}>
                                    Cancel
                                </button>
                                <button type="submit" className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white font-medium rounded-xl shadow-lg shadow-sky-500/30 hover:from-sky-600 hover:to-blue-700 disabled:opacity-50 transition-all" disabled={submitting}>
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
