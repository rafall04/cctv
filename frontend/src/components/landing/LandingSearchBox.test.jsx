/*
 * Purpose: Verify public landing search input keyboard shortcuts and dropdown close behavior.
 * Caller: Vitest focused public landing regression suite.
 * Deps: Testing Library, Vitest, LandingSearchBox.
 * MainFuncs: renderSearchBox, LandingSearchBox tests.
 * SideEffects: Dispatches DOM keyboard and mouse events in jsdom.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingSearchBox from './LandingSearchBox';

function renderSearchBox(overrides = {}) {
    const searchInputRef = { current: null };
    const searchContainerRef = { current: null };
    const props = {
        searchQuery: '',
        onSearchChange: vi.fn(),
        onFocus: vi.fn(),
        onClear: vi.fn(),
        onCloseDropdown: vi.fn(),
        searchInputRef,
        searchContainerRef,
        showSearchDropdown: true,
        dropdownContent: <div data-testid="search-dropdown">Dropdown</div>,
        ...overrides,
    };

    render(<LandingSearchBox {...props} />);
    return props;
}

describe('LandingSearchBox', () => {
    it('focuses the search input when Ctrl+K is pressed', () => {
        renderSearchBox();
        const input = screen.getByPlaceholderText('Cari kamera berdasarkan nama, lokasi, atau area...');

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

        expect(document.activeElement).toBe(input);
    });

    it('focuses the search input when Meta+K is pressed', () => {
        renderSearchBox();
        const input = screen.getByPlaceholderText('Cari kamera berdasarkan nama, lokasi, atau area...');

        fireEvent.keyDown(window, { key: 'k', metaKey: true });

        expect(document.activeElement).toBe(input);
    });

    it('clears search and closes dropdown when Escape is pressed', () => {
        const props = renderSearchBox({ searchQuery: 'kamera' });
        const input = screen.getByPlaceholderText('Cari kamera berdasarkan nama, lokasi, atau area...');
        input.focus();

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(props.onClear).toHaveBeenCalledTimes(1);
        expect(props.onCloseDropdown).toHaveBeenCalledTimes(1);
    });

    /*
     * Mobile viewport hard rule (docs/frontend-guide.md): a focused input under 16px makes Safari
     * iOS zoom the whole page in. This box shipped with the rule exactly inverted — 14px on the
     * phone, 16px on the desktop that never needed it.
     */
    it('keeps the input at 16px on phones and only shrinks it from sm', () => {
        renderSearchBox();
        const cls = screen.getByPlaceholderText('Cari kamera berdasarkan nama, lokasi, atau area...').className;

        expect(cls, 'phone font must be 16px').toMatch(/\btext-base\b/);
        expect(cls, 'the shrink belongs behind sm:').toMatch(/\bsm:text-sm\b/);
        expect(cls, 'a bare text-sm here re-zooms the page on focus').not.toMatch(/(^|\s)text-sm\b/);
        expect(cls).not.toMatch(/\bsm:text-base\b/);
    });

    it('gives the clear button a thumb-sized target on narrow screens', () => {
        renderSearchBox({ searchQuery: 'kamera' });
        const cls = screen.getByRole('button', { name: 'Hapus pencarian' }).className;

        expect(cls, '28px is not a reliable thumb target').toMatch(/\bmin-h-\[40px\]/);
        expect(cls, 'desktop density stays unchanged').toMatch(/\bsm:min-h-0\b/);
    });

    it('closes dropdown when the user clicks outside the search container', () => {
        const props = renderSearchBox();

        fireEvent.mouseDown(document.body);

        expect(props.onCloseDropdown).toHaveBeenCalledTimes(1);
    });
});
