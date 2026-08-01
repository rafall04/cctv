// @vitest-environment jsdom

/*
 * Purpose: Prove one history row can be read as a row on a phone — and that the desktop table is
 *          untouched for callers that never asked for cards.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * The defect: six columns inside `overflow-x-auto`. That stopped the page widening — the right
 * instinct — but on a 360px screen reaching the IP scrolled the camera name off, so the two halves
 * of one row were never on screen together.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AnalyticsHistoryTable from './AnalyticsHistoryTable';

const ITEMS = [
    { id: 1, camera_name: 'SIMPANG 3 JAMBEAN', ip_address: '103.158.1.2' },
    { id: 2, camera_name: 'SIMPANG 4 TEUKU UMAR', ip_address: '2001:448a:c030:3ed0:fbed:c870:7ddb:9c24' },
];

const COLUMNS = [
    { key: 'camera_name', label: 'Kamera' },
    { key: 'ip_address', label: 'IP' },
];

function setup(props = {}) {
    const onRowClick = vi.fn();
    const { container } = render(
        <AnalyticsHistoryTable
            title="Riwayat"
            items={ITEMS}
            columns={COLUMNS}
            rowKey={(item) => item.id}
            renderCell={(item, column) => item[column.key]}
            pagination={{ page: 1, totalPages: 1, pageSize: 25 }}
            onRowClick={onRowClick}
            {...props}
        />,
    );
    return { container, onRowClick };
}

describe('AnalyticsHistoryTable card view', () => {
    it('keeps the plain table when a caller has not supplied a card', () => {
        const { container } = setup();

        expect(container.querySelector('table')).toBeTruthy();
        expect(container.querySelector('ul')).toBeNull();
        // Nothing is hidden from the caller that did not opt in.
        expect(container.querySelector('.overflow-x-auto').className).not.toContain('hidden');
    });

    it('renders one card per row and hides the table below lg once cards are supplied', () => {
        const { container } = setup({ renderCard: (item) => <span>{item.camera_name}</span> });

        const cards = container.querySelectorAll('li');
        expect(cards).toHaveLength(2);
        expect(within(cards[0]).getByText('SIMPANG 3 JAMBEAN')).toBeTruthy();

        // The table is still there for wide screens — cards replace it only on small ones.
        expect(container.querySelector('ul').className).toContain('lg:hidden');
        expect(container.querySelector('.overflow-x-auto').className).toContain('hidden lg:block');
        expect(container.querySelector('table')).toBeTruthy();
    });

    it('keeps a card clickable, so the detail drawer still opens from a phone', () => {
        const { container, onRowClick } = setup({ renderCard: (item) => <span>{item.camera_name}</span> });

        fireEvent.click(container.querySelectorAll('li')[1]);

        expect(onRowClick).toHaveBeenCalledWith(ITEMS[1]);
    });

    it('shows an empty state instead of an empty card list', () => {
        render(
            <AnalyticsHistoryTable
                title="Riwayat"
                items={[]}
                columns={COLUMNS}
                rowKey={(item) => item.id}
                renderCell={() => null}
                renderCard={() => null}
                pagination={{ page: 1, totalPages: 1, pageSize: 25 }}
                emptyTitle="Belum ada riwayat"
            />,
        );

        expect(screen.getByText('Belum ada riwayat')).toBeTruthy();
    });
});
