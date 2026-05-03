// @vitest-environment jsdom

/**
 * Purpose: Verifies admin area form defaults, edit mapping, field changes, and duplicate validation.
 * Caller: Frontend Vitest suite.
 * Deps: React Testing Library renderHook and useAreaFormState.
 * MainFuncs: useAreaFormState behavior tests.
 * SideEffects: None; renders hook state in jsdom only.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildAreaFormData, useAreaFormState } from './useAreaFormState';

describe('useAreaFormState', () => {
    it('builds create defaults and maps edit values into form strings', () => {
        expect(buildAreaFormData()).toEqual(expect.objectContaining({
            name: '',
            show_on_grid_default: true,
            grid_default_camera_limit: '12',
            internal_ingest_policy_default: 'default',
        }));

        expect(buildAreaFormData({
            id: 1,
            name: 'Area A',
            show_on_grid_default: 0,
            grid_default_camera_limit: 15,
            internal_on_demand_close_after_seconds: 45,
        })).toEqual(expect.objectContaining({
            name: 'Area A',
            show_on_grid_default: false,
            grid_default_camera_limit: '15',
            internal_on_demand_close_after_seconds: '45',
        }));
    });

    it('validates duplicate names while allowing the currently edited area name', () => {
        const areas = [{ id: 1, name: 'Area A' }, { id: 2, name: 'Area B' }];
        const { result } = renderHook(() => useAreaFormState({ areas }));

        act(() => {
            result.current.openAddModal();
            result.current.handleChange({ target: { name: 'name', value: 'Area A', type: 'text' } });
        });
        act(() => {
            expect(result.current.validateForm()).toBe(false);
        });
        expect(result.current.formErrors.name).toBe('Nama area sudah ada');

        act(() => {
            result.current.openEditModal(areas[0]);
        });
        act(() => {
            expect(result.current.validateForm()).toBe(true);
        });
        expect(result.current.formErrors).toEqual({});
    });

    it('updates fields and clears stale field errors', () => {
        const { result } = renderHook(() => useAreaFormState({ areas: [] }));

        act(() => {
            result.current.openAddModal();
        });
        act(() => {
            expect(result.current.validateForm()).toBe(false);
        });
        expect(result.current.formErrors.name).toBe('Nama area wajib diisi');

        act(() => {
            result.current.handleChange({ target: { name: 'name', value: 'Area Baru', type: 'text' } });
            result.current.handleLocationChange(-7.1, 111.9);
        });

        expect(result.current.formData.name).toBe('Area Baru');
        expect(result.current.formData.latitude).toBe(-7.1);
        expect(result.current.formData.longitude).toBe(111.9);
        expect(result.current.formErrors.name).toBe('');
    });
});
