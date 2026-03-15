// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraManagement from './CameraManagement';

const {
    getAllCameras,
    createCamera,
    updateCamera,
    deleteCamera,
    getAllAreas,
} = vi.hoisted(() => ({
    getAllCameras: vi.fn(),
    createCamera: vi.fn(),
    updateCamera: vi.fn(),
    deleteCamera: vi.fn(),
    getAllAreas: vi.fn(),
}));

vi.mock('../services/cameraService', () => ({
    cameraService: {
        getAllCameras,
        createCamera,
        updateCamera,
        deleteCamera,
    },
}));

vi.mock('../services/areaService', () => ({
    areaService: {
        getAllAreas,
    },
}));

vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock('../components/LocationPicker', () => ({
    default: ({ onLocationChange }) => (
        <button type="button" onClick={() => onLocationChange('-7.1', '112.1')}>
            mock-location-picker
        </button>
    ),
}));

describe('CameraManagement', () => {
    beforeEach(() => {
        getAllCameras.mockReset();
        createCamera.mockReset();
        updateCamera.mockReset();
        deleteCamera.mockReset();
        getAllAreas.mockReset();

        getAllCameras.mockResolvedValue({ success: true, data: [] });
        getAllAreas.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Lobby' }] });
        createCamera.mockResolvedValue({ success: true });
        updateCamera.mockResolvedValue({ success: true });
    });

    it('mewajibkan RTSP untuk kamera internal', async () => {
        render(<CameraManagement />);

        fireEvent.click(await screen.findByText('Add Camera'));
        fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Lobby Cam' } });
        fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form'));

        await waitFor(() => {
            expect(screen.getByText('RTSP URL is required')).toBeTruthy();
        });

        expect(createCamera).not.toHaveBeenCalled();
    });

    it('mengirim payload external tanpa RTSP saat stream source eksternal dipilih', async () => {
        render(<CameraManagement />);

        fireEvent.click(await screen.findByText('Add Camera'));
        fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Dishub Cam' } });
        fireEvent.click(screen.getByRole('button', { name: 'External (HLS)' }));
        fireEvent.change(screen.getByLabelText(/URL HLS Eksternal/i), {
            target: { value: 'https://example.com/live.m3u8' },
        });
        expect(screen.getByLabelText(/Mode TLS/i)).toBeTruthy();
        expect(screen.getByLabelText(/Gunakan Proxy/i).disabled).toBe(true);
        fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form'));

        await waitFor(() => {
            expect(createCamera).toHaveBeenCalledTimes(1);
        });

        expect(createCamera).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Dishub Cam',
            stream_source: 'external',
            external_hls_url: 'https://example.com/live.m3u8',
            private_rtsp_url: null,
            external_use_proxy: 1,
            external_tls_mode: 'strict',
        }));
    });

    it('rollback status enabled saat update gagal', async () => {
        getAllCameras.mockResolvedValue({
            success: true,
            data: [{
                id: 1,
                name: 'Lobby Cam',
                enabled: 1,
                status: 'active',
                area_name: 'Lobby',
                location: 'Gate',
                stream_source: 'internal',
                is_tunnel: 0,
            }],
        });
        updateCamera.mockResolvedValue({ success: false, message: 'failed' });

        render(<CameraManagement />);

        await screen.findByText('Lobby Cam');
        const toggle = screen.getByText('On').parentElement.querySelector('button');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(updateCamera).toHaveBeenCalledWith(1, { enabled: 0 });
        });

        await waitFor(() => {
            expect(screen.getByText('On')).toBeTruthy();
            expect(screen.queryByText('Off')).toBeNull();
        });
    });
});
