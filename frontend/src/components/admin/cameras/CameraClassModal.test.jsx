/*
 * Purpose: Lock the behaviour of the control that decides whether a camera is visible to the whole
 *          internet or to nobody but its owner.
 * Caller: frontend test gate.
 *
 * The asserted rules are the ones a wrong implementation would get subtly wrong: owner_private
 * cannot be saved without an owner (the backend 400s, and a form that submits anyway looks broken),
 * and a subscriber camera must not offer the choice at all because its class belongs to its
 * subscription.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CameraClassModal from './CameraClassModal';

const USERS = [
    { id: 1, username: 'aldi', role: 'admin' },
    { id: 42, username: 'budi', role: 'customer' },
];

const KAMERA = (isi = {}) => ({ id: 7, name: 'Rumah Depan', camera_class: 'community', ...isi });

function buka(props = {}) {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(
        <CameraClassModal
            camera={KAMERA()}
            users={USERS}
            error=""
            isSaving={false}
            onClose={onClose}
            onSubmit={onSubmit}
            onDismissError={() => {}}
            {...props}
        />
    );
    return { onSubmit, onClose };
}

describe('CameraClassModal', () => {
    it('tidak merender apa pun tanpa kamera', () => {
        const { container } = render(
            <CameraClassModal camera={null} users={[]} error="" isSaving={false} onClose={() => {}} onSubmit={() => {}} onDismissError={() => {}} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('membuka pada kelas kamera saat ini', () => {
        buka({ camera: KAMERA({ camera_class: 'owner_private', owner_user_id: 1 }) });
        expect(screen.getByRole('radio', { name: /Owner Private/i }).checked).toBe(true);
    });

    it('menyimpan kelas community tanpa perlu pemilik', () => {
        const { onSubmit } = buka();

        fireEvent.click(screen.getByRole('button', { name: /Simpan kelas/i }));
        expect(onSubmit).toHaveBeenCalledWith({ cameraClass: 'community', ownerUserId: '' });
    });

    it('menolak simpan owner_private sampai pemiliknya dipilih', () => {
        const { onSubmit } = buka();

        fireEvent.click(screen.getByRole('radio', { name: /Owner Private/i }));
        const simpan = screen.getByRole('button', { name: /Simpan kelas/i });
        expect(simpan.disabled).toBe(true);

        fireEvent.change(screen.getByLabelText(/Pemilik kamera/i), { target: { value: '1' } });
        expect(simpan.disabled).toBe(false);

        fireEvent.click(simpan);
        expect(onSubmit).toHaveBeenCalledWith({ cameraClass: 'owner_private', ownerUserId: '1' });
    });

    it('kamera sewaan tidak menawarkan pilihan kelas sama sekali', () => {
        // Kelasnya turunan dari langganan; form yang bisa disubmit di sini cuma akan kena 400.
        buka({ camera: KAMERA({ camera_class: 'subscriber' }) });

        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.getByRole('button', { name: /Simpan kelas/i }).disabled).toBe(true);
        expect(screen.getByText(/batalkan langganan/i)).toBeTruthy();
    });

    it('memberi tahu saat daftar pengguna gagal dimuat, bukan diam-diam kosong', () => {
        buka({ users: [] });

        fireEvent.click(screen.getByRole('radio', { name: /Owner Private/i }));
        expect(screen.getByText(/Gagal memuat daftar pengguna/i)).toBeTruthy();
        expect(screen.getByLabelText(/Pemilik kamera/i).disabled).toBe(true);
    });

    it('mengunci tombol selagi menyimpan', () => {
        buka({ isSaving: true });
        expect(screen.getByRole('button', { name: /Menyimpan/i }).disabled).toBe(true);
        expect(screen.getByRole('button', { name: /Batal/i }).disabled).toBe(true);
    });
});
