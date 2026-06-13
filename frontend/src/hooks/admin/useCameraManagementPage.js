/**
 * Purpose: Owns Camera Management page data, filters, forms, mutations, and stream lifecycle recovery actions.
 * Caller: frontend/src/pages/CameraManagement.jsx.
 * Deps: cameraService, areaService, notification/form hooks, admin camera form adapter.
 * MainFuncs: useCameraManagementPage.
 * SideEffects: Loads camera/area data, performs camera mutations, and triggers stream refresh API calls.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cameraService } from '../../services/cameraService';
import { areaService } from '../../services/areaService';
import { useNotification } from '../../contexts/NotificationContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useFormValidation } from '../useFormValidation';
import { useAdminReconnectRefresh } from './useAdminReconnectRefresh';
import { REQUEST_POLICY } from '../../services/requestPolicy';
import {
    buildCameraPayload,
    defaultCameraFormValues,
    getCameraValidationRules,
    mapCameraToFormValues,
} from '../../utils/admin/cameraFormAdapter';

function getDuplicateNameError(errorMessage) {
    if (!errorMessage) return null;
    const normalized = errorMessage.toLowerCase();
    if (normalized.includes('already exists') || normalized.includes('duplicate')) {
        return 'Camera name already in use';
    }
    return null;
}

export function useCameraManagementPage() {
    const [cameras, setCameras] = useState([]);
    const [areas, setAreas] = useState([]);
    const [filters, setFilters] = useState({
        search: '',
        areaId: 'all',
        cameraClass: 'all',
        deliveryType: 'all',
        healthMode: 'all',
        availabilityState: 'all',
        monitoringState: 'all',
    });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingCamera, setEditingCamera] = useState(null);
    const [modalError, setModalError] = useState('');
    const [loadingDetail, setLoadingDetail] = useState(false);
    // Dirty refs survive the async detail fetch (closures would capture stale state).
    // formDirtyRef: any field edited. rtspDirtyRef: the RTSP field specifically edited —
    // RTSP is detail-only (stripped from the list), so we must not clobber a value the
    // admin typed while the background detail was still loading.
    const formDirtyRef = useRef(false);
    const rtspDirtyRef = useRef(false);
    const [deletingId, setDeletingId] = useState(null);
    const [togglingId, setTogglingId] = useState(null);
    const [togglingMaintenanceId, setTogglingMaintenanceId] = useState(null);
    const [refreshingStreamId, setRefreshingStreamId] = useState(null);
    const camerasRequestIdRef = useRef(0);
    const areasRequestIdRef = useRef(0);
    const mountedRef = useRef(true);

    const { success, error: showError } = useNotification();
    const confirm = useConfirm();

    const handleLifecycleResult = useCallback((lifecycle) => {
        if (!lifecycle?.sourceChanged) {
            return;
        }

        if (lifecycle.status === 'refreshed') {
            success('Camera Stream Refreshed', 'Camera source lifecycle refreshed successfully.');
            return;
        }

        showError(
            'Camera Stream Reconnecting',
            lifecycle.warnings?.[0] || 'Camera stream is reconnecting. Use Refresh Stream if it stays stuck.'
        );
    }, [showError, success]);

    const {
        values: formData,
        errors: formErrors,
        touched,
        handleChange,
        handleBlur,
        validateForm,
        resetWith,
        updateRules,
        setFieldValue,
        setFieldError,
        isSubmitting,
        setSubmitting,
    } = useFormValidation(
        defaultCameraFormValues,
        getCameraValidationRules('internal_hls')
    );

    const loadAreas = useCallback(async ({ mode = 'initial' } = {}) => {
        const isBackgroundMode = mode === 'background' || mode === 'resume';
        const requestId = ++areasRequestIdRef.current;

        try {
            const response = await areaService.getAllAreas(
                isBackgroundMode ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING
            );
            if (!mountedRef.current || requestId !== areasRequestIdRef.current) {
                return;
            }

            if (response.success) {
                setAreas(response.data);
            }
        } catch (error) {
            if (mountedRef.current && requestId === areasRequestIdRef.current) {
                console.error('Load areas error:', error);
            }
        }
    }, []);

    const loadCameras = useCallback(async ({ mode = 'initial' } = {}) => {
        const isBackgroundMode = mode === 'background' || mode === 'resume';
        const requestId = ++camerasRequestIdRef.current;

        try {
            if (!isBackgroundMode) {
                setLoading(true);
                setLoadError(null);
            }

            const response = await cameraService.getAllCameras(
                isBackgroundMode ? REQUEST_POLICY.BACKGROUND : REQUEST_POLICY.BLOCKING
            );
            if (!mountedRef.current || requestId !== camerasRequestIdRef.current) {
                return;
            }

            if (response.success) {
                setCameras(response.data);
                setLoadError(null);
            } else if (!isBackgroundMode) {
                setLoadError(response.message || 'Failed to load cameras');
            } else {
                console.warn('Background camera refresh failed:', response.message);
            }
        } catch (error) {
            if (!mountedRef.current || requestId !== camerasRequestIdRef.current) {
                return;
            }

            console.error('Load cameras error:', error);
            if (!isBackgroundMode) {
                setLoadError(error.response?.data?.message || 'Failed to load cameras. Please try again.');
            }
        } finally {
            if (mountedRef.current && requestId === camerasRequestIdRef.current && !isBackgroundMode) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        loadCameras({ mode: 'initial' });
        loadAreas({ mode: 'initial' });
        return () => {
            mountedRef.current = false;
        };
    }, [loadAreas, loadCameras]);

    useAdminReconnectRefresh(() => Promise.all([
        loadCameras({ mode: 'resume' }),
        loadAreas({ mode: 'resume' }),
    ]));

    const closeModal = useCallback(() => {
        setShowModal(false);
        setModalError('');
        setEditingCamera(null);
        setLoadingDetail(false);
    }, []);

    const openAddModal = useCallback(() => {
        setEditingCamera(null);
        formDirtyRef.current = false;
        rtspDirtyRef.current = false;
        setLoadingDetail(false);
        resetWith(defaultCameraFormValues, getCameraValidationRules('internal_hls'));
        setModalError('');
        setShowModal(true);
    }, [resetWith]);

    // Open the edit modal INSTANTLY with the row data we already have (no network
    // wait), then load the full detail (incl. private_rtsp_url, which the list
    // projection strips) in the background. Submit is disabled until detail lands so
    // a half-loaded form can't be saved, and the RTSP field is only backfilled when
    // the admin hasn't typed into it.
    const openEditModal = useCallback((camera) => {
        setModalError('');
        formDirtyRef.current = false;
        rtspDirtyRef.current = false;

        const rowValues = mapCameraToFormValues(camera);
        setEditingCamera(camera);
        resetWith(rowValues, getCameraValidationRules(rowValues.delivery_type));
        setShowModal(true);
        setLoadingDetail(true);

        cameraService.getCameraById(camera.id)
            .then((response) => {
                if (!mountedRef.current || !response?.success || !response.data) {
                    return;
                }
                const detail = response.data;
                setEditingCamera(detail);

                if (!formDirtyRef.current) {
                    // Form still pristine — adopt the full detail wholesale.
                    const fullValues = mapCameraToFormValues(detail);
                    resetWith(fullValues, getCameraValidationRules(fullValues.delivery_type));
                } else if (!rtspDirtyRef.current) {
                    // Admin edited other fields but not RTSP — backfill it so saving
                    // an internal camera can't wipe the (still-loading) RTSP URL.
                    setFieldValue('private_rtsp_url', detail.private_rtsp_url || '');
                }
            })
            .catch((error) => {
                console.error('Load camera detail error:', error);
                showError('Load Camera Failed', error.response?.data?.message || 'Failed to load full camera detail.');
            })
            .finally(() => {
                if (mountedRef.current) {
                    setLoadingDetail(false);
                }
            });
    }, [resetWith, setFieldValue, showError]);

    const handleFormChange = useCallback((event) => {
        const { name, value, type, checked } = event.target;
        const newValue = type === 'checkbox' ? checked : value;

        formDirtyRef.current = true;
        if (name === 'private_rtsp_url') {
            rtspDirtyRef.current = true;
        }

        if (name === 'delivery_type') {
            updateRules(getCameraValidationRules(newValue));
        }

        handleChange({
            target: {
                name,
                value: newValue,
                type,
                checked,
            },
        });

        if (modalError) {
            setModalError('');
        }
    }, [handleChange, modalError, updateRules]);

    const submitCamera = useCallback(async (event) => {
        event.preventDefault();
        setModalError('');

        if (!validateForm()) {
            return false;
        }

        setSubmitting(true);

        try {
            const payload = buildCameraPayload(formData);
            const result = editingCamera
                ? await cameraService.updateCamera(editingCamera.id, payload)
                : await cameraService.createCamera(payload);

            if (result.success) {
                handleLifecycleResult(result.data?.sourceLifecycle);
                closeModal();
                await loadCameras({ mode: 'initial' });

                if (editingCamera) {
                    success('Camera Updated', `"${formData.name}" has been updated successfully.`);
                } else {
                    success('Camera Created', `"${formData.name}" has been added successfully.`);
                }

                return true;
            }

            const duplicateError = getDuplicateNameError(result.message);
            if (duplicateError) {
                setFieldError('name', duplicateError);
                setModalError(`${duplicateError}. Please choose a different name.`);
            } else {
                setModalError(result.message || 'Something went wrong');
            }
            return false;
        } catch (error) {
            console.error('[Camera Submit] Error:', error);
            const errorMessage = error.response?.data?.message || error.message || 'Something went wrong';
            const duplicateError = getDuplicateNameError(errorMessage);

            if (duplicateError) {
                setFieldError('name', duplicateError);
                setModalError(`${duplicateError}. Please choose a different name.`);
            } else {
                setModalError(errorMessage);
                showError('Operation Failed', errorMessage);
            }
            return false;
        } finally {
            setSubmitting(false);
        }
    }, [
        closeModal,
        editingCamera,
        formData,
        handleLifecycleResult,
        loadCameras,
        setFieldError,
        setSubmitting,
        showError,
        success,
        validateForm,
    ]);

    const deleteCamera = useCallback(async (camera) => {
        if (!(await confirm({ title: `Delete camera "${camera.name}"?`, confirmLabel: 'Delete', tone: 'danger' }))) {
            return;
        }

        setDeletingId(camera.id);
        try {
            const result = await cameraService.deleteCamera(camera.id);
            if (result.success) {
                setCameras((previous) => previous.filter((item) => item.id !== camera.id));
                success('Camera Deleted', `"${camera.name}" has been deleted.`);
            } else {
                showError('Delete Failed', result.message || 'Failed to delete camera');
            }
        } catch (error) {
            showError('Delete Failed', error.response?.data?.message || 'Failed to delete camera');
        } finally {
            setDeletingId(null);
        }
    }, [confirm, showError, success]);

    const toggleEnabled = useCallback(async (camera) => {
        const previousEnabled = camera.enabled;
        const newEnabled = camera.enabled === 1 ? 0 : 1;

        setCameras((previous) => previous.map((item) => (
            item.id === camera.id ? { ...item, enabled: newEnabled } : item
        )));
        setTogglingId(camera.id);

        try {
            const result = await cameraService.updateCamera(camera.id, { enabled: newEnabled });
            if (!result.success) {
                setCameras((previous) => previous.map((item) => (
                    item.id === camera.id ? { ...item, enabled: previousEnabled } : item
                )));
                showError('Update Failed', result.message || 'Failed to update camera status');
            } else {
                handleLifecycleResult(result.data?.sourceLifecycle);
                await loadCameras({ mode: 'background' });
            }
        } catch (error) {
            setCameras((previous) => previous.map((item) => (
                item.id === camera.id ? { ...item, enabled: previousEnabled } : item
            )));
            showError('Update Failed', error.response?.data?.message || 'Failed to update camera status');
        } finally {
            setTogglingId(null);
        }
    }, [handleLifecycleResult, loadCameras, showError]);

    const refreshCameraStream = useCallback(async (cameraId) => {
        setRefreshingStreamId(cameraId);
        try {
            const result = await cameraService.refreshCameraStream(cameraId);
            if (result.success) {
                handleLifecycleResult(result.data?.sourceLifecycle);
                await loadCameras({ mode: 'background' });
                return;
            }
            showError('Refresh Failed', result.message || 'Failed to refresh camera stream');
        } catch (error) {
            showError('Refresh Failed', error.response?.data?.message || 'Failed to refresh camera stream');
        } finally {
            setRefreshingStreamId(null);
        }
    }, [handleLifecycleResult, loadCameras, showError]);

    const toggleMaintenance = useCallback(async (camera) => {
        const previousStatus = camera.status;
        const newStatus = camera.status === 'maintenance' ? 'active' : 'maintenance';

        setCameras((previous) => previous.map((item) => (
            item.id === camera.id ? { ...item, status: newStatus } : item
        )));
        setTogglingMaintenanceId(camera.id);

        try {
            const result = await cameraService.updateCamera(camera.id, { status: newStatus });
            if (!result.success) {
                setCameras((previous) => previous.map((item) => (
                    item.id === camera.id ? { ...item, status: previousStatus } : item
                )));
                showError('Update Failed', result.message || 'Failed to update maintenance status');
            }
        } catch (error) {
            setCameras((previous) => previous.map((item) => (
                item.id === camera.id ? { ...item, status: previousStatus } : item
            )));
            showError('Update Failed', error.response?.data?.message || 'Failed to update maintenance status');
        } finally {
            setTogglingMaintenanceId(null);
        }
    }, [showError]);

    const getFieldError = useCallback((fieldName) => {
        return touched[fieldName] ? formErrors[fieldName] : '';
    }, [formErrors, touched]);

    const filteredCameras = useMemo(() => {
        return cameras.filter((camera) => {
            const normalizedSearch = filters.search.trim().toLowerCase();
            if (normalizedSearch) {
                const haystack = [
                    camera.name,
                    camera.area_name,
                    camera.location,
                    camera.delivery_type,
                    camera.external_health_mode,
                    camera.availability_state,
                    camera.monitoring_state,
                ].filter(Boolean).join(' ').toLowerCase();

                if (!haystack.includes(normalizedSearch)) {
                    return false;
                }
            }

            if (filters.areaId !== 'all' && String(camera.area_id || '') !== filters.areaId) {
                return false;
            }

            if (filters.cameraClass !== 'all' && (camera.camera_class || 'community') !== filters.cameraClass) {
                return false;
            }

            if (filters.deliveryType !== 'all' && camera.delivery_type !== filters.deliveryType) {
                return false;
            }

            if (filters.healthMode !== 'all' && (camera.external_health_mode || 'default') !== filters.healthMode) {
                return false;
            }

            if (filters.availabilityState !== 'all' && (camera.availability_state || 'offline') !== filters.availabilityState) {
                return false;
            }

            if (filters.monitoringState !== 'all' && (camera.monitoring_state || 'unknown') !== filters.monitoringState) {
                return false;
            }

            return true;
        });
    }, [cameras, filters]);

    return {
        cameras,
        filteredCameras,
        areas,
        filters,
        loading,
        loadError,
        showModal,
        editingCamera,
        loadingDetail,
        deletingId,
        togglingId,
        togglingMaintenanceId,
        refreshingStreamId,
        modalError,
        formData,
        isSubmitting,
        loadCameras,
        openAddModal,
        openEditModal,
        closeModal,
        handleFormChange,
        handleBlur,
        submitCamera,
        deleteCamera,
        toggleEnabled,
        toggleMaintenance,
        refreshCameraStream,
        setFieldValue,
        getFieldError,
        setModalError,
        setFilters,
    };
}

export default useCameraManagementPage;
