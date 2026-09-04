// @vitest-environment jsdom

/*
 * Purpose: Verify playback token create form camera picker filtering UI.
 * Caller: Frontend Vitest suite for admin playback token components.
 * Deps: React Testing Library, vitest, PlaybackTokenForm.
 * MainFuncs: PlaybackTokenForm camera picker tests.
 * SideEffects: None; callbacks are mocked.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackTokenForm from './PlaybackTokenForm.jsx';

function renderSelectedForm(props = {}) {
    const defaultProps = {
        form: {
            label: '',
            preset: 'trial_3d',
            scope_type: 'selected',
            playback_window_hours: '',
            expires_at: '',
            access_code_mode: 'auto',
            access_code_length: 8,
            custom_access_code: '',
            max_active_sessions: '',
            session_limit_mode: '',
            camera_rules: {},
            share_template: 'Kode {{token}}',
        },
        cameras: [{ id: 1168, name: 'CCTV ALANG ALANG' }],
        saving: false,
        selectedCameraIds: new Set(),
        cameraSearch: '',
        totalCameraCount: 1,
        visibleCameraCount: 1,
        onUpdateForm: vi.fn(),
        onUpdateCameraSearch: vi.fn(),
        onToggleCameraRule: vi.fn(),
        onUpdateCameraRule: vi.fn(),
        onSubmit: vi.fn(),
    };

    return render(<PlaybackTokenForm {...defaultProps} {...props} />);
}

describe('PlaybackTokenForm', () => {
    it('updates camera search from the selected camera picker', () => {
        const onUpdateCameraSearch = vi.fn();
        renderSelectedForm({ onUpdateCameraSearch });

        fireEvent.change(screen.getByPlaceholderText(/filter nama cctv/i), {
            target: { value: 'alang' },
        });

        expect(onUpdateCameraSearch).toHaveBeenCalledWith('alang');
    });

    it('shows filtered camera count and camera names', () => {
        renderSelectedForm();

        expect(screen.getByText('CCTV ALANG ALANG')).toBeTruthy();
        expect(screen.getByText(/Menampilkan 1 dari 1 CCTV/i)).toBeTruthy();
    });

    it('renders the token-level "Izinkan Live" toggle and reports its change', () => {
        const onUpdateForm = vi.fn();
        renderSelectedForm({ onUpdateForm });

        const label = screen.getByText(/Izinkan Live/i).closest('label');
        const checkbox = label.querySelector('input[type="checkbox"]');
        expect(checkbox).toBeTruthy();
        fireEvent.click(checkbox);
        expect(onUpdateForm).toHaveBeenCalledWith('allow_live', true);
    });

    it('shows a per-camera Live override (tri-state) when a camera is selected', () => {
        const onUpdateCameraRule = vi.fn();
        renderSelectedForm({ selectedCameraIds: new Set([1168]), onUpdateCameraRule });

        const select = screen.getByRole('option', { name: 'Live: Ya' }).closest('select');
        expect(select).toBeTruthy();
        // inherit / yes / no map to null / true / false
        fireEvent.change(select, { target: { value: 'yes' } });
        expect(onUpdateCameraRule).toHaveBeenCalledWith(1168, 'allow_live', true);
        fireEvent.change(select, { target: { value: 'no' } });
        expect(onUpdateCameraRule).toHaveBeenCalledWith(1168, 'allow_live', false);
        fireEvent.change(select, { target: { value: 'inherit' } });
        expect(onUpdateCameraRule).toHaveBeenCalledWith(1168, 'allow_live', null);
    });

    it('custom access code keeps BOTH letters and digits, strips only backend-invalid chars', () => {
        const onUpdateForm = vi.fn();
        renderSelectedForm({
            form: {
                label: '', preset: 'trial_3d', scope_type: 'all', playback_window_hours: '', expires_at: '',
                access_code_mode: 'custom', access_code_length: 8, custom_access_code: '',
                max_active_sessions: '', session_limit_mode: '', camera_rules: {}, share_template: 'Kode {{token}}',
            },
            onUpdateForm,
        });
        // The Bug A hardening: uppercase + keep A-Z0-9_-, drop space/'!'. Both classes survive.
        const input = screen.getByText('Kode Custom').closest('label').querySelector('input');
        fireEvent.change(input, { target: { value: 'ab12-x y!' } });
        expect(onUpdateForm).toHaveBeenCalledWith('custom_access_code', 'AB12-XY');
    });
});
