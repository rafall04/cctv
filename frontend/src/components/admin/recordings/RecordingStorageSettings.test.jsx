// @vitest-environment jsdom
/*
 * Purpose: Kunci bahwa setelan penyimpanan rekaman bisa dibaca & disimpan dari UI (bukan env),
 *          dan validasinya benar.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordingStorageSettings from './RecordingStorageSettings';

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../../services/apiClient', () => ({ default: { get, put } }));
const { notifySuccess, notifyError } = vi.hoisted(() => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock('../../../contexts/NotificationContext', () => ({
    useNotification: () => ({ success: notifySuccess, error: notifyError }),
}));

const settingRes = (value) => ({ data: { data: { value } } });

beforeEach(() => {
    vi.clearAllMocks();
    put.mockResolvedValue({ data: { success: true } });
});

describe('RecordingStorageSettings', () => {
    it('memuat nilai yang tersimpan dari settings (bukan env)', async () => {
        get.mockImplementation((url) => Promise.resolve(
            url.endsWith('recording_max_storage_gb') ? settingRes(170)
                : settingRes(true)));

        render(<RecordingStorageSettings />);

        await waitFor(() => expect(screen.getByDisplayValue('170')).toBeTruthy());
        expect(screen.getByRole('checkbox').checked).toBe(true);
    });

    it('404 (belum diset) -> default: aktif, kosong (tanpa batas)', async () => {
        get.mockRejectedValue({ response: { status: 404 } });

        render(<RecordingStorageSettings />);

        await waitFor(() => expect(screen.getByRole('checkbox').checked).toBe(true));
        expect(screen.getByLabelText(/Maksimal penyimpanan/i).value).toBe('');
    });

    it('menyimpan KEDUA kunci lewat PUT /api/settings/:key', async () => {
        get.mockRejectedValue({ response: { status: 404 } });
        render(<RecordingStorageSettings />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Simpan/i })).toBeTruthy());

        fireEvent.change(screen.getByLabelText(/Maksimal penyimpanan/i), { target: { value: '150' } });
        fireEvent.click(screen.getByRole('button', { name: /Simpan/i }));

        await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
        const keys = put.mock.calls.map(([url]) => url);
        expect(keys).toContain('/api/settings/recording_max_storage_gb');
        expect(keys).toContain('/api/settings/recording_archive_hold_enabled');
        const maxCall = put.mock.calls.find(([url]) => url.endsWith('recording_max_storage_gb'));
        expect(maxCall[1].value).toBe(150);
        expect(notifySuccess).toHaveBeenCalled();
    });

    it('kosong = disimpan sebagai 0 (tanpa batas), bukan galat', async () => {
        get.mockRejectedValue({ response: { status: 404 } });
        render(<RecordingStorageSettings />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Simpan/i })).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: /Simpan/i }));

        await waitFor(() => expect(put).toHaveBeenCalled());
        const maxCall = put.mock.calls.find(([url]) => url.endsWith('recording_max_storage_gb'));
        expect(maxCall[1].value).toBe(0);
    });

    it('nilai negatif/salah ketik DITOLAK, tidak menyimpan diam-diam jadi tanpa batas', async () => {
        get.mockRejectedValue?.({ response: { status: 404 } }) ?? get.mockRejectedValue({ response: { status: 404 } });
        render(<RecordingStorageSettings />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Simpan/i })).toBeTruthy());

        fireEvent.change(screen.getByLabelText(/Maksimal penyimpanan/i), { target: { value: '-5' } });
        fireEvent.click(screen.getByRole('button', { name: /Simpan/i }));

        expect(put).not.toHaveBeenCalled();
        expect(notifyError).toHaveBeenCalled();
    });
});
