/*
 * Purpose: Verify public map top chrome controls and decorative overlay behavior.
 * Caller: Frontend Vitest suite for MapView extracted presentation components.
 * Deps: React Testing Library, Vitest, MapTopChrome.
 * MainFuncs: Renders area filter, reset control, and zoom hint pointer-event contract.
 * SideEffects: None.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MapTopChrome from './MapTopChrome.jsx';

describe('MapTopChrome', () => {
    const defaultProps = {
        showAreaFilter: true,
        selectedAreaValue: 'all',
        mapName: 'Semua Lokasi',
        camerasWithCoordsCount: 30,
        areaNames: ['Area A', 'Area B'],
        areaCounts: new Map([
            ['Area A', 10],
            ['Area B', 20],
        ]),
        shouldShowZoomHint: true,
        onAreaChange: vi.fn(),
        onResetView: vi.fn(),
    };

    it('keeps decorative zoom hint transparent while area filter remains clickable', () => {
        render(<MapTopChrome {...defaultProps} />);

        const zoomHint = screen.getByTestId('map-zoom-hint');
        const areaFilterPanel = screen.getByTestId('map-area-filter-panel');
        const topChromeControls = screen.getByTestId('map-top-chrome-controls');

        expect(screen.getByText('Zoom in untuk lihat kamera individual')).toBeTruthy();
        expect(topChromeControls.className).toContain('pointer-events-none');
        expect(zoomHint.className).toContain('pointer-events-none');
        expect(areaFilterPanel.className).toContain('pointer-events-auto');
    });

    it('emits area and reset actions through props', () => {
        const onAreaChange = vi.fn();
        const onResetView = vi.fn();

        render(
            <MapTopChrome
                {...defaultProps}
                onAreaChange={onAreaChange}
                onResetView={onResetView}
            />
        );

        fireEvent.change(screen.getByTestId('map-area-select'), {
            target: { value: 'Area B' },
        });
        fireEvent.click(screen.getByTestId('map-reset-view'));

        expect(onAreaChange).toHaveBeenCalledTimes(1);
        expect(onResetView).toHaveBeenCalledTimes(1);
    });
});
