/*
 * Purpose: Lock the behaviour of the control that decides whether a camera is visible to the whole
 *          internet or to nobody but its owner.
 * Caller: frontend test gate.
 *
 * The asserted rules are the ones a wrong implementation would get subtly wrong: owner_private
 * cannot be saved without an owner (the backend 400s, and a form that submits anyway looks broken);
 * a rented camera gets the PUBLISH switch rather than the class switch, because its class belongs
 * to its subscription; and opening a private camera up warns that the switch is retroactive over
 * the whole recording history, which is the one thing the button does not look like it does.
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

const simpan = () => screen.getByRole('button', { name: /^Simpan$/i });

describe('CameraClassModal — kelas kamera', () => {
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

        fireEvent.click(simpan());
        expect(onSubmit).toHaveBeenCalledWith({ mode: 'class', cameraClass: 'community', ownerUserId: '' });
    });

    it('menolak simpan owner_private sampai pemiliknya dipilih', () => {
        const { onSubmit } = buka();

        fireEvent.click(screen.getByRole('radio', { name: /Owner Private/i }));
        expect(simpan().disabled).toBe(true);

        fireEvent.change(screen.getByLabelText(/Pemilik kamera/i), { target: { value: '1' } });
        expect(simpan().disabled).toBe(false);

        fireEvent.click(simpan());
        expect(onSubmit).toHaveBeenCalledWith({ mode: 'class', cameraClass: 'owner_private', ownerUserId: '1' });
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

describe('peringatan riwayat saat privat dibuka ke publik', () => {
    it('memperingatkan bahwa SELURUH riwayat ikut terbuka, termasuk arsip Telegram', () => {
        // Setiap gerbang membaca camera_class saat ini, bukan saat rekaman dibuat — jadi
        // sakelar ini berlaku surut, dan itu tidak terbaca dari tombolnya.
        buka({ camera: KAMERA({ camera_class: 'owner_private', owner_user_id: 1 }) });
        expect(screen.queryByText(/SELURUH riwayat rekaman/i)).toBeNull();

        fireEvent.click(screen.getByRole('radio', { name: /Community/i }));
        expect(screen.getByText(/SELURUH riwayat rekaman/i)).toBeTruthy();
        expect(screen.getByText(/arsip Telegram/i)).toBeTruthy();
    });

    it('tidak muncul untuk kamera yang memang sudah community', () => {
        buka();
        expect(screen.queryByText(/SELURUH riwayat rekaman/i)).toBeNull();
    });
});

describe('kamera sewa — tuas satu arah, bukan sakelar', () => {
    const SEWA = (isi = {}) => KAMERA({ camera_class: 'subscriber', owner_user_id: 42, ...isi });
    const turunkan = () => screen.getByRole('button', { name: /Sembunyikan dari hub publik/i });

    it('tidak pernah menawarkan pilihan kelas', () => {
        buka({ camera: SEWA({ is_public: 1, billing_status: 'active' }) });
        expect(screen.queryByRole('radio')).toBeNull();
    });

    it('kamera yang tampil publik bisa diturunkan', () => {
        const { onSubmit } = buka({ camera: SEWA({ is_public: 1, billing_status: 'active' }) });

        expect(turunkan().disabled).toBe(false);
        fireEvent.click(turunkan());
        expect(onSubmit).toHaveBeenCalledWith({ mode: 'unpublish' });
    });

    it('TIDAK memberi jalan apa pun untuk mempublikasikan kamera pelanggan', () => {
        // Inti aturannya: memajang kamera milik orang lain ke internet adalah persetujuan
        // yang bukan milik operator. Tombolnya harus mati, bukan sekadar tidak dianjurkan.
        buka({ camera: SEWA({ is_public: 0, billing_status: 'active' }) });

        expect(turunkan().disabled).toBe(true);
        expect(screen.queryByRole('button', { name: /publikkan|tampilkan/i })).toBeNull();
        expect(screen.getByText(/bukan milik operator/i)).toBeTruthy();
    });

    it('menyebut status sekarang dan tertahannya langganan', () => {
        buka({ camera: SEWA({ is_public: 1, billing_status: 'suspended' }) });
        expect(screen.getByText(/tertahan/i)).toBeTruthy();
    });

    it('menyebut bahwa ini tuas moderasi, dan pemilik bisa menampilkannya lagi', () => {
        buka({ camera: SEWA({ is_public: 1, billing_status: 'active' }) });
        expect(screen.getByText(/portalnya sendiri/i)).toBeTruthy();
        expect(screen.getByText(/bukan kunci/i)).toBeTruthy();
    });
});
