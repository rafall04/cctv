// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RecordingSummaryCards from './RecordingSummaryCards.jsx';

describe('RecordingSummaryCards', () => {
    it('merender pill summary dengan tone dark-mode eksplisit', () => {
        render(
            <RecordingSummaryCards
                summary={{
                    recordingCount: 14,
                    cameras: 14,
                    totalSegments: 385,
                    totalSize: 46100000000,
                }}
            />
        );

        // These four are counts, not health readings — none of them may wear the fault token.
        // "Kamera Recording" used to render red, which made a healthy fleet look alarmed.
        const cardText = document.body.textContent;
        expect(cardText).toContain('Kamera Recording');
        expect(document.body.innerHTML).not.toContain('status-fault');

        expect(screen.getByText('385')).toBeTruthy();
    });
});
