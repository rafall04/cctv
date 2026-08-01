// @vitest-environment jsdom

/*
 * Purpose: Pin the Modal placement/scrim options — and prove the defaults still behave exactly as
 *          before, since every existing admin dialog depends on them.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: Renders jsdom only.
 *
 * `center` exists because a video pinned to the bottom edge of a phone is both hard to see and
 * hard to reach. Forms keep the bottom sheet: there the controls SHOULD sit under the thumb.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

/** The scrim/overlay element — the dialog's parent. */
function overlayOf() {
    return screen.getByRole('dialog').parentElement;
}

describe('Modal placement', () => {
    it('defaults to a bottom sheet on phones, as every existing form dialog expects', () => {
        render(<Modal title="Form" onClose={() => {}}>isi</Modal>);

        const overlay = overlayOf();
        expect(overlay.className).toContain('items-end');
        expect(overlay.className).toContain('sm:items-center');
        expect(screen.getByRole('dialog').className).toContain('rounded-t-card');
    });

    it('centres on every viewport when placement is center', () => {
        render(<Modal title="Video" placement="center" onClose={() => {}}>isi</Modal>);

        const overlay = overlayOf();
        expect(overlay.className).toContain('items-center');
        // The bottom-anchored classes must be GONE, not merely overridden later in the string.
        expect(overlay.className).not.toContain('items-end');
        // A margin so the panel does not touch the screen edges.
        expect(overlay.className).toContain('p-3');
        expect(screen.getByRole('dialog').className).not.toContain('rounded-t-card');
    });

    it('falls back to the sheet for an unknown placement rather than rendering unpositioned', () => {
        render(<Modal title="X" placement="diagonal" onClose={() => {}}>isi</Modal>);

        expect(overlayOf().className).toContain('items-end');
    });
});

describe('Modal scrim', () => {
    it('defaults to the general 60% scrim', () => {
        render(<Modal title="Form" onClose={() => {}}>isi</Modal>);

        expect(overlayOf().className).toContain('bg-black/60');
    });

    it('goes near-opaque for media so the page behind stops competing with the footage', () => {
        render(<Modal title="Video" scrim="media" onClose={() => {}}>isi</Modal>);

        const overlay = overlayOf();
        expect(overlay.className).toContain('bg-black/90');
        expect(overlay.className).not.toContain('bg-black/60');
    });
});

describe('Modal header actions', () => {
    it('renders caller actions beside the close button, keeping the footer free', () => {
        render(
            <Modal title="Video" onClose={() => {}} headerActions={<button type="button">Unduh</button>}>
                isi
            </Modal>,
        );

        expect(screen.getByText('Unduh')).toBeTruthy();
        expect(screen.getByLabelText('Tutup dialog')).toBeTruthy();
    });

    it('still closes from the scrim and the close button with actions present', () => {
        const onClose = vi.fn();
        render(
            <Modal title="Video" onClose={onClose} headerActions={<button type="button">Unduh</button>}>
                isi
            </Modal>,
        );

        fireEvent.click(screen.getByLabelText('Tutup dialog'));
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.click(overlayOf());
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('keeps the accessible name and dialog semantics regardless of the new options', () => {
        render(
            <Modal title="Rekaman" description="20.30 – 20.38" placement="center" scrim="media" onClose={() => {}}>
                isi
            </Modal>,
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
        expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    });
});
