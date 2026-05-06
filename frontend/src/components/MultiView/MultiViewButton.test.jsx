/*
 * Purpose: Verify public multi-view launcher stays above mobile dock and support widgets.
 * Caller: Frontend focused public floating widget test gate.
 * Deps: React Testing Library, Vitest, MultiViewButton.
 * MainFuncs: MultiViewButton floating position tests.
 * SideEffects: None.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MultiViewButton from './MultiViewButton';

vi.mock('../../utils/animationControl', () => ({
    shouldDisableAnimations: () => true,
}));

describe('MultiViewButton floating layout', () => {
    it('uses a higher mobile lane than Saweria and feedback controls', () => {
        render(<MultiViewButton count={1} onClick={vi.fn()} maxReached={false} />);

        const launcher = screen.getByRole('button', { name: /Multi-View/i }).parentElement;
        expect(launcher.className).toContain('bottom-44');
        expect(launcher.className).toContain('left-4');
        expect(launcher.className).toContain('sm:bottom-6');
    });
});
