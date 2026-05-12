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

    it('closes dropdown when the user clicks outside the search container', () => {
        const props = renderSearchBox();

        fireEvent.mouseDown(document.body);

        expect(props.onCloseDropdown).toHaveBeenCalledTimes(1);
    });
});
