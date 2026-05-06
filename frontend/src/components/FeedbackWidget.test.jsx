/*
 * Purpose: Verify feedback floating widget keeps the right mobile lane above the public mobile dock.
 * Caller: Frontend focused public floating widget test gate.
 * Deps: React Testing Library, Vitest, FeedbackWidget.
 * MainFuncs: Feedback floating position tests.
 * SideEffects: None.
 */

import { render, screen } from '@testing-library/react';
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
});
