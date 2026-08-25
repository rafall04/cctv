/*
 * Purpose: Hold the Full/Simple segmented control to the 40px touch floor on phones.
 * Caller: Vitest focused public landing regression suite.
 * Deps: Testing Library, Vitest, LayoutModeToggle.
 * MainFuncs: LayoutModeToggle tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LayoutModeToggle from './LayoutModeToggle';

describe('LayoutModeToggle', () => {
    /* Was 28px tall — px-3 py-1.5 around text-xs — on a control that switches the whole public
     * landing between layouts. The floor is 40px on narrow screens, unchanged from sm up. */
    it('meets the 40px touch floor on narrow screens only', () => {
        render(<LayoutModeToggle layoutMode="full" onChange={vi.fn()} />);

        for (const name of ['Full', 'Simple']) {
            const cls = screen.getByRole('tab', { name }).className;
            expect(cls, `${name} segment is under the touch floor`).toMatch(/\bmin-h-\[40px\]/);
            expect(cls).toMatch(/\bsm:min-h-0\b/);
        }
    });

    it('reports the selected segment and only changes on the inactive one', () => {
        const onChange = vi.fn();
        render(<LayoutModeToggle layoutMode="full" onChange={onChange} />);

        expect(screen.getByRole('tab', { name: 'Full' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tab', { name: 'Simple' }).getAttribute('aria-selected')).toBe('false');

        fireEvent.click(screen.getByRole('tab', { name: 'Full' }));
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('tab', { name: 'Simple' }));
        expect(onChange).toHaveBeenCalledWith('simple');
    });
});
