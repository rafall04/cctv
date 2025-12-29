import { useEffect, useState, useCallback, useRef } from 'react';
import { cameraService } from '../services/cameraService';
import { areaService } from '../services/areaService';
import { useNotification } from '../contexts/NotificationContext';
import { useFormValidation } from '../hooks/useFormValidation';
import { validateRtspUrl, getRtspFormatHint } from '../utils/validators';
import { SkeletonCard, Skeleton } from '../components/ui/Skeleton';
import { NoCamerasEmptyState } from '../components/ui/EmptyState';
import { Alert } from '../components/ui/Alert';

/**
 * Camera Management Page
 * 
 * Enhanced with:
 * - Notification system integration (Requirements: 4.1, 4.5, 4.7, 4.8)
 * - Form validation with RTSP URL validation (Requirements: 4.2, 4.3, 4.4)
 * - Skeleton loading states (Requirements: 4.6, 4.11)
 * - Optimistic toggle with rollback (Requirements: 4.9)
 * - Empty state with quick-add button (Requirements: 4.10)
 */

// Validation rules for camera form
const getValidationRules = () => ({
    name: {
        required: 'Camera name is required',
        minLength: { value: 2, message: 'Name must be at least 2 characters' },
        maxLength: { value: 100, message: 'Name must not exceed 100 characters' },
    },
    private_rtsp_url: {
        required: 'RTSP URL is required',
        custom: (value) => {
            if (!value || value.trim() === '') return undefined;
            const result = validateRtspUrl(value);
            return result.isValid ? undefined : result.error;
        },
    },
});

export default function CameraManagement() {
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingCamera, setEditingCamera] = useState(null);
    const [areas, setAreas] = useState([]);
    const [deletingId, setDeletingId] = useState(null);
    const [togglingId, setTogglingId] = useState(null);
    
    // Undo state for delete
    const [undoData, setUndoData] = useState(null);
    const undoTimerRef = useRef(null);
    
    const { success, error: showError, warning } = useNotification();

    // Form validation hook
    const {
        values: formData,
        errors: formErrors,
        touched,
        handleChange,
        handleBlur,
        validateForm,
        resetWith,
        setFieldError,
        isSubmitting,
        setSubmitting,
    } = useFormValidation(
        {
            name: '',
            private_rtsp_url: '',
            description: '',
            location: '',
            group_name: '',
            area_id: '',
            enabled: true,
            is_tunnel: false,
        },
        getValidationRules()
    );

    const [modalError, setModalError] = useState('');

    useEffect(() => {
        loadCameras();
        loadAreas();
        
        // Cleanup undo timer on unmount
        return () => {
            if (undoTimerRef.current) {
                clearTimeout(undoTimerRef.current);
            }
        };
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
            setLoadError(null);
            const response = await cameraService.getAllCameras();
            if (response.success) {
                setCameras(response.data);
            } else {
                setLoadError(response.message || 'Failed to load cameras');
            }
        } catch (err) {
            console.error('Load cameras error:', err);
            setLoadError(err.response?.data?.message || 'Failed to load cameras. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const openAddModal = () => {
        setEditingCamera(null);
        resetWith({
            name: '',
            private_rtsp_url: '',
            description: '',
            location: '',
            group_name: '',
            area_id: '',
            enabled: true,
            is_tunnel: false,
        });
        setModalError('');
        setShowModal(true);
    };

    const openEditModal = (camera) => {
        setEditingCamera(camera);
        resetWith({
            name: camera.name,
            private_rtsp_url: camera.private_rtsp_url,
            description: camera.description || '',
            location: camera.location || '',
            group_name: camera.group_name || '',
            area_id: camera.area_id || '',
            enabled: camera.enabled === 1,
            is_tunnel: camera.is_tunnel === 1,
        });
        setModalError('');
        setShowModal(true);
    };

    const handleFormChange = (e) => {
        const { name, value, type, checked } = e.target;
        const newValue = type === 'checkbox' ? checked : value;
        handleChange({ target: { name, value: newValue, type, checked } });
        
        // Clear modal error when user makes changes
        if (modalError) setModalError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setModalError('');
        
        // Validate form
        if (!validateForm()) {
            return;
        }
        
        setSubmitting(true);
        try {
            const data = { ...formData, enabled: formData.enabled ? 1 : 0, is_tunnel: formData.is_tunnel ? 1 : 0 };
            const result = editingCamera 
                ? await cameraService.updateCamera(editingCamera.id, data)
                : await cameraService.createCamera(data);
            
            if (result.success) {
                setShowModal(false);
                loadCameras();
                
                // Show success toast (Requirements: 4.1, 4.5)
                if (editingCamera) {
                    success('Camera Updated', `"${formData.name}" has been updated successfully.`);
                } else {
                    success('Camera Created', `"${formData.name}" has been added successfully.`);
                }
            } else {
                // Handle specific error cases (Requirements: 4.2, 4.4)
                const errorMessage = result.message || 'Something went wrong';
                
                if (errorMessage.toLowerCase().includes('already exists') || 
                    errorMessage.toLowerCase().includes('duplicate')) {
                    setFieldError('name', 'Camera name already in use');
                    setModalError('Camera name already in use. Please choose a different name.');
                } else {
                    setModalError(errorMessage);
                }
            }
        } catch (err) {
            const errorMessage = err.response?.data?.message || 'Something went wrong';
            
            // Handle duplicate name error (Requirements: 4.4)
            if (errorMessage.toLowerCase().includes('already exists') || 
                errorMessage.toLowerCase().includes('duplicate')) {
                setFieldError('name', 'Camera name already in use');
                setModalError('Camera name already in use. Please choose a different name.');
            } else {
                setModalError(errorMessage);
                showError('Operation Failed', errorMessage);
            }
        } finally {
            setSubmitting(false);
        }
    };


    // Handle delete with undo option (Requirements: 4.6, 4.7, 4.8)
    const handleDelete = async (camera) => {
        if (!window.confirm(`Delete camera "${camera.name}"?`)) return;
        
        setDeletingId(camera.id);
        try {
            const result = await cameraService.deleteCamera(camera.id);
            if (result.success) {
                // Store deleted camera for undo
                setUndoData({ camera, timestamp: Date.now() });
                
                // Remove from list immediately
                setCameras(prev => prev.filter(c => c.id !== camera.id));
                
                // Show success toast with undo option (Requirements: 4.7)
                success('Camera Deleted', `"${camera.name}" has been deleted.`);
                
                // Clear undo data after 5 seconds
                if (undoTimerRef.current) {
                    clearTimeout(undoTimerRef.current);
                }
                undoTimerRef.current = setTimeout(() => {
                    setUndoData(null);
                }, 5000);
            } else {
                showError('Delete Failed', result.message || 'Failed to delete camera');
            }
        } catch (err) {
            // Show error toast (Requirements: 4.8)
            showError('Delete Failed', err.response?.data?.message || 'Failed to delete camera');
        } finally {
            setDeletingId(null);
        }
    };

    // Optimistic toggle with rollback (Requirements: 4.9)
    const toggleStatus = useCallback(async (camera) => {
        const previousEnabled = camera.enabled;
        const newEnabled = camera.enabled === 1 ? 0 : 1;
        
        // Optimistic update
        setCameras(prev => prev.map(c => 
            c.id === camera.id ? { ...c, enabled: newEnabled } : c
        ));
        setTogglingId(camera.id);
        
        try {
            const result = await cameraService.updateCamera(camera.id, { enabled: newEnabled });
            if (!result.success) {
                // Rollback on failure
                setCameras(prev => prev.map(c => 
                    c.id === camera.id ? { ...c, enabled: previousEnabled } : c
                ));
                showError('Update Failed', result.message || 'Failed to update camera status');
            }
        } catch (err) {
            // Rollback on error
            setCameras(prev => prev.map(c => 
                c.id === camera.id ? { ...c, enabled: previousEnabled } : c
            ));
            showError('Update Failed', err.response?.data?.message || 'Failed to update camera status');
        } finally {
            setTogglingId(null);
        }
    }, [showError]);

    // Render loading skeleton
    const renderLoadingSkeleton = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
                    {/* Preview skeleton */}
                    <Skeleton className="aspect-video w-full" />
                    {/* Info skeleton */}
                    <div className="p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-2">
                                <Skeleton className="h-3 w-16" />
                                <Skeleton className="h-4 w-24" />
                            </div>
                            <div className="flex gap-1">
                                <Skeleton className="h-8 w-8 rounded-lg" />
                                <Skeleton className="h-8 w-8 rounded-lg" />
                            </div>
                        </div>
                        <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700/50">
                            <Skeleton className="h-3 w-12" />
                            <Skeleton className="h-5 w-10 rounded-full" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    // Render error state with retry
    const renderErrorState = () => (
        <div className="text-center py-20 bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-500">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Failed to Load Cameras</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">{loadError}</p>
            <button 
                onClick={loadCameras}
                className="px-6 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-sky-500/25 transition-all"
            >
                Try Again
            </button>
        </div>
    );

    // Get field error for display
    const getFieldError = (fieldName) => {
        return touched[fieldName] ? formErrors[fieldName] : '';
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
                renderLoadingSkeleton()
            ) : loadError ? (
                renderErrorState()
            ) : cameras.length === 0 ? (
                <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl">
                    <NoCamerasEmptyState onAddCamera={openAddModal} />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {cameras.map((camera) => (
                        <div key={camera.id} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-2xl overflow-hidden hover:shadow-xl hover:border-sky-500/30 transition-all group">
                            {/* Preview */}
                            <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 relative">
                                <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600">
                                    <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                </div>
                                <div className="absolute top-3 right-3 flex gap-2">
                                    {camera.is_tunnel === 1 && (
                                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm bg-amber-500/90 text-white" title="Koneksi Tunnel - Kurang Stabil">
                                            ⚠️ Tunnel
                                        </span>
                                    )}
                                    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-sm ${
                                        camera.enabled
                                            ? 'bg-emerald-500/90 text-white'
                                            : 'bg-gray-500/90 text-white'
                                    }`}>
                                        {camera.enabled ? 'Live' : 'Offline'}
                                    </span>
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                                    <p className="text-[10px] font-semibold text-sky-300 mb-0.5">{camera.area_name || 'Uncategorized'}</p>
                                    <h3 className="text-sm font-bold text-white">{camera.name}</h3>
                                </div>
                            </div>

                            {/* Info */}
                            <div className="p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Location</p>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">{camera.location || 'Not specified'}</p>
                                    </div>
                                    <div className="flex gap-1">
                                        <button 
                                            onClick={() => openEditModal(camera)} 
                                            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-all"
                                            title="Edit camera"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                        </button>
                                        <button 
                                            onClick={() => handleDelete(camera)} 
                                            disabled={deletingId === camera.id}
                                            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="Delete camera"
                                        >
                                            {deletingId === camera.id ? (
                                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                            ) : (
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700/50">
                                    <span className="text-xs text-gray-400 dark:text-gray-500">ID: {camera.id}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{camera.enabled ? 'On' : 'Off'}</span>
                                        <button
                                            onClick={() => toggleStatus(camera)}
                                            disabled={togglingId === camera.id}
                                            className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${camera.enabled ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'}`}
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
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 my-auto max-h-[90vh] flex flex-col">
                        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700/50 flex justify-between items-center shrink-0">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                    {editingCamera ? 'Edit Camera' : 'Add Camera'}
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Configure RTSP stream</p>
                            </div>
                            <button 
                                onClick={() => setShowModal(false)} 
                                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 transition-colors"
                                disabled={isSubmitting}
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                            {/* Modal error alert */}
                            {modalError && (
                                <Alert 
                                    type="error" 
                                    message={modalError}
                                    dismissible
                                    onDismiss={() => setModalError('')}
                                />
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                {/* Name field */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Name <span className="text-red-500">*</span>
                                    </label>
                                    <input 
                                        type="text" 
                                        name="name" 
                                        value={formData.name} 
                                        onChange={handleFormChange}
                                        onBlur={handleBlur}
                                        disabled={isSubmitting}
                                        className={`w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 text-sm ${
                                            getFieldError('name') 
                                                ? 'border-red-500 focus:ring-red-500' 
                                                : 'border-gray-200 dark:border-gray-700/50'
                                        }`}
                                        placeholder="Front Entrance" 
                                    />
                                    {getFieldError('name') && (
                                        <p className="mt-1 text-xs text-red-500">{getFieldError('name')}</p>
                                    )}
                                </div>
                                
                                {/* Area field */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Area</label>
                                    <select 
                                        name="area_id" 
                                        value={formData.area_id} 
                                        onChange={handleFormChange}
                                        disabled={isSubmitting}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 text-sm"
                                    >
                                        <option value="">Select Area</option>
                                        {areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* RTSP URL field with validation */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    RTSP URL <span className="text-red-500">*</span>
                                </label>
                                <input 
                                    type="text" 
                                    name="private_rtsp_url" 
                                    value={formData.private_rtsp_url} 
                                    onChange={handleFormChange}
                                    onBlur={handleBlur}
                                    disabled={isSubmitting}
                                    className={`w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border rounded-xl text-gray-900 dark:text-white font-mono text-xs placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 ${
                                        getFieldError('private_rtsp_url') 
                                            ? 'border-red-500 focus:ring-red-500' 
                                            : 'border-gray-200 dark:border-gray-700/50'
                                    }`}
                                    placeholder="rtsp://user:pass@ip:port/path" 
                                />
                                {getFieldError('private_rtsp_url') ? (
                                    <p className="mt-1 text-xs text-red-500">{getFieldError('private_rtsp_url')}</p>
                                ) : (
                                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{getRtspFormatHint()}</p>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                {/* Location field */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
                                    <input 
                                        type="text" 
                                        name="location" 
                                        value={formData.location} 
                                        onChange={handleFormChange}
                                        disabled={isSubmitting}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 text-sm" 
                                        placeholder="Building A" 
                                    />
                                </div>
                                
                                {/* Group field */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Group</label>
                                    <input 
                                        type="text" 
                                        name="group_name" 
                                        value={formData.group_name} 
                                        onChange={handleFormChange}
                                        disabled={isSubmitting}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 text-sm" 
                                        placeholder="Security" 
                                    />
                                </div>
                            </div>

                            {/* Description field */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                                <textarea 
                                    name="description" 
                                    value={formData.description} 
                                    onChange={handleFormChange}
                                    disabled={isSubmitting}
                                    rows="2" 
                                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none disabled:opacity-50 text-sm" 
                                    placeholder="Optional notes..." 
                                />
                            </div>

                            {/* Tunnel Connection Toggle - Compact */}
                            <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">Koneksi Tunnel</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">Kurang stabil</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleFormChange({ target: { name: 'is_tunnel', value: !formData.is_tunnel, type: 'checkbox', checked: !formData.is_tunnel } })}
                                    disabled={isSubmitting}
                                    className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 shrink-0 ${formData.is_tunnel ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                                >
                                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${formData.is_tunnel ? 'left-5' : 'left-0.5'}`}></div>
                                </button>
                            </div>

                            {/* Action buttons - Sticky at bottom */}
                            <div className="flex gap-3 pt-2 sticky bottom-0 bg-white dark:bg-gray-800 pb-1">
                                <button 
                                    type="button" 
                                    onClick={() => setShowModal(false)} 
                                    className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm" 
                                    disabled={isSubmitting}
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white font-medium rounded-xl shadow-lg shadow-sky-500/30 hover:from-sky-600 hover:to-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 text-sm" 
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting && (
                                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    )}
                                    {isSubmitting ? 'Saving...' : (editingCamera ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
