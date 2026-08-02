// @vitest-environment jsdom

/*
 * Purpose: Prove the responsible-use rule is stated as a rule, in one compact block.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * It used to sit at the foot of the usage guide — the last block on the page — where a viewer who
 * came to watch a clip and leave never reached it.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PlaybackResponsibleUseNotice from './PlaybackResponsibleUseNotice';

describe('PlaybackResponsibleUseNotice', () => {
    it('states the rule and what it forbids', () => {
        render(<PlaybackResponsibleUseNotice />);

        expect(screen.getByText('Gunakan dengan bijak.')).toBeTruthy();
        expect(screen.getByText(/Jangan disebarkan ulang/)).toBeTruthy();
    });

    it('is announced as a note, so a screen reader does not read it as body copy', () => {
        render(<PlaybackResponsibleUseNotice />);

        expect(screen.getByRole('note')).toBeTruthy();
    });

    it('uses the fault rule reserved for things that carry real consequence', () => {
        const { container } = render(<PlaybackResponsibleUseNotice />);

        expect(container.firstChild.className).toContain('border-l-status-fault');
    });
});
