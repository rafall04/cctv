// @vitest-environment jsdom
/*
Purpose: Lock the accessibility contracts of the admin design primitives — the exact gaps the
  2026-07 admin audit measured (icon buttons without names, dialogs without role/Escape, tabs
  without aria-selected, inputs without a label association, sort headers without aria-sort).
Caller: Vitest frontend jsdom suite.
Deps: components/ui primitives, @testing-library/react.
MainFuncs: Button/IconButton, Modal, Tabs, Field, SortableTH, StatTile assertions.
SideEffects: None.
*/

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from './Button';
import { Modal } from './Modal';
import { Tabs } from './Tabs';
import { Field } from './Field';
import { Table, THead, TR, SortableTH } from './DataTable';
import { StatTile, loadTone } from './StatTile';
import { Badge, StatusDot } from './Badge';

describe('Button', () => {
    it('keeps a visible focus affordance instead of removing the outline', () => {
        render(<Button>Simpan</Button>);
        const cls = screen.getByRole('button', { name: 'Simpan' }).className;
        expect(cls).toContain('focus-visible:outline-primary');
        expect(cls).not.toContain('focus:outline-none');
    });

    it('disables itself and reports busy while loading so an async handler cannot double-fire', () => {
        const onClick = vi.fn();
        render(<Button loading onClick={onClick}>Kirim</Button>);
        const button = screen.getByRole('button', { name: 'Kirim' });
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        fireEvent.click(button);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('gives every icon-only button an accessible name', () => {
        render(<IconButton label="Hapus kamera"><svg /></IconButton>);
        expect(screen.getByRole('button', { name: 'Hapus kamera' })).toBeTruthy();
    });
});

describe('Modal', () => {
    const renderModal = (props = {}) =>
        render(<Modal title="Ubah area" onClose={props.onClose || vi.fn()} {...props}><p>isi</p></Modal>);

    it('is a labelled modal dialog', () => {
        renderModal();
        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByRole('heading', { name: 'Ubah area' })).toBeTruthy();
    });

    it('closes on Escape — the handler that was missing from all 11 hand-rolled dialogs', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('ignores Escape when the step must be resolved explicitly', () => {
        const onClose = vi.fn();
        renderModal({ onClose, dismissible: false });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Tutup dialog' })).toBeNull();
    });

    it('restores body scroll when it unmounts', () => {
        const { unmount } = renderModal();
        expect(document.body.style.overflow).toBe('hidden');
        unmount();
        expect(document.body.style.overflow).not.toBe('hidden');
    });
});

describe('Tabs', () => {
    const TABS = [
        { id: 'general', label: 'Umum' },
        { id: 'backup', label: 'Cadangan' },
        { id: 'api', label: 'API' },
    ];

    it('announces which panel is showing', () => {
        render(<Tabs tabs={TABS} activeId="backup" onChange={vi.fn()} />);
        expect(screen.getByRole('tab', { name: 'Cadangan' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tab', { name: 'Umum' }).getAttribute('aria-selected')).toBe('false');
    });

    it('moves between tabs with the arrow keys and wraps at the ends', () => {
        const onChange = vi.fn();
        render(<Tabs tabs={TABS} activeId="general" onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
        expect(onChange).toHaveBeenCalledWith('backup');

        onChange.mockClear();
        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
        expect(onChange).toHaveBeenCalledWith('api');
    });

    it('keeps only the active tab in the tab order (roving tabindex)', () => {
        render(<Tabs tabs={TABS} activeId="api" onChange={vi.fn()} />);
        expect(screen.getByRole('tab', { name: 'API' }).getAttribute('tabindex')).toBe('0');
        expect(screen.getByRole('tab', { name: 'Umum' }).getAttribute('tabindex')).toBe('-1');
    });
});

describe('Field', () => {
    it('wires the label to its control so clicking the label focuses the input', () => {
        render(<Field label="Nama kamera" value="" onChange={vi.fn()} />);
        const input = screen.getByLabelText('Nama kamera');
        expect(input.tagName).toBe('INPUT');
        expect(input.id).toBeTruthy();
    });

    it('links the error message to the field and marks it invalid', () => {
        render(<Field label="Port" error="Port harus angka" value="" onChange={vi.fn()} />);
        const input = screen.getByLabelText('Port');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
    });

    it('keeps the required marker out of the accessible name', () => {
        render(<Field label="Nama kamera" required value="" onChange={vi.fn()} />);
        // Not `Nama kamera *` — an asterisk inside <label> becomes part of the control's name.
        expect(screen.getByLabelText('Nama kamera')).toBeTruthy();
        expect(screen.getByLabelText('Nama kamera').required).toBe(true);
    });

    it('renders select and textarea through the same labelled wiring', () => {
        render(
            <>
                <Field as="select" label="Area" value="a" onChange={vi.fn()}><option value="a">A</option></Field>
                <Field as="textarea" label="Catatan" value="" onChange={vi.fn()} />
            </>
        );
        expect(screen.getByLabelText('Area').tagName).toBe('SELECT');
        expect(screen.getByLabelText('Catatan').tagName).toBe('TEXTAREA');
    });
});

describe('SortableTH', () => {
    it('reports the sort direction through aria-sort and requests the next one', () => {
        const onSort = vi.fn();
        render(
            <Table><THead><TR><SortableTH direction="asc" onSort={onSort}>Nama</SortableTH></TR></THead></Table>
        );
        expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('ascending');
        fireEvent.click(screen.getByRole('button', { name: 'Nama' }));
        expect(onSort).toHaveBeenCalledWith('desc');
    });
});

describe('StatTile / status tone', () => {
    it('renders the value in the tabular mono face so polled digits do not reflow the row', () => {
        const { container } = render(<StatTile label="CPU" value={42} unit="%" />);
        const valueEl = container.querySelector('.font-mono');
        expect(valueEl).toBeTruthy();
        expect(valueEl.className).toContain('tabular-nums');
        expect(valueEl.textContent).toBe('42');
    });

    it('derives meter colour from the value, not from the tile', () => {
        expect(loadTone(3)).toBe('live');
        expect(loadTone(80)).toBe('warn');
        expect(loadTone(95)).toBe('fault');
    });

    it('never colours a non-fault state with the fault token', () => {
        const { container } = render(<Badge tone="warn">Maintenance</Badge>);
        expect(container.firstChild.className).toContain('status-warn');
        expect(container.firstChild.className).not.toContain('status-fault');
    });

    it('pairs a bare status dot with text for screen readers', () => {
        render(<StatusDot tone="live" label="Online" />);
        expect(screen.getByText('Online').className).toContain('sr-only');
    });
});
