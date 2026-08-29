// @vitest-environment jsdom
/*
 * Purpose: Kunci bahwa sakelar rekam-audio bisa dibaca & disimpan dari UI (bukan env RECORDING_AUDIO),
 *          dan 404 (belum diset) jatuh ke default aktif.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordingAudioSetting from './RecordingAudioSetting';

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

describe('RecordingAudioSetting', () => {
    it('memuat nilai tersimpan dari settings (false -> tidak tercentang)', async () => {
        get.mockResolvedValue(settingRes(false));

        render(<RecordingAudioSetting />);

        await waitFor(() => expect(screen.getByRole('checkbox').checked).toBe(false));
    });

    it('404 (belum diset) -> default: aktif', async () => {
        get.mockRejectedValue({ response: { status: 404 } });

        render(<RecordingAudioSetting />);

        await waitFor(() => expect(screen.getByRole('checkbox').checked).toBe(true));
    });

    it('menyimpan lewat PUT /api/settings/recording_audio_enabled', async () => {
        get.mockRejectedValue({ response: { status: 404 } });
        render(<RecordingAudioSetting />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Simpan/i })).toBeTruthy());

        fireEvent.click(screen.getByRole('checkbox'));   // matikan
        fireEvent.click(screen.getByRole('button', { name: /Simpan/i }));

        await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
        const [url, body] = put.mock.calls[0];
        expect(url).toBe('/api/settings/recording_audio_enabled');
        expect(body.value).toBe(false);
        expect(notifySuccess).toHaveBeenCalled();
    });
});
