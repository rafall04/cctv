// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { getPublicPlansMock } = vi.hoisted(() => ({ getPublicPlansMock: vi.fn() }));

vi.mock('../contexts/BrandingContext', () => ({
    useBranding: () => ({ branding: { whatsapp_number: '6289685645956', company_name: 'RAF' } }),
}));

vi.mock('../services/publicBillingService', () => ({
    publicBillingService: { getPublicPlans: getPublicPlansMock },
}));

import SewaPage from './SewaPage';

const PLANS = [
    {
        key: 'trial', name: 'Trial Gratis', description: 'Coba gratis sebelum berlangganan',
        price_per_camera: 0, recording_price_per_camera: 0, recording_retention_days: 0,
        max_cameras: 1, is_trial: true, trial_days: 3,
    },
    {
        key: 'basic', name: 'Basic', description: '1 kamera, cocok untuk rumah',
        price_per_camera: 15000, recording_price_per_camera: 10000, recording_retention_days: 0,
        max_cameras: 1, is_trial: false, trial_days: null,
    },
    {
        key: 'bisnis', name: 'Bisnis', description: 'Sampai 10 kamera',
        price_per_camera: 10000, recording_price_per_camera: 5000, recording_retention_days: 7,
        max_cameras: 10, is_trial: false, trial_days: null,
    },
];

function renderPage() {
    return render(<MemoryRouter><SewaPage /></MemoryRouter>);
}

describe('SewaPage', () => {
    beforeEach(() => {
        getPublicPlansMock.mockReset();
        getPublicPlansMock.mockResolvedValue({ success: true, data: PLANS });
    });

    it('renders every price from the API, formatted as rupiah', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByText(/Rp\s?15[.,]000/)).toBeTruthy());
        // Rp10.000 legitimately appears twice: the Bisnis rental price and the Basic recording
        // surcharge. Asserting a single match would fail on a page that is behaving correctly.
        expect(screen.getAllByText(/Rp\s?10[.,]000/).length).toBeGreaterThan(0);
        // The recording surcharge is charged on top of the rental, not instead of it — it has to show.
        expect(screen.getByText(/\+\s*Rp\s?5[.,]000/)).toBeTruthy();
    });

    it('shows the trial as free rather than as Rp0', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByText('Gratis')).toBeTruthy());
        expect(screen.getByText('3 hari pertama')).toBeTruthy();
        expect(screen.queryByText(/Rp\s?0(?![.,]?\d)/)).toBeNull();
    });

    /*
     * retention_days = 0 means "not decided yet". Printing "Simpan 0 hari" would read as "we keep
     * nothing" — the exact opposite of what the surcharge buys.
     */
    it('never prints a zero retention depth', async () => {
        renderPage();
        await waitFor(() => expect(screen.getByText('Simpan 7 hari')).toBeTruthy());
        expect(screen.getByText('Lama simpan disepakati saat pemasangan')).toBeTruthy();
        expect(screen.queryByText(/Simpan 0 hari/)).toBeNull();
    });

    /*
     * A missing price is recoverable; a wrong one is not. When the fetch fails the page must show
     * no figures at all and hand the visitor to WhatsApp instead of falling back to stale copy.
     */
    it('shows no prices at all when the price list cannot load', async () => {
        getPublicPlansMock.mockRejectedValue(new Error('network down'));
        const { container } = renderPage();
        await waitFor(() =>
            expect(screen.getByText(/Daftar harga sedang tidak bisa dimuat/)).toBeTruthy());
        expect(container.textContent).not.toMatch(/Rp\s?\d/);
        expect(screen.getByText('Tanya harga lewat WhatsApp')).toBeTruthy();
    });

    /*
     * Source-level guard, not a render assertion: the page this replaced advertised Rp 15.000 while
     * billing charged Rp 25.000 because someone typed a price into the markup. Checking rendered
     * output cannot catch a hardcoded figure sitting on a branch these tests never reach.
     */
    it('contains no hand-typed rupiah figure in its source', () => {
        const source = readFileSync(path.resolve('src/pages/SewaPage.jsx'), 'utf8');
        const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(withoutComments).not.toMatch(/Rp\s?\d/);
    });
});
