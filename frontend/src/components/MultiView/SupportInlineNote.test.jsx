/*
 * Purpose: Pin that the in-context donation line follows the operator switch only, and is never
 *          silenced by a preference the visitor set about POPUPS.
 * Caller: Frontend test gate.
 * Deps: React Testing Library, Vitest, saweriaConfig.
 * MainFuncs: SupportInlineNote visibility tests.
 * SideEffects: Mocks fetch and localStorage.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import SupportInlineNote from './SupportInlineNote';
import { resetSaweriaConfigCache } from '../../utils/saweriaConfig';

const mockConfig = (enabled) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { enabled } }),
    });
};

describe('SupportInlineNote', () => {
    beforeEach(() => {
        localStorage.clear();
        resetSaweriaConfigCache();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows the line when the operator has support enabled', async () => {
        mockConfig(true);
        render(<SupportInlineNote />);
        expect(await screen.findByText(/Siaran ini gratis untuk semua/)).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Traktir kopi' })).toBeTruthy();
    });

    it('renders nothing when the operator has support disabled', async () => {
        mockConfig(false);
        const { container } = render(<SupportInlineNote />);
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        expect(container.textContent).toBe('');
    });

    /*
     * REGRESSION. `saweria_dont_show` is written by the modal's "Jangan Tampilkan Lagi" button,
     * which in the older code only silenced the modal — the banner came back two seconds later.
     * Honouring it here read a past decision about POPUPS as a decision about page content, and
     * hid this line forever from every visitor who had ever dismissed one. This line is not an
     * interruption; it sits in the page beside "Bagikan" and "Buka area".
     */
    it('is NOT silenced by the popup-suppression preference', async () => {
        localStorage.setItem('saweria_dont_show', 'true');
        mockConfig(true);
        render(<SupportInlineNote />);
        expect(await screen.findByText(/Siaran ini gratis untuk semua/)).toBeTruthy();
    });

    it('stays quiet when the config cannot be read at all', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));
        const { container } = render(<SupportInlineNote />);
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        expect(container.textContent).toBe('');
    });
});
