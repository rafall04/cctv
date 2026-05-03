// @vitest-environment jsdom

/*
 * Purpose: Validate the admin area bulk policy preview presentation slice.
 * Caller: Vitest frontend suite for AreaManagement component extraction regressions.
 * Deps: React Testing Library, BulkPolicyPreview.
 * MainFuncs: BulkPolicyPreview render and preview callback tests.
 * SideEffects: Renders jsdom-only preview markup.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BulkPolicyPreview from './BulkPolicyPreview';

describe('BulkPolicyPreview', () => {
    it('menampilkan summary preview dan memanggil callback preview', () => {
        const onPreview = vi.fn();
        render(
            <BulkPolicyPreview
                bulkPreview={{
                    targetFilter: 'external_hls_only',
                    guidance: 'Gunakan preview sebelum apply.',
                    summary: {
                        totalInArea: 9,
                        matchedCount: 5,
                        eligibleCount: 4,
                        blockedCount: 1,
                        unresolvedCount: 2,
                        recordingEnabledCount: 3,
                        deliveryTypeBreakdown: [{ key: 'external_hls', count: 4 }],
                        externalHealthModeBreakdown: [{ key: 'passive_first', count: 2 }],
                        blockedReasons: [{ reason: 'internal-camera', count: 1 }],
                        examples: [{ id: 10, name: 'Cam Eligible', delivery_classification: 'external_hls' }],
                        blockedExamples: [{ id: 11, name: 'Cam Blocked', reason: 'No HLS', delivery_classification: 'external_mjpeg' }],
                    },
                }}
                bulkPreviewLoading={false}
                effectiveBulkTargetFilter="all"
                onPreview={onPreview}
            />
        );

        expect(screen.getByText('Hanya External HLS')).toBeTruthy();
        expect(screen.getByText('9')).toBeTruthy();
        expect(screen.getByText('Cam Eligible')).toBeTruthy();
        expect(screen.getByText('Cam Blocked')).toBeTruthy();
        expect(screen.getByText('Gunakan preview sebelum apply.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(onPreview).toHaveBeenCalledTimes(1);
    });
});
