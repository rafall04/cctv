// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
    InteractiveBarChart,
    Pagination,
    PeriodSelector,
    StatsCard,
} from './AnalyticsPrimitives';

vi.mock('../../TrendIndicator', () => ({
    TrendBadge: () => <span data-testid="trend-badge">trend</span>,
}));

describe('AnalyticsPrimitives dark mode readability', () => {
    it('meningkatkan kontras label card dan control filters', () => {
        render(
            <div>
                <StatsCard
                    icon={<span>i</span>}
                    label="Viewers"
                    value="42"
                    subValue="Aktif sekarang"
                />
                <PeriodSelector
                    value="custom"
                    onChange={vi.fn()}
                    customDate="2026-03-08"
                    onCustomDateChange={vi.fn()}
                />
            </div>
        );

        expect(screen.getByText('Viewers').className).toContain('dark:text-gray-400');
        expect(screen.getByDisplayValue('2026-03-08').className).toContain('dark:text-white');
    });

    it('memberi tone dark mode eksplisit pada empty state dan pagination', () => {
        const { container } = render(
            <div>
                <InteractiveBarChart data={[]} />
                <Pagination currentPage={3} totalPages={8} onPageChange={vi.fn()} />
            </div>
        );

        expect(screen.getByText('Tidak ada data').className).toContain('dark:text-gray-400');
        expect(screen.getAllByText('...')[0].className).toContain('dark:text-gray-400');
        expect(container.querySelector('button').className).toContain('dark:text-gray-300');
    });
});
