import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { areaService } from '../services/areaService';
import { useNotification } from '../contexts/NotificationContext';
import { SkeletonCard, SkeletonStats, NoAreasEmptyState, Alert } from '../components/ui';

export default function AreaManagement() {
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
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
    const [formErrors, setFormErrors] = useState({});
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [filterKecamatan, setFilterKecamatan] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const { success, error: showError, warning } = useNotification();

    const loadAreas = useCallback(async () => {
        try {
            setLoading(true);
            setLoadError(null);
            const response = await areaService.getAllAreas();
            if (response.success) setAreas(response.data);
        } catch (err) {
            console.error('Load areas error:', err);
            setLoadError('Failed to load areas. Please try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAreas();
    }, [loadAreas]);

    // Form validation
    const validateForm = useCallback(() => {
        const errors = {};
        
        // Required field validation
        if (!formData.name.trim()) {
            errors.name = 'Area name is required';
        } else if (formData.name.trim().length < 2) {
            errors.name = 'Area name must be at least 2 characters';
        }
        
        // Check for duplicate name (excluding current area when editing)
        const duplicateName = areas.find(
            a => a.name.toLowerCase() === formData.name.trim().toLowerCase() && 
                 (!editingArea || a.id !== editingArea.id)
        );
        if (duplicateName) {
            errors.name = 'Area name already exists';
        }
        
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formData.name, areas, editingArea]);

    const openAddModal = () => {
        setEditingArea(null);
        setFormData({ name: '', description: '', rt: '', rw: '', kelurahan: '', kecamatan: '' });
        setFormErrors({});
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
        setFormErrors({});
        setError('');
        setShowModal(true);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
        // Clear error for this field when user types
        if (formErrors[name]) {
            setFormErrors({ ...formErrors, [name]: '' });
        }
    };

    const handleBlur = (e) => {
        const { name } = e.target;
        // Validate on blur for name field
        if (name === 'name') {
            validateForm();
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        
        // Validate form before submission
        if (!validateForm()) {
            return;
        }
        
        setSubmitting(true);
        try {
            const result = editingArea
                ? await areaService.updateArea(editingArea.id, formData)
                : await areaService.createArea(formData);
            if (result.success) {
                setShowModal(false);
                loadAreas();
                // Show success notification
                if (editingArea) {
                    success('Area Updated', `"${formData.name}" has been updated successfully.`);
                } else {
                    success('Area Created', `"${formData.name}" has been created successfully.`);
                }
            } else {
                setError(result.message);
                showError('Operation Failed', result.message);
            }
        } catch (err) {
            const errorMessage = err.response?.data?.message || 'Something went wrong';
            setError(errorMessage);
            showError('Operation Failed', errorMessage);
        } finally {
            setSubmitting(false);
        }
    };

    // Open delete confirmation modal
    const openDeleteConfirm = (area) => {
        setDeleteConfirm(area);
    };

    // Handle delete with confirmation
    const handleDelete = async () => {
        if (!deleteConfirm) return;
        
        setDeleting(true);
        try {
            const result = await areaService.deleteArea(deleteConfirm.id);
            if (result.success) {
                setDeleteConfirm(null);
                loadAreas();
                success('Area Deleted', `"${deleteConfirm.name}" has been deleted successfully.`);
            } else {
                showError('Delete Failed', result.message);
            }
        } catch (err) {
            const errorMessage = err.response?.data?.message || 'Failed to delete area';
            showError('Delete Failed', errorMessage);
        } finally {
            setDeleting(false);
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

    // Render skeleton loading state
    const renderSkeletonLoading = () => (
        <div className="space-y-8">
            {/* Skeleton Stats */}
            <SkeletonStats count={4} />
            
            {/* Skeleton Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.from({ length: 6 }).map((_, index) => (
                    <SkeletonCard key={index} lines={3} showImage={false} />
                ))}
            </div>
        </div>
    );

    // Render error state
    const renderErrorState = () => (
        <div className="text-center py-20 bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
            <Alert type="error" title="Error Loading Areas" message={loadError} className="max-w-md mx-auto mb-6" />
            <button 
                onClick={loadAreas}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-medium rounded-xl transition-colors"
            >
                Try Again
            </button>
        </div>
    );

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

            {/* Content based on state */}
            {loading ? (
                renderSkeletonLoading()
            ) : loadError ? (
                renderErrorState()
            ) : (
                <>
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

                    {/* Areas Grid or Empty State */}
                    {filteredAreas.length === 0 ? (
                        filterKecamatan ? (
                            <div className="text-center py-20 bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
                                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700/50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-gray-400 dark:text-gray-500">
                                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                        <circle cx="12" cy="11" r="3" />
                                    </svg>
                                </div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                    No Areas in this Kecamatan
                                </h3>
                                <p className="text-gray-500 dark:text-gray-400 mb-6">
                                    Try selecting a different filter or clear the filter
                                </p>
                                <button 
                                    onClick={() => setFilterKecamatan('')}
                                    className="text-sky-500 font-semibold hover:text-sky-600 transition-colors"
                                >
                                    Clear Filter →
                                </button>
                            </div>
                        ) : (
                            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
                                <NoAreasEmptyState onCreateArea={openAddModal} />
                            </div>
                        )
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
                                            <button onClick={() => openDeleteConfirm(area)} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
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
                </>
            )}

            {/* Create/Edit Modal */}
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
                                <Alert type="error" message={error} dismissible onDismiss={() => setError('')} />
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Area Name *</label>
                                <input 
                                    type="text" 
                                    name="name" 
                                    value={formData.name} 
                                    onChange={handleChange}
                                    onBlur={handleBlur}
                                    className={`w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                                        formErrors.name 
                                            ? 'border-red-500 focus:ring-red-500' 
                                            : 'border-gray-200 dark:border-gray-700/50'
                                    }`}
                                    placeholder="e.g., Pos Kamling RT 01" 
                                />
                                {formErrors.name && (
                                    <p className="mt-1.5 text-sm text-red-500 flex items-center gap-1">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        {formErrors.name}
                                    </p>
                                )}
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
                                <button 
                                    type="submit" 
                                    className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white font-medium rounded-xl shadow-lg shadow-sky-500/30 hover:from-sky-600 hover:to-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2" 
                                    disabled={submitting || Object.keys(formErrors).some(k => formErrors[k])}
                                >
                                    {submitting && (
                                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    )}
                                    {submitting ? 'Saving...' : (editingArea ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50">
                        <div className="p-6">
                            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white text-center mb-2">
                                Delete Area
                            </h3>
                            
                            <p className="text-gray-500 dark:text-gray-400 text-center mb-4">
                                Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">"{deleteConfirm.name}"</span>?
                            </p>
                            
                            {/* Warning for areas with cameras */}
                            {deleteConfirm.camera_count > 0 && (
                                <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl mb-4">
                                    <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <div>
                                        <p className="text-amber-800 dark:text-amber-400 font-medium text-sm">
                                            This area has {deleteConfirm.camera_count} camera{deleteConfirm.camera_count !== 1 ? 's' : ''} assigned
                                        </p>
                                        <p className="text-amber-700 dark:text-amber-500 text-sm mt-1">
                                            Deleting this area will unassign these cameras from any area.
                                        </p>
                                    </div>
                                </div>
                            )}
                            
                            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                                This action cannot be undone.
                            </p>
                        </div>
                        
                        <div className="flex gap-3 p-6 pt-0">
                            <button 
                                onClick={() => setDeleteConfirm(null)} 
                                className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleDelete}
                                className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                                disabled={deleting}
                            >
                                {deleting && (
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                )}
                                {deleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
