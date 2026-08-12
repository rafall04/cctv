/*
 * PromoBannerForm.test.jsx — the poster picker.
 *
 * The headline case is the one an operator hit in production: "Choose File" was
 * disabled until the promo had been saved, so on a brand-new promo the control
 * simply did nothing when clicked.
 *
 * Plain DOM assertions on purpose: this project does not load @testing-library/jest-dom.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PromoBannerForm from './PromoBannerForm';

const { uploadPromoBannerImage, showNotification } = vi.hoisted(() => ({
    uploadPromoBannerImage: vi.fn(),
    showNotification: vi.fn(),
}));

vi.mock('../../../services/promoBannerService', () => ({ uploadPromoBannerImage }));
vi.mock('../../../contexts/NotificationContext', () => ({
    useNotification: () => ({ showNotification }),
}));

const AREAS = [{ id: 2, name: 'DANDER' }, { id: 3, name: 'TANJUNGHARJO' }];
const CAMERAS = [{ id: 11, name: 'CCTV LAPANGAN DANDER' }];

const SAVED_PROMO = {
    id: 7,
    title: 'Pemasangan Gratis',
    placements: ['popup'],
    target_mode: 'all',
    active: 1,
    area_ids: [],
    camera_ids: [],
};

function makeFile({ name = 'poster.png', type = 'image/png', size = 1024 } = {}) {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
}

function renderForm(props = {}) {
    return render(
        <PromoBannerForm
            promo={null}
            areas={AREAS}
            cameras={CAMERAS}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            {...props}
        />
    );
}

const fileInput = () => screen.getByLabelText('Pilih gambar poster');

beforeEach(() => {
    vi.clearAllMocks();
    uploadPromoBannerImage.mockResolvedValue({
        success: true,
        data: { image: { imageBase: 'promo-0123456789ab', width: 1200, height: 894, bytes: 90000, renditions: [] } },
    });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
    globalThis.URL.revokeObjectURL = vi.fn();
});

describe('poster picker on a NEW promo', () => {
    it('is clickable before the promo has been saved', () => {
        // The regression: `disabled` was tied to promo?.id, so this control was
        // inert on every new promo and clicking it did nothing at all.
        renderForm({ promo: null });
        expect(fileInput().disabled).toBe(false);
    });

    it('holds the chosen file and says it will upload on save', async () => {
        renderForm({ promo: null });

        fireEvent.change(fileInput(), { target: { files: [makeFile({ name: 'gratis.png' })] } });

        expect(await screen.findByText('gratis.png')).not.toBeNull();
        expect(screen.getByText(/akan diunggah otomatis/i)).not.toBeNull();
        // No id yet — uploading now would 404.
        expect(uploadPromoBannerImage).not.toHaveBeenCalled();
    });

    it('shows a local preview of the pending file', async () => {
        renderForm({ promo: null });
        fireEvent.change(fileInput(), { target: { files: [makeFile()] } });

        await waitFor(() => {
            expect(screen.getByAltText('Pratinjau poster promo').getAttribute('src')).toBe('blob:preview');
        });
    });

    it('uploads the pending file as soon as the save returns an id', async () => {
        const onSubmit = vi.fn().mockResolvedValue(SAVED_PROMO);
        const onUploaded = vi.fn();
        renderForm({ promo: null, onSubmit, onUploaded });

        fireEvent.change(screen.getByPlaceholderText('Pemasangan CCTV Gratis'), { target: { value: 'Promo' } });
        fireEvent.change(fileInput(), { target: { files: [makeFile()] } });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

        await waitFor(() => expect(uploadPromoBannerImage).toHaveBeenCalledTimes(1));
        expect(uploadPromoBannerImage.mock.calls[0][0]).toBe(7);
        // The list row would otherwise still read "Tanpa gambar".
        await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    });

    it('does not upload when the save fails', async () => {
        const onSubmit = vi.fn().mockResolvedValue(null);
        renderForm({ promo: null, onSubmit });

        fireEvent.change(screen.getByPlaceholderText('Pemasangan CCTV Gratis'), { target: { value: 'Promo' } });
        fireEvent.change(fileInput(), { target: { files: [makeFile()] } });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(uploadPromoBannerImage).not.toHaveBeenCalled();
    });
});

describe('poster picker on an EXISTING promo', () => {
    it('uploads immediately', async () => {
        renderForm({ promo: SAVED_PROMO });

        fireEvent.change(fileInput(), { target: { files: [makeFile()] } });

        await waitFor(() => expect(uploadPromoBannerImage).toHaveBeenCalledTimes(1));
        expect(uploadPromoBannerImage.mock.calls[0][0]).toBe(7);
    });

    it('reports the size the poster was shrunk to', async () => {
        renderForm({ promo: SAVED_PROMO });
        fireEvent.change(fileInput(), { target: { files: [makeFile({ size: 900 * 1024 })] } });

        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'success', message: expect.stringContaining('900KB → 88KB') })
        ));
    });
});

describe('file rejection', () => {
    it.each([
        ['a PDF', { type: 'application/pdf' }, /Format tidak didukung/],
        ['an oversized image', { size: 9 * 1024 * 1024 }, /terlalu besar/i],
    ])('refuses %s without uploading', async (_label, overrides, titlePattern) => {
        renderForm({ promo: SAVED_PROMO });

        fireEvent.change(fileInput(), { target: { files: [makeFile(overrides)] } });

        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', title: expect.stringMatching(titlePattern) })
        ));
        expect(uploadPromoBannerImage).not.toHaveBeenCalled();
    });

    it('clears the input so the same file can be picked again after a rejection', async () => {
        renderForm({ promo: SAVED_PROMO });
        const input = fileInput();

        fireEvent.change(input, { target: { files: [makeFile({ type: 'application/pdf' })] } });

        await waitFor(() => expect(showNotification).toHaveBeenCalled());
        expect(input.value).toBe('');
    });
});

describe('targeting validation', () => {
    it.each([
        ['area', 'Area tertentu', /Area belum dipilih/],
        ['camera', 'Kamera tertentu', /Kamera belum dipilih/],
    ])('refuses to save %s targeting with nothing selected', async (_mode, radioLabel, titlePattern) => {
        // Such a banner matches nothing and silently never appears — the operator
        // would believe it was live.
        const onSubmit = vi.fn().mockResolvedValue(SAVED_PROMO);
        renderForm({ promo: null, onSubmit });

        fireEvent.change(screen.getByPlaceholderText('Pemasangan CCTV Gratis'), { target: { value: 'Promo' } });
        fireEvent.click(screen.getByRole('radio', { name: new RegExp(radioLabel) }));
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'warning', title: expect.stringMatching(titlePattern) })
        ));
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('warns that an area-targeted banner cannot appear on the landing page', async () => {
        // Hit in production: all four placements were ticked with area targeting, and
        // the landing page silently showed nothing because it has no area context.
        renderForm({ promo: { ...SAVED_PROMO, target_mode: 'area', placements: ['popup', 'landing'], area_ids: [2] } });

        expect(await screen.findByText(/tidak akan tampil di sana/i)).not.toBeNull();
    });

    it('does not warn when the banner targets every camera', async () => {
        renderForm({ promo: { ...SAVED_PROMO, target_mode: 'all', placements: ['popup', 'landing'] } });

        await waitFor(() => expect(screen.getByLabelText('Pilih gambar poster')).not.toBeNull());
        expect(screen.queryByText(/tidak akan tampil di sana/i)).toBeNull();
    });

    it('does not warn when the landing placement is not selected', async () => {
        renderForm({ promo: { ...SAVED_PROMO, target_mode: 'area', placements: ['popup'], area_ids: [2] } });

        await waitFor(() => expect(screen.getByLabelText('Pilih gambar poster')).not.toBeNull());
        expect(screen.queryByText(/tidak akan tampil di sana/i)).toBeNull();
    });

    it('saves area targeting once an area is ticked', async () => {
        const onSubmit = vi.fn().mockResolvedValue(SAVED_PROMO);
        renderForm({ promo: null, onSubmit });

        fireEvent.change(screen.getByPlaceholderText('Pemasangan CCTV Gratis'), { target: { value: 'Promo' } });
        fireEvent.click(screen.getByRole('radio', { name: /Area tertentu/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'DANDER' }));
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ target_mode: 'area', area_ids: [2] })
        ));
    });
});
