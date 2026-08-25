/*
 * Purpose: Verify feedback floating widget keeps the right mobile lane above the public mobile dock.
 * Caller: Frontend focused public floating widget test gate.
 * Deps: React Testing Library, Vitest, FeedbackWidget.
 * MainFuncs: Feedback floating position tests.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FeedbackWidget from './FeedbackWidget';

describe('FeedbackWidget floating layout', () => {
    it('uses the right-side mobile lane above the bottom dock', () => {
        render(<FeedbackWidget />);

        const button = screen.getByTitle('Kritik & Saran');
        expect(button.className).toContain('bottom-24');
        expect(button.className).toContain('right-4');
        expect(button.className).toContain('sm:bottom-6');
    });

    /*
     * The panel is never unmounted, only faded out. `opacity-0` hides it from eyes but not from
     * Tab, so the closed form used to leave four invisible focus stops at the end of every public
     * page — a keyboard visitor typed into nothing. `invisible` is what actually removes it.
     */
    it('takes the closed panel out of the tab order, not merely out of sight', () => {
        render(<FeedbackWidget />);
        const panel = screen.getByPlaceholderText('Tulis kritik atau saran Anda...').closest('.z-fab');

        expect(panel.className).toContain('invisible');
        expect(panel.getAttribute('aria-hidden')).toBe('true');

        fireEvent.click(screen.getByTitle('Kritik & Saran'));

        expect(panel.className).not.toContain('invisible');
        expect(panel.getAttribute('aria-hidden')).toBeNull();
    });

    it('gives the close control a name instead of a bare icon', () => {
        render(<FeedbackWidget />);
        // Only reachable once open — while closed the whole panel is out of the a11y tree,
        // which is exactly the point of the test above.
        fireEvent.click(screen.getByTitle('Kritik & Saran'));

        expect(screen.getByRole('button', { name: 'Tutup kritik & saran' })).toBeTruthy();
    });
});
