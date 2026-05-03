/**
 * Purpose: Owns admin area create/edit modal state, defaults, field changes, and validation.
 * Caller: AreaManagement page.
 * Deps: React state/callback hooks.
 * MainFuncs: buildAreaFormData, useAreaFormState.
 * SideEffects: None beyond local React state updates.
 */
import { useCallback, useState } from 'react';

export const defaultAreaFormData = {
    name: '',
    description: '',
    rt: '',
    rw: '',
    kelurahan: '',
    kecamatan: '',
    latitude: '',
    longitude: '',
    external_health_mode_override: 'default',
    coverage_scope: 'default',
    viewport_zoom_override: '',
    show_on_grid_default: true,
    grid_default_camera_limit: '12',
    internal_ingest_policy_default: 'default',
    internal_on_demand_close_after_seconds: '',
};

export function buildAreaFormData(area = null) {
    if (!area) {
        return { ...defaultAreaFormData };
    }

    return {
        name: area.name,
        description: area.description || '',
        rt: area.rt || '',
        rw: area.rw || '',
        kelurahan: area.kelurahan || '',
        kecamatan: area.kecamatan || '',
        latitude: area.latitude || '',
        longitude: area.longitude || '',
        external_health_mode_override: area.external_health_mode_override || 'default',
        coverage_scope: area.coverage_scope || 'default',
        viewport_zoom_override: area.viewport_zoom_override || '',
        show_on_grid_default: area.show_on_grid_default === 1 || area.show_on_grid_default === true,
        grid_default_camera_limit: area.grid_default_camera_limit === null || area.grid_default_camera_limit === undefined ? '' : String(area.grid_default_camera_limit),
        internal_ingest_policy_default: area.internal_ingest_policy_default || 'default',
        internal_on_demand_close_after_seconds: area.internal_on_demand_close_after_seconds === null || area.internal_on_demand_close_after_seconds === undefined ? '' : String(area.internal_on_demand_close_after_seconds),
    };
}

export function useAreaFormState({ areas }) {
    const [showModal, setShowModal] = useState(false);
    const [editingArea, setEditingArea] = useState(null);
    const [formData, setFormData] = useState(defaultAreaFormData);
    const [formErrors, setFormErrors] = useState({});
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const validateForm = useCallback(() => {
        const errors = {};
        const trimmedName = formData.name.trim();

        if (!trimmedName) {
            errors.name = 'Nama area wajib diisi';
        } else if (trimmedName.length < 2) {
            errors.name = 'Nama area minimal 2 karakter';
        }

        const duplicateName = areas.find(
            (area) => area.name.toLowerCase() === trimmedName.toLowerCase()
                && (!editingArea || area.id !== editingArea.id)
        );
        if (duplicateName) {
            errors.name = 'Nama area sudah ada';
        }

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [areas, editingArea, formData.name]);

    const openAddModal = useCallback(() => {
        setEditingArea(null);
        setFormData(buildAreaFormData());
        setFormErrors({});
        setError('');
        setShowModal(true);
    }, []);

    const openEditModal = useCallback((area) => {
        setEditingArea(area);
        setFormData(buildAreaFormData(area));
        setFormErrors({});
        setError('');
        setShowModal(true);
    }, []);

    const handleChange = useCallback((event) => {
        const { name, value, type, checked } = event.target;
        setFormData((currentFormData) => ({
            ...currentFormData,
            [name]: type === 'checkbox' ? checked : value,
        }));
        setFormErrors((currentErrors) => {
            if (!currentErrors[name]) {
                return currentErrors;
            }
            return { ...currentErrors, [name]: '' };
        });
    }, []);

    const handleLocationChange = useCallback((lat, lng) => {
        setFormData((currentFormData) => ({
            ...currentFormData,
            latitude: lat,
            longitude: lng,
        }));
    }, []);

    return {
        showModal,
        setShowModal,
        editingArea,
        formData,
        formErrors,
        error,
        setError,
        submitting,
        setSubmitting,
        validateForm,
        openAddModal,
        openEditModal,
        handleChange,
        handleLocationChange,
    };
}
