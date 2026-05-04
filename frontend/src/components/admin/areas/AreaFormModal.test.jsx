// @vitest-environment jsdom

/*
 * Purpose: Validate the admin area create/edit form modal presentation slice.
 * Caller: Vitest frontend suite for AreaManagement component extraction regressions.
 * Deps: React Testing Library, AreaFormModal.
 * MainFuncs: AreaFormModal render, change, submit, and cancel tests.
 * SideEffects: Renders jsdom-only modal markup.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AreaFormModal from './AreaFormModal';

function MockLocationPicker({ onLocationChange }) {
    return (
        <button type="button" onClick={() => onLocationChange('-7.1', '111.9')}>
            mock-location-picker
        </button>
    );
}

describe('AreaFormModal', () => {
    it('menampilkan form edit area dan meneruskan event form', () => {
        const onChange = vi.fn();
        const onSubmit = vi.fn((event) => event.preventDefault());
        const onClose = vi.fn();
        const onLocationChange = vi.fn();

        render(
            <AreaFormModal
                editingArea={{ id: 1, name: 'Area A' }}
                formData={{
                    name: 'Area A',
                    description: 'Deskripsi',
                    rt: '01',
                    rw: '02',
                    kelurahan: 'Kelurahan A',
                    kecamatan: 'Kecamatan A',
                    latitude: '',
                    longitude: '',
                    external_health_mode_override: 'default',
                    coverage_scope: 'default',
                    viewport_zoom_override: '',
                    show_on_grid_default: true,
                    grid_default_camera_limit: '12',
                    internal_ingest_policy_default: 'default',
                    internal_on_demand_close_after_seconds: '',
                    internal_rtsp_transport_default: 'default',
                }}
                formErrors={{ name: 'Nama wajib diisi' }}
                error="Gagal menyimpan"
                submitting={false}
                LocationPickerComponent={MockLocationPicker}
                onChange={onChange}
                onSubmit={onSubmit}
                onClose={onClose}
                onErrorDismiss={vi.fn()}
                onLocationChange={onLocationChange}
            />
        );

        expect(screen.getByText('Edit Area')).toBeTruthy();
        expect(screen.getByText('Nama wajib diisi')).toBeTruthy();
        expect(screen.getByText('Gagal menyimpan')).toBeTruthy();
        expect(screen.getByText('Internal RTSP / MediaMTX Policy')).toBeTruthy();
        expect(screen.getByLabelText('Default Ingest Mode')).toBeTruthy();
        expect(screen.getByLabelText('Default RTSP Transport')).toBeTruthy();

        fireEvent.change(screen.getByPlaceholderText('Contoh: Pos Kamling RT 01'), {
            target: { name: 'name', value: 'Area B' },
        });
        fireEvent.change(screen.getByLabelText('Default Ingest Mode'), {
            target: { name: 'internal_ingest_policy_default', value: 'on_demand' },
        });
        fireEvent.change(screen.getByPlaceholderText('Kosong = ikuti default'), {
            target: { name: 'internal_on_demand_close_after_seconds', value: '15' },
        });
        fireEvent.change(screen.getByLabelText('Default RTSP Transport'), {
            target: { name: 'internal_rtsp_transport_default', value: 'udp' },
        });
        fireEvent.click(screen.getByText('mock-location-picker'));
        fireEvent.click(screen.getByRole('button', { name: 'Perbarui' }));
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }));

        expect(onChange).toHaveBeenCalled();
        expect(onChange.mock.calls.some(([event]) => event.target.name === 'internal_ingest_policy_default')).toBe(true);
        expect(onChange.mock.calls.some(([event]) => event.target.name === 'internal_on_demand_close_after_seconds')).toBe(true);
        expect(onChange.mock.calls.some(([event]) => event.target.name === 'internal_rtsp_transport_default')).toBe(true);
        expect(onLocationChange).toHaveBeenCalledWith('-7.1', '111.9');
        expect(onSubmit).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });
});
