import { useCallback, useEffect, useRef, useState } from 'react';
import { cameraService } from '../../services/cameraService';
import { areaService } from '../../services/areaService';
import { useNotification } from '../../contexts/NotificationContext';
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
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingCamera, setEditingCamera] = useState(null);
    const [modalError, setModalError] = useState('');
    const [deletingId, setDeletingId] = useState(null);
    const [togglingId, setTogglingId] = useState(null);
    const [togglingMaintenanceId, setTogglingMaintenanceId] = useState(null);
    const camerasRequestIdRef = useRef(0);
    const areasRequestIdRef = useRef(0);
    const mountedRef = useRef(true);

    const { success, error: showError } = useNotification();

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
    }, []);

    const openAddModal = useCallback(() => {
        setEditingCamera(null);
        resetWith(defaultCameraFormValues, getCameraValidationRules('internal_hls'));
        setModalError('');
        setShowModal(true);
    }, [resetWith]);

    const openEditModal = useCallback((camera) => {
        const formValues = mapCameraToFormValues(camera);
        setEditingCamera(camera);
        resetWith(formValues, getCameraValidationRules(formValues.delivery_type));
        setModalError('');
        setShowModal(true);
    }, [resetWith]);

    const handleFormChange = useCallback((event) => {
        const { name, value, type, checked } = event.target;
        const newValue = type === 'checkbox' ? checked : value;

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
        loadCameras,
        setFieldError,
        setSubmitting,
        showError,
        success,
        validateForm,
    ]);

    const deleteCamera = useCallback(async (camera) => {
        if (!window.confirm(`Delete camera "${camera.name}"?`)) {
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
    }, [showError, success]);

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
            }
        } catch (error) {
            setCameras((previous) => previous.map((item) => (
                item.id === camera.id ? { ...item, enabled: previousEnabled } : item
            )));
            showError('Update Failed', error.response?.data?.message || 'Failed to update camera status');
        } finally {
            setTogglingId(null);
        }
    }, [showError]);

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

    return {
        cameras,
        areas,
        loading,
        loadError,
        showModal,
        editingCamera,
        deletingId,
        togglingId,
        togglingMaintenanceId,
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
        setFieldValue,
        getFieldError,
        setModalError,
    };
}

export default useCameraManagementPage;
