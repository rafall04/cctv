/*
 * Purpose: Pin the "Token Saya" component — lists saved tokens, wires Aktifkan/Perpanjang/Salin/Hapus,
 *          hides Aktifkan for an expired token, and recovers by phone + code.
 * Caller: Vitest frontend suite (jsdom).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import MyPlaybackTokens from './MyPlaybackTokens.jsx';
import { saveToken } from '../../utils/savedPlaybackTokens';

const recoverTokens = vi.fn();
vi.mock('../../services/playbackAccessService', () => ({
    default: { recoverTokens: (...a) => recoverTokens(...a) },
}));

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } recoverTokens.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('MyPlaybackTokens', () => {
    it('renders only a recovery link when nothing is saved', () => {
        render(<MyPlaybackTokens />);
        expect(screen.queryByText('Token Saya')).toBeNull();
        expect(screen.getByText(/Pulihkan token/i)).toBeTruthy();
    });

    it('lists a saved token and fires onActivate / onRenew with it', () => {
        saveToken({ shareKey: 'CODE1', label: 'Mingguan', expiresAt: '2099-01-01 00:00:00' });
        const onActivate = vi.fn();
        const onRenew = vi.fn();
        render(<MyPlaybackTokens onActivate={onActivate} onRenew={onRenew} />);
        expect(screen.getByText('Mingguan')).toBeTruthy();
        expect(screen.getByText(/Aktif sampai/)).toBeTruthy();
        fireEvent.click(screen.getByText('Aktifkan'));
        expect(onActivate).toHaveBeenCalledWith('CODE1');
        fireEvent.click(screen.getByText('Perpanjang'));
        expect(onRenew.mock.calls[0][0]).toMatchObject({ shareKey: 'CODE1' });
    });

    it('hides Aktifkan for an EXPIRED token but still allows Perpanjang', () => {
        saveToken({ shareKey: 'OLD', label: 'Lama', expiresAt: '2000-01-01 00:00:00' });
        render(<MyPlaybackTokens onActivate={vi.fn()} onRenew={vi.fn()} />);
        expect(screen.getByText('Kadaluarsa')).toBeTruthy();
        expect(screen.queryByText('Aktifkan')).toBeNull();
        expect(screen.getByText('Perpanjang')).toBeTruthy();
    });

    it('removes a token from the list', () => {
        saveToken({ shareKey: 'CODE1', label: 'A', expiresAt: '2099-01-01 00:00:00' });
        render(<MyPlaybackTokens onActivate={vi.fn()} />);
        fireEvent.click(screen.getByText('Hapus'));
        expect(screen.queryByText('A')).toBeNull();
    });

    it('recovers tokens by phone + code and saves them', async () => {
        recoverTokens.mockResolvedValue({ data: { tokens: [{ shareKey: 'REC1', expiresAt: '2099-06-01 00:00:00', product: { label: 'Bulanan' } }] } });
        render(<MyPlaybackTokens onActivate={vi.fn()} />);
        fireEvent.click(screen.getByText(/Pulihkan token/i));
        fireEvent.change(screen.getByPlaceholderText('Nomor HP'), { target: { value: '0812' } });
        fireEvent.change(screen.getByPlaceholderText('Kode pemulihan'), { target: { value: 'abcd2345' } });
        fireEvent.click(screen.getByText('Pulihkan'));
        await waitFor(() => expect(recoverTokens).toHaveBeenCalledWith({ phone: '0812', code: 'ABCD2345' }));
        await waitFor(() => expect(screen.getByText(/1 token dipulihkan/)).toBeTruthy());
        expect(screen.getByText('Bulanan')).toBeTruthy(); // now listed
    });

    it('shows an error when recovery finds nothing', async () => {
        recoverTokens.mockResolvedValue({ data: { tokens: [] } });
        render(<MyPlaybackTokens onActivate={vi.fn()} />);
        fireEvent.click(screen.getByText(/Pulihkan token/i));
        fireEvent.change(screen.getByPlaceholderText('Nomor HP'), { target: { value: '0812' } });
        fireEvent.change(screen.getByPlaceholderText('Kode pemulihan'), { target: { value: 'WRONG' } });
        fireEvent.click(screen.getByText('Pulihkan'));
        await waitFor(() => expect(screen.getByText(/Tidak ada token yang cocok/)).toBeTruthy());
    });
});
