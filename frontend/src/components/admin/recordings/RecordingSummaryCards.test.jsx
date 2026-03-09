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

        const recordingLabel = screen.getByTestId('summary-label-kamera-recording');
        const storageLabel = screen.getByTestId('summary-label-total-storage');

        expect(recordingLabel.className).toContain('dark:text-red-200');
        expect(storageLabel.className).toContain('dark:text-emerald-200');
        expect(screen.getByText('385')).toBeTruthy();
    });
});
